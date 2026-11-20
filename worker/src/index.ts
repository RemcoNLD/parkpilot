import {
  DEFAULT_PREFERENCES,
  type FavoriteDto,
  type HistoryResponse,
  type LiveStatus,
  type ParkInfo,
  type PreferencesDto,
  type RedeemResponse,
  type SortMode,
} from '../../packages/shared/src/index';
import { allowAttempt, authenticate, clientKey, createDevice, type Env } from './auth';
import { PARKS, findPark } from './parks';
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from './recovery';
import { UpstreamError, getEntities, getLive, getSchedule, resolveParkIds } from './themeparks';
import { loadStates, runStatements, track, trackAll } from './tracker';
import { errorJson, json, nowSec } from './util';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SORTS: SortMode[] = ['distance', 'wait', 'name'];

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const [a, b, c] = parts;

  if (a === 'health' && method === 'GET') return json({ ok: true });

  // ---- Parken en live-data (publiek, geen profiel nodig) ------------------------------------
  if (a === 'parks' && method === 'GET') {
    if (!b) {
      const ids = await resolveParkIds().catch(() => new Map<string, string>());
      const parks: ParkInfo[] = PARKS.map((p) => ({
        id: p.id,
        name: p.name,
        shortName: p.shortName,
        timezone: p.timezone,
        center: p.center,
        available: ids.has(p.id),
      }));
      return json(parks, 200, { 'cache-control': 'public, max-age=3600' });
    }
    const park = findPark(b);
    if (!park) return errorJson(404, 'unknown_park');
    if (c === 'entities') {
      const data = await getEntities(park);
      return data
        ? json(data, 200, { 'cache-control': 'public, max-age=3600' })
        : errorJson(502, 'park_not_found_upstream');
    }
    if (c === 'live') {
      const raw = await getLive(park);
      if (!raw) return errorJson(502, 'park_not_found_upstream');
      const states = await loadStates(env, park.id).catch(() => new Map());
      const { live, statements } = track(env, park.id, raw, states);
      if (statements.length) ctx.waitUntil(runStatements(env, statements).catch((e) => console.error(e)));
      return json(live, 200, { 'cache-control': 'public, max-age=20' });
    }
    if (c === 'schedule') {
      const data = await getSchedule(park);
      return data
        ? json(data, 200, { 'cache-control': 'public, max-age=600' })
        : errorJson(502, 'park_not_found_upstream');
    }
    if (c === 'history' && parts[3] && ID_PATTERN.test(parts[3])) {
      const hours = Math.min(48, Math.max(1, Number(url.searchParams.get('hours')) || 12));
      const from = nowSec() - hours * 3600;
      type Row = { at: number; wait: number | null; status: LiveStatus };
      const [inWindow, base] = await Promise.all([
        env.DB.prepare('SELECT at, wait, status FROM wait_log WHERE park_id = ? AND entity_id = ? AND at >= ? ORDER BY at')
          .bind(park.id, parts[3], from).all<Row>(),
        env.DB.prepare('SELECT at, wait, status FROM wait_log WHERE park_id = ? AND entity_id = ? AND at < ? ORDER BY at DESC LIMIT 1')
          .bind(park.id, parts[3], from).first<Row>(),
      ]);
      const rows = [...(base ? [base] : []), ...inWindow.results].map((r) => ({
        at: new Date(r.at * 1000).toISOString(), wait: r.wait, status: r.status,
      }));
      const out: HistoryResponse = { entityId: parts[3], from: new Date(from * 1000).toISOString(), rows };
      return json(out, 200, { 'cache-control': 'public, max-age=30' });
    }
    return errorJson(404, 'not_found');
  }

  // ---- Profiel aanmaken en koppelen --------------------------------------------------------
  if (a === 'profile') {
    if (!b && method === 'POST') {
      if (!(await allowAttempt(env, await clientKey(req, 'create'), 20))) return errorJson(429, 'rate_limited');
      const profileId = crypto.randomUUID();
      const now = nowSec();
      await env.DB.prepare('INSERT INTO profiles (id, created_at, last_seen_at) VALUES (?, ?, ?)')
        .bind(profileId, now, now)
        .run();
      return json(await createDevice(env, profileId), 201);
    }

    if (b === 'redeem' && method === 'POST') {
      // Streng begrensd: de code is het enige wat tussen een vreemde en jouw lijstje zit.
      if (!(await allowAttempt(env, await clientKey(req, 'redeem'), 10))) return errorJson(429, 'rate_limited');
      const body = await readBody(req);
      const code = typeof body?.code === 'string' ? normalizeRecoveryCode(body.code) : null;
      if (!code) return errorJson(400, 'invalid_code');
      const profile = await env.DB.prepare('SELECT id FROM profiles WHERE recovery_hash = ?')
        .bind(await hashRecoveryCode(code))
        .first<{ id: string }>();
      if (!profile) return errorJson(404, 'invalid_code');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM favorites WHERE profile_id = ?')
        .bind(profile.id)
        .first<{ n: number }>();
      const creds = await createDevice(env, profile.id);
      const out: RedeemResponse = { ...creds, favoriteCount: count?.n ?? 0 };
      return json(out);
    }

    if (b === 'recovery-code' && method === 'POST') {
      const auth = await authenticate(req, env);
      if (!auth) return errorJson(401, 'unauthorized');
      const code = generateRecoveryCode();
      const normalized = code.replace(/-/g, '');
      await env.DB.prepare('UPDATE profiles SET recovery_hash = ?, recovery_created_at = ? WHERE id = ?')
        .bind(await hashRecoveryCode(normalized), nowSec(), auth.profileId)
        .run();
      return json({ code });
    }
    return errorJson(404, 'not_found');
  }

  // ---- Alles hieronder hoort bij een profiel -----------------------------------------------
  const auth = await authenticate(req, env);
  if (!auth) return errorJson(401, 'unauthorized');

  if (a === 'favorites') {
    if (!b && method === 'GET') {
      const parkId = url.searchParams.get('parkId');
      const rows = parkId
        ? await env.DB.prepare('SELECT park_id, entity_id, type FROM favorites WHERE profile_id = ? AND park_id = ?')
            .bind(auth.profileId, parkId)
            .all<{ park_id: string; entity_id: string; type: 'attraction' | 'show' }>()
        : await env.DB.prepare('SELECT park_id, entity_id, type FROM favorites WHERE profile_id = ?')
            .bind(auth.profileId)
            .all<{ park_id: string; entity_id: string; type: 'attraction' | 'show' }>();
      const out: FavoriteDto[] = rows.results.map((r) => ({ parkId: r.park_id, entityId: r.entity_id, type: r.type }));
      return json(out);
    }
    if (b && c && ID_PATTERN.test(c) && findPark(b)) {
      if (method === 'PUT') {
        const body = await readBody(req);
        if (body?.type !== 'attraction' && body?.type !== 'show') return errorJson(400, 'invalid_type');
        await env.DB.prepare(
          'INSERT INTO favorites (profile_id, park_id, entity_id, type, created_at) VALUES (?, ?, ?, ?, ?) ' +
            'ON CONFLICT(profile_id, park_id, entity_id) DO UPDATE SET type = excluded.type',
        )
          .bind(auth.profileId, b, c, body.type, nowSec())
          .run();
        return json({ ok: true });
      }
      if (method === 'DELETE') {
        await env.DB.prepare('DELETE FROM favorites WHERE profile_id = ? AND park_id = ? AND entity_id = ?')
          .bind(auth.profileId, b, c)
          .run();
        return json({ ok: true });
      }
    }
    return errorJson(404, 'not_found');
  }

  if (a === 'preferences' && b && findPark(b)) {
    if (method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT sort, arrival_margin_min, walking_speed_kmh FROM preferences WHERE profile_id = ? AND park_id = ?',
      )
        .bind(auth.profileId, b)
        .first<{ sort: SortMode; arrival_margin_min: number; walking_speed_kmh: number }>();
      const out: PreferencesDto = row
        ? { sort: row.sort, arrivalMarginMin: row.arrival_margin_min, walkingSpeedKmh: row.walking_speed_kmh }
        : DEFAULT_PREFERENCES;
      return json(out);
    }
    if (method === 'PUT') {
      const body = await readBody(req);
      const sort = body?.sort as SortMode;
      const margin = body?.arrivalMarginMin;
      const speed = body?.walkingSpeedKmh;
      if (
        !SORTS.includes(sort) ||
        typeof margin !== 'number' || !Number.isInteger(margin) || margin < 0 || margin > 120 ||
        typeof speed !== 'number' || !(speed >= 2 && speed <= 8)
      ) {
        return errorJson(400, 'invalid_preferences');
      }
      await env.DB.prepare(
        'INSERT INTO preferences (profile_id, park_id, sort, arrival_margin_min, walking_speed_kmh, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(profile_id, park_id) DO UPDATE SET ' +
          'sort = excluded.sort, arrival_margin_min = excluded.arrival_margin_min, ' +
          'walking_speed_kmh = excluded.walking_speed_kmh, updated_at = excluded.updated_at',
      )
        .bind(auth.profileId, b, sort, margin, speed, nowSec())
        .run();
      return json({ ok: true });
    }
  }

  return errorJson(404, 'not_found');
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(trackAll(env));
  },
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (err) {
      if (err instanceof UpstreamError) {
        console.error(err.message);
        return errorJson(502, 'upstream_unavailable');
      }
      console.error(err);
      return errorJson(500, 'internal_error');
    }
  },
} satisfies ExportedHandler<Env>;
