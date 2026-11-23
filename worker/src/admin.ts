// Beheer-API voor de beheer-app (apps/web/public/admin.html), sinds 0.23.0. Alles onder /api/admin/…
// Inloggen met het beheerderswachtwoord als Bearer-token. Het wachtwoord staat niet in de repo, alleen de SHA-256
// van "parkpilot-admin:<wachtwoord>" (ADMIN_HASH). Een Worker-geheim ADMIN_PASSWORD (Cloudflare-dashboard) gaat voor,
// zodat het wachtwoord te wijzigen is zonder codewijziging.
//   GET  /api/admin/review               te controleren inzendingen + de laatst beslisten
//   POST /api/admin/review/:id           {action: "approve" | "reject"}
//   GET  /api/admin/push                 publieke sleutel + toestellen; POST {action: subscribe|unsubscribe|test}
import { APP_VERSION } from '../../packages/shared/src/version';
import type { EntityInfo, LatLng } from '../../packages/shared/src/index';
import type { Env } from './auth';
import { findPark } from './parks';
import { addSub, getVapid, listSubs, notifyAdmin, removeSub } from './push';
import { haversine } from './locations';
import { getEntities } from './themeparks';
import { errorJson, json, nowSec, sha256Hex, timingSafeEqual } from './util';

export const ADMIN_HASH = '58592411ccd4b6290336996a92f7b84616a004d353875bb50710cea448a9775e';
const FAIL_LIMIT = 10; // mislukte pogingen per uur per IP

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { const b = await req.json(); return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}; } catch { return {}; }
}

async function isAdmin(req: Request, env: Env): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!m) return false;
  const pw = m[1].trim().toLowerCase();
  if (env.ADMIN_PASSWORD) return timingSafeEqual(pw, env.ADMIN_PASSWORD.trim().toLowerCase());
  return timingSafeEqual(await sha256Hex(`parkpilot-admin:${pw}`), ADMIN_HASH);
}

interface SubRow {
  id: number; park_id: string; entity_id: string; kind: 'new' | 'replace' | 'delete'; lat: number | null; lng: number | null;
  accuracy_m: number | null; profile_id: string; created_at: number; status: string; flags: string; dist_m: number | null;
  prev_lat: number | null; prev_lng: number | null; prev_accuracy_m: number | null; decided_at: number | null;
}
interface CurRow { park_id: string; entity_id: string; lat: number; lng: number; accuracy_m: number | null; updated_at: number; confirmed: number }

const iso = (s: number | null): string | null => (s ? new Date(s * 1000).toISOString() : null);

