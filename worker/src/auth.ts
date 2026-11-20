import { nowSec, randomHex, sha256Hex, timingSafeEqual } from './util';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export interface AuthContext {
  profileId: string;
  deviceId: string;
}

const BEARER = /^Bearer ([0-9a-f-]{36})\.([0-9a-f]{64})$/i;
const TOUCH_AFTER_SEC = 3600; // last_seen hooguit eens per uur bijwerken, om schrijfacties te sparen

export async function authenticate(req: Request, env: Env): Promise<AuthContext | null> {
  const m = BEARER.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const [, deviceId, token] = m;

  const row = await env.DB.prepare('SELECT profile_id, token_hash, last_seen_at FROM devices WHERE id = ?')
    .bind(deviceId)
    .first<{ profile_id: string; token_hash: string; last_seen_at: number }>();
  if (!row) return null;
  if (!timingSafeEqual(row.token_hash, await sha256Hex(token))) return null;

  const now = nowSec();
  if (now - row.last_seen_at > TOUCH_AFTER_SEC) {
    await env.DB.batch([
      env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, deviceId),
      env.DB.prepare('UPDATE profiles SET last_seen_at = ? WHERE id = ?').bind(now, row.profile_id),
    ]);
  }
  return { profileId: row.profile_id, deviceId };
}

/** Maakt een nieuw apparaat bij een bestaand profiel en geeft de inloggegevens terug. */
export async function createDevice(env: Env, profileId: string): Promise<{ deviceId: string; token: string }> {
  const deviceId = crypto.randomUUID();
  const token = randomHex(32);
  const now = nowSec();
  await env.DB.prepare(
    'INSERT INTO devices (id, profile_id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(deviceId, profileId, await sha256Hex(token), now, now)
    .run();
  return { deviceId, token };
}

/** Telt een poging; geeft false zodra de grens in het tijdvenster is bereikt. */
export async function allowAttempt(env: Env, key: string, limit: number, windowSec = 3600): Promise<boolean> {
  const now = nowSec();
  const row = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ window_start: number; count: number }>();
  if (!row || now - row.window_start >= windowSec) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ' +
        'ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1',
    )
      .bind(key, now)
      .run();
    return true;
  }
  if (row.count >= limit) return false;
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

export async function clientKey(req: Request, scope: string): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  return `${scope}:${await sha256Hex(ip)}`;
}
