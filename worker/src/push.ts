// Pushberichten naar de beheer-app (admin.html), standaard Web Push (RFC 8030/8291/8292), zonder npm-pakketten.
// Overgenomen van EVailability (repo RemcoNLD/apps, src/evailability-worker.js), opslag in D1 in plaats van KV.
//   app_settings "push_vapid": het VAPID-sleutelpaar, door de Worker zelf gemaakt bij het eerste gebruik (nooit in Git).
//   admin_push_subs: de abonnementen (één per toestel).
// Het bericht wordt versleuteld voor de telefoon (aes128gcm); de pushdienst ziet alleen versleutelde tekst.
import type { Env } from './auth';
import { nowSec } from './util';

const PUSH_TTL_S = 12 * 3600;
const PUSH_SUB = 'https://parkpilot.remco-dv.workers.dev/admin.html'; // VAPID-contact (Apple wil mailto: of https:)
const te = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const enc8 = (s: string): Bytes => new Uint8Array(te.encode(s));

export interface Vapid { pub: string; jwk: JsonWebKey; made: string }
export interface PushSub { endpoint: string; p256dh: string; auth: string; label: string; added_at: number }
export interface PushMessage { title: string; body: string; url?: string; tag?: string; badge?: number }
export interface PushResult { label: string; ok: boolean; status: number; gone: boolean; text: string }

const b64urlBytes = (s: string): Bytes =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64url = (bytes: Bytes): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const cat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

/** Het VAPID-sleutelpaar; met make = true wordt het gemaakt als het er nog niet is. */
export async function getVapid(env: Env, make = false): Promise<Vapid | null> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'push_vapid'").first<{ value: string }>();
  if (row) { try { return JSON.parse(row.value) as Vapid; } catch { /* kapot: opnieuw maken */ } }
  if (!make) return null;
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
  const v: Vapid = { pub: b64url(pub), jwk: (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey, made: new Date().toISOString() };
  // Bestaat hij intussen al (andere kopie van de Worker), dan die houden: een tweede sleutel breekt alle abonnementen.
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('push_vapid', ?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify(v)).run();
  return getVapid(env, false);
}

export async function listSubs(env: Env): Promise<PushSub[]> {
  const r = await env.DB.prepare('SELECT endpoint, p256dh, auth, label, added_at FROM admin_push_subs ORDER BY added_at').all<PushSub>();
  return r.results;
}

export async function addSub(env: Env, sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, label: unknown): Promise<boolean> {
  let ok = false;
  try { ok = typeof sub.endpoint === 'string' && new URL(sub.endpoint).protocol === 'https:'; } catch { ok = false; }
  const p256dh = sub.keys?.p256dh, auth = sub.keys?.auth;
  if (!ok || typeof p256dh !== 'string' || typeof auth !== 'string' || p256dh.length > 200 || auth.length > 100) return false;
  await env.DB.prepare(
    'INSERT INTO admin_push_subs (endpoint, p256dh, auth, label, added_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label',
  ).bind(sub.endpoint, p256dh, auth, String(label || 'Toestel').slice(0, 60), nowSec()).run();
  // Hooguit 10 toestellen: de oudste eruit.
  await env.DB.prepare('DELETE FROM admin_push_subs WHERE endpoint NOT IN (SELECT endpoint FROM admin_push_subs ORDER BY added_at DESC LIMIT 10)').run();
  return true;
}

export async function removeSub(env: Env, endpoint: string): Promise<void> {
  await env.DB.prepare('DELETE FROM admin_push_subs WHERE endpoint = ?').bind(endpoint).run();
}

async function vapidHeader(v: Vapid, endpoint: string): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown): string => b64url(enc8(JSON.stringify(o)));
  const data = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: PUSH_SUB })}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc8(data))); // r||s, zoals JWS wil
  return `vapid t=${data}.${b64url(sig)}, k=${v.pub}`;
}

/** RFC 8291: één aes128gcm-record voor de sleutels van het abonnement. */
async function encrypt(sub: PushSub, payload: string): Promise<Bytes> {
  const uaPub = b64urlBytes(sub.p256dh), authSecret = b64urlBytes(sub.auth);
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, cat(enc8('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc8('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, cat(enc8(payload), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct); // rs = 4096
}

async function sendOne(v: Vapid, sub: PushSub, msg: PushMessage & { at: string }): Promise<Omit<PushResult, 'label'>> {
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(v, sub.endpoint), TTL: String(PUSH_TTL_S), Urgency: 'high',
        'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
        ...(msg.tag ? { Topic: msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
      },
      body: await encrypt(sub, JSON.stringify(msg)),
    });
    const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text };
  } catch (e) {
    return { ok: false, status: 0, gone: false, text: e instanceof Error ? e.message : String(e) };
  }
}

/** Naar alle toestellen van de beheerder (of één endpoint). Abonnementen die de pushdienst niet meer kent, gaan eruit. */
export async function notifyAdmin(env: Env, msg: PushMessage, onlyEndpoint?: string): Promise<PushResult[]> {
  const v = await getVapid(env);
  if (!v) return [];
  const subs = (await listSubs(env)).filter((s) => !onlyEndpoint || s.endpoint === onlyEndpoint);
  if (!subs.length) return [];
  const full = { url: 'admin.html', ...msg, at: new Date().toISOString() };
  const results = await Promise.all(subs.map((s) => sendOne(v, s, full)));
  for (let i = 0; i < subs.length; i++) {
    if (results[i].gone) await removeSub(env, subs[i].endpoint);
    if (!results[i].ok) console.log('Push', subs[i].label, results[i].status, results[i].text);
  }
  return results.map((r, i) => ({ label: subs[i].label, ...r }));
}