async function reviewList(env: Env): Promise<unknown> {
  const pending = (await env.DB.prepare("SELECT * FROM location_submissions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100").all<SubRow>()).results;
  const recent = (await env.DB.prepare("SELECT * FROM location_submissions WHERE status IN ('approved', 'rejected') ORDER BY decided_at DESC LIMIT 30").all<SubRow>()).results;
  const all = [...pending, ...recent];
  const parks = new Map<string, EntityInfo[]>();
  for (const pid of new Set(all.map((s) => s.park_id))) {
    const p = findPark(pid);
    const data = p ? await getEntities(p).catch(() => null) : null;
    parks.set(pid, data?.entities ?? []);
  }
  const curs = (await env.DB.prepare('SELECT park_id, entity_id, lat, lng, accuracy_m, updated_at, confirmed FROM user_locations').all<CurRow>()).results;
  const curBy = new Map(curs.map((c) => [`${c.park_id}/${c.entity_id}`, c]));
  // Wie: aantal inzendingen van die persoon, en de naam bij het spelletje als die er is (enige herkenbare naam).
  const people = new Map<string, { n: number; ok: number; name: string | null }>();
  for (const pid of new Set(all.map((s) => s.profile_id))) {
    const c = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS ok FROM location_submissions WHERE profile_id = ?")
      .bind(pid).first<{ n: number; ok: number | null }>();
    const g = await env.DB.prepare('SELECT name FROM game_scores WHERE profile_id = ? ORDER BY updated_at DESC LIMIT 1').bind(pid).first<{ name: string }>();
    people.set(pid, { n: c?.n ?? 0, ok: c?.ok ?? 0, name: g?.name ?? null });
  }
  const item = (s: SubRow) => {
    const ents = parks.get(s.park_id) ?? [];
    const ent = ents.find((e) => e.id === s.entity_id);
    const cur = curBy.get(`${s.park_id}/${s.entity_id}`);
    const at: LatLng | null = s.lat !== null && s.lng !== null ? { lat: s.lat, lng: s.lng } : s.prev_lat !== null && s.prev_lng !== null ? { lat: s.prev_lat, lng: s.prev_lng } : null;
    const nearby = at ? ents.filter((e) => e.location && e.locationSource !== 'user')
      .map((e) => ({ name: e.name, type: e.type, lat: e.location!.lat, lng: e.location!.lng, d: Math.round(haversine(at, e.location!)) }))
      .sort((a, b) => a.d - b.d).slice(0, 6) : [];
    let flags: string[] = [];
    try { flags = JSON.parse(s.flags); } catch { flags = []; }
    const who = people.get(s.profile_id);
    return {
      id: s.id, kind: s.kind, status: s.status, parkId: s.park_id, park: findPark(s.park_id)?.shortName ?? s.park_id,
      entityId: s.entity_id, name: ent?.name ?? s.entity_id,
      at: iso(s.created_at), decidedAt: iso(s.decided_at),
      lat: s.lat, lng: s.lng, accuracy: s.accuracy_m, flags, dist: s.dist_m,
      prev: s.prev_lat !== null && s.prev_lng !== null ? { lat: s.prev_lat, lng: s.prev_lng, accuracy: s.prev_accuracy_m } : null,
      current: cur ? { lat: cur.lat, lng: cur.lng, accuracy: cur.accuracy_m, confirmed: cur.confirmed === 1, at: iso(cur.updated_at) } : null,
      who: { tag: s.profile_id.slice(0, 4), name: who?.name ?? null, submissions: who?.n ?? 0, approved: who?.ok ?? 0 },
      nearby,
    };
  };
  return { version: APP_VERSION, pending: pending.map(item), recent: recent.map(item), confirmedCount: curs.filter((c) => c.confirmed === 1).length, locationCount: curs.length };
}

async function decide(env: Env, id: number, action: string): Promise<Response> {
  const s = await env.DB.prepare('SELECT * FROM location_submissions WHERE id = ?').bind(id).first<SubRow>();
  if (!s) return errorJson(404, 'not_found');
  if (s.status !== 'pending') return errorJson(409, 'already_decided');
  if (action !== 'approve' && action !== 'reject') return errorJson(400, 'invalid_action');
  const now = nowSec();
  const cur = await env.DB.prepare('SELECT park_id, entity_id, lat, lng, accuracy_m, updated_at, confirmed FROM user_locations WHERE park_id = ? AND entity_id = ?')
    .bind(s.park_id, s.entity_id).first<CurRow>();
  const isLive = !!cur && s.lat !== null && cur.lat === s.lat && cur.lng === s.lng; // deze inzending is de plek die nu in gebruik is
  if (action === 'approve') {
    if (s.kind === 'delete') {
      await env.DB.prepare('DELETE FROM user_locations WHERE park_id = ? AND entity_id = ?').bind(s.park_id, s.entity_id).run();
    } else if (s.kind === 'new' && isLive) {
      await env.DB.prepare('UPDATE user_locations SET confirmed = 1 WHERE park_id = ? AND entity_id = ?').bind(s.park_id, s.entity_id).run();
    } else {
      // Vervangen, of een oude "nieuw" die intussen niet meer in gebruik was: deze plek wordt de bevestigde plek.
      await env.DB.prepare(
        'INSERT INTO user_locations (park_id, entity_id, lat, lng, accuracy_m, profile_id, updated_at, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ' +
          'ON CONFLICT(park_id, entity_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, ' +
          'profile_id = excluded.profile_id, updated_at = excluded.updated_at, confirmed = 1',
      ).bind(s.park_id, s.entity_id, s.lat, s.lng, s.accuracy_m, s.profile_id, now).run();
    }
  } else if (s.kind === 'new' && isLive && cur?.confirmed !== 1) {
    // Afgewezen nieuwe plek die al in gebruik was: weer weg.
    await env.DB.prepare('DELETE FROM user_locations WHERE park_id = ? AND entity_id = ?').bind(s.park_id, s.entity_id).run();
  }
  await env.DB.prepare('UPDATE location_submissions SET status = ?, decided_at = ? WHERE id = ?')
    .bind(action === 'approve' ? 'approved' : 'rejected', now, id).run();
  return json({ ok: true });
}

export async function handleAdmin(req: Request, env: Env, parts: string[]): Promise<Response> {
  const fk = `admin-fail:${await sha256Hex(req.headers.get('cf-connecting-ip') ?? 'unknown')}`;
  const fails = await env.DB.prepare('SELECT window_start, count FROM rate_limits WHERE key = ?').bind(fk).first<{ window_start: number; count: number }>();
  if (fails && nowSec() - fails.window_start < 3600 && fails.count >= FAIL_LIMIT) return errorJson(429, 'rate_limited');
  if (!(await isAdmin(req, env))) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET ' +
        'count = CASE WHEN ? - window_start >= 3600 THEN 1 ELSE count + 1 END, window_start = CASE WHEN ? - window_start >= 3600 THEN ? ELSE window_start END',
    ).bind(fk, nowSec(), nowSec(), nowSec(), nowSec()).run();
    return errorJson(401, 'unauthorized');
  }
  const [, what, id] = parts; // parts[0] = 'admin'
  const noStore = { 'cache-control': 'no-store' };
  if (what === 'review' && !id && req.method === 'GET') return json(await reviewList(env), 200, noStore);
  if (what === 'review' && id && req.method === 'POST') {
    if (!/^\d{1,10}$/.test(id)) return errorJson(400, 'invalid_id');
    const body = await readJson(req);
    return decide(env, Number(id), String(body.action ?? ''));
  }
  if (what === 'push') {
    const pub = (subs: { endpoint: string; label: string; added_at: number }[]) =>
      subs.map((s) => ({ endpoint: s.endpoint, label: s.label, added: iso(s.added_at) }));
    if (req.method === 'GET') {
      const v = await getVapid(env, true);
      return json({ publicKey: v?.pub ?? null, subs: pub(await listSubs(env)) }, 200, noStore);
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'subscribe') {
        if (!(await addSub(env, (body.sub ?? {}) as Parameters<typeof addSub>[1], body.label))) return errorJson(400, 'invalid_subscription');
        return json({ ok: true, subs: pub(await listSubs(env)) });
      }
      if (body.action === 'unsubscribe' && typeof body.endpoint === 'string') {
        await removeSub(env, body.endpoint);
        return json({ ok: true, subs: pub(await listSubs(env)) });
      }
      if (body.action === 'test') {
        const results = await notifyAdmin(env, { title: 'ParkPilot', body: 'Testbericht: pushberichten werken op dit toestel.', tag: 'test' },
          typeof body.endpoint === 'string' ? body.endpoint : undefined);
        return json({ ok: results.length > 0 && results.every((r) => r.ok), results });
      }
      return errorJson(400, 'invalid_action');
    }
  }
  return errorJson(404, 'not_found');
}

/** Vanuit de cron: één pushbericht als er een nieuwe versie live staat. */
export async function notifyNewVersion(env: Env): Promise<void> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'notified_version'").first<{ value: string }>();
  if (row?.value === APP_VERSION) return;
  await env.DB.prepare("INSERT INTO app_settings (key, value) VALUES ('notified_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(APP_VERSION).run();
  if (!row) return; // allereerste keer: geen bericht, alleen onthouden
  const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM location_submissions WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0;
  await notifyAdmin(env, {
    title: `ParkPilot ${APP_VERSION} staat live`,
    body: n ? `${n} ${n === 1 ? 'kijkplek' : 'kijkplekken'} te controleren.` : 'Open de app om de nieuwe versie te laden.',
    url: n ? 'admin.html#review' : 'admin.html', tag: 'version',
  });
}

