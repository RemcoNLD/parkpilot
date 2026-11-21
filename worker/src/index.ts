import {
  DEFAULT_PREFERENCES,
  GAMES,
  TRACKING_MODES,
  type GameId,
  type GameScoresResponse,
  type FavoriteDto,
  type HistoryResponse,
  type LiveStatus,
  type ParkInfo,
  type PreferencesDto,
  type RedeemResponse,
  type SortMode,
  type TrackingMode,
} from '../../packages/shared/src/index';
import { allowAttempt, authenticate, clientKey, createDevice, type Env } from './auth';
import { PARKS, findPark } from './parks';
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from './recovery';
import { UpstreamError, getEntities, getLive, getSchedule, resolveParkIds } from './themeparks';
import { buildShowDay } from './shows';
import { getTrackingMode, loadStates, setTrackingMode, track, trackAll, trackingActive } from './tracker';
import { addDays, errorJson, json, localDateStr, nowSec, startOfLocalDaySec } from './util';
import { APP_VERSION } from '../../packages/shared/src/version';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SORTS: SortMode[] = ['distance', 'wait', 'name'];

type UserLocRow = { entity_id: string; lat: number; lng: number; accuracy_m: number | null; updated_at: number };
const userLoc = (u: UserLocRow) => ({
  location: { lat: u.lat, lng: u.lng },
  locationSource: 'user' as const,
  locationAccuracy: u.accuracy_m,
  locationUpdatedAt: new Date(u.updated_at * 1000).toISOString(),
});

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---- Spelletje: hiscores ---------------------------------------------------------------------
const GAME_TOP = 10;
const GAME_MAX_SCORE = 9999;
/** Naam voor de hiscores: zonder stuurtekens, spaties samengevoegd, 1 tot 16 tekens. */
function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length >= 1 && chars.length <= 16 ? s : null;
}
type ScoreRow = { name: string; score: number; updated_at: number };
async function gameTop(env: Env, game: GameId): Promise<GameScoresResponse> {
  const rows = await env.DB.prepare('SELECT name, score, updated_at FROM game_scores WHERE game = ? ORDER BY score DESC, updated_at ASC LIMIT ?')
    .bind(game, GAME_TOP).all<ScoreRow>();
  return { game, top: rows.results.map((r) => ({ name: r.name, score: r.score, at: new Date(r.updated_at * 1000).toISOString() })) };
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  const [a, b, c] = parts;

  if (a === 'health' && method === 'GET') return json({ ok: true, version: APP_VERSION }, 200, { 'cache-control': 'no-store' });

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
      if (!data) return errorJson(502, 'park_not_found_upstream');
      // Kijkplekken van gebruikers invullen bij shows zonder locatie in de bron. Kort cachen, zodat een nieuwe plek snel bij iedereen staat.
      const rows = await env.DB.prepare('SELECT entity_id, lat, lng, accuracy_m, updated_at FROM user_locations WHERE park_id = ?')
        .bind(park.id).all<UserLocRow>().catch(() => ({ results: [] as UserLocRow[] }));
      const byId = new Map(rows.results.map((r) => [r.entity_id, r]));
      const entities = data.entities.map((e) => {
        const u = byId.get(e.id);
        return u && !e.location ? { ...e, ...userLoc(u) } : e;
      });
      return json({ ...data, entities }, 200, { 'cache-control': 'public, max-age=120' });
    }
    if (c === 'live') {
      const force = url.searchParams.get('fresh') === '1';
      const raw = await getLive(park, force);
      if (!raw) return errorJson(502, 'park_not_found_upstream');
      const states = await loadStates(env, park.id).catch(() => new Map());
      // Alleen lezen: het wegschrijven van wijzigingen doet de cron (elke 5 min). Dat bespaart schrijfacties in D1.
      const { live } = track(env, park.id, raw, states);
      return json(live, 200, { 'cache-control': force ? 'no-store' : 'public, max-age=20' });
    }
    if (c === 'shows') {
      const date = url.searchParams.get('date') ?? '';
      const today = localDateStr(park.timezone, Date.now());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, 13)) return errorJson(400, 'invalid_date');
      const data = await buildShowDay(env, park, date);
      return data ? json(data, 200, { 'cache-control': 'public, max-age=120' }) : errorJson(502, 'park_not_found_upstream');
    }
    if (c === 'schedule') {
      const data = await getSchedule(park);
      return data
        ? json(data, 200, { 'cache-control': 'public, max-age=600' })
        : errorJson(502, 'park_not_found_upstream');
    }
    if (c === 'history' && parts[3] && ID_PATTERN.test(parts[3])) {
      const hours = Math.min(48, Math.max(1, Number(url.searchParams.get('hours')) || 12));
      const from = url.searchParams.get('since') === 'today'
        ? Math.max(nowSec() - 48 * 3600, startOfLocalDaySec(park.timezone))
        : nowSec() - hours * 3600;
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

  // ---- Spelletje: hiscores lezen (publiek) --------------------------------------------------
  if (a === 'game' && c === 'scores' && method === 'GET') {
    if (!(GAMES as readonly string[]).includes(b ?? '')) return errorJson(404, 'unknown_game');
    return json(await gameTop(env, b as GameId), 200, { 'cache-control': 'public, max-age=15' });
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
      const body = await readBody(req);
      let display: string;
      let normalized: string;
      if (typeof body?.code === 'string') {
        // Zelfgekozen code, bijvoorbeeld "1234". Korter betekent makkelijker te raden; de app waarschuwt daarvoor.
        const custom = normalizeRecoveryCode(body.code);
        if (!custom) return errorJson(400, 'invalid_code');
        normalized = custom;
        display = custom;
      } else {
        display = generateRecoveryCode();
        normalized = display.replace(/-/g, '');
      }
      const hash = await hashRecoveryCode(normalized);
      const taken = await env.DB.prepare('SELECT id FROM profiles WHERE recovery_hash = ? AND id != ?')
        .bind(hash, auth.profileId)
        .first<{ id: string }>();
      if (taken) return errorJson(409, 'code_taken');
      await env.DB.prepare('UPDATE profiles SET recovery_hash = ?, recovery_created_at = ? WHERE id = ?')
        .bind(hash, nowSec(), auth.profileId)
        .run();
      return json({ code: display });
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

  // ---- Kijkplek van een show (gedeeld met iedereen) -----------------------------------------
  if (a === 'locations' && b && c && ID_PATTERN.test(c)) {
    const park = findPark(b);
    if (!park) return errorJson(404, 'unknown_park');
    const data = await getEntities(park);
    const entity = data?.entities.find((e) => e.id === c);
    if (!entity) return errorJson(404, 'unknown_entity');
    // Alleen shows waarvoor de bron zelf geen locatie heeft; een bronlocatie overschrijven we niet.
    if (entity.type !== 'show' || entity.location) return errorJson(409, 'has_source_location');
    if (!(await allowAttempt(env, `loc:${auth.profileId}`, 30))) return errorJson(429, 'rate_limited');
    if (method === 'PUT') {
      const body = await readBody(req);
      const lat = body?.lat, lng = body?.lng, acc = body?.accuracy;
      // Bestaande plek alleen vervangen als de app expliciet bevestigt (replace: true); anders 409 met de huidige plek.
      if (body?.replace !== true) {
        const cur = await env.DB.prepare('SELECT entity_id, lat, lng, accuracy_m, updated_at FROM user_locations WHERE park_id = ? AND entity_id = ?')
          .bind(park.id, c).first<UserLocRow>();
        if (cur) return json({ error: 'location_exists', current: userLoc(cur) }, 409);
      }
      if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return errorJson(400, 'invalid_location');
      // Binnen 3 km van het park: voorkomt een plek die per ongeluk thuis wordt opgeslagen.
      if (haversine(park.center, { lat, lng }) > 3000) return errorJson(400, 'too_far_from_park');
      const accuracy = typeof acc === 'number' && Number.isFinite(acc) && acc >= 0 ? Math.round(acc) : null;
      await env.DB.prepare(
        'INSERT INTO user_locations (park_id, entity_id, lat, lng, accuracy_m, profile_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(park_id, entity_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, ' +
          'profile_id = excluded.profile_id, updated_at = excluded.updated_at',
      ).bind(park.id, c, lat, lng, accuracy, auth.profileId, nowSec()).run();
      return json({ ok: true, ...userLoc({ entity_id: c, lat, lng, accuracy_m: accuracy, updated_at: nowSec() }) });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM user_locations WHERE park_id = ? AND entity_id = ?').bind(park.id, c).run();
      return json({ ok: true });
    }
    return errorJson(405, 'method_not_allowed');
  }

  // ---- Spelletje: score insturen. Alleen de beste score per profiel + naam blijft bewaard. -----
  if (a === 'game' && c === 'scores' && method === 'POST') {
    if (!(GAMES as readonly string[]).includes(b ?? '')) return errorJson(404, 'unknown_game');
    const game = b as GameId;
    const body = await readBody(req);
    const name = cleanName(body?.name);
    const score = body?.score;
    if (!name) return errorJson(400, 'invalid_name');
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > GAME_MAX_SCORE) return errorJson(400, 'invalid_score');
    if (!(await allowAttempt(env, `game:${auth.profileId}`, 60))) return errorJson(429, 'rate_limited');
    const now = nowSec();
    await env.DB.prepare(
      'INSERT INTO game_scores (game, profile_id, name, score, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(game, profile_id, name) DO UPDATE SET updated_at = CASE WHEN excluded.score > score THEN excluded.updated_at ELSE updated_at END, ' +
        'score = MAX(score, excluded.score)',
    ).bind(game, auth.profileId, name, score, now).run();
    const mine = await env.DB.prepare('SELECT score, updated_at FROM game_scores WHERE game = ? AND profile_id = ? AND name = ?')
      .bind(game, auth.profileId, name).first<{ score: number; updated_at: number }>();
    const best = mine?.score ?? score;
    const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM game_scores WHERE game = ? AND (score > ? OR (score = ? AND updated_at < ?))')
      .bind(game, best, best, mine?.updated_at ?? now).first<{ n: number }>();
    return json({ ...(await gameTop(env, game)), rank: (above?.n ?? 0) + 1, best });
  }

  if (a === 'settings' && b === 'tracking') {
    if (method === 'GET') {
      const mode = await getTrackingMode(env);
      const active: Record<string, boolean> = {};
      for (const p of PARKS) active[p.id] = await trackingActive(p, mode);
      return json({ mode, active });
    }
    if (method === 'PUT') {
      const body = (await readBody(req)) as { mode?: unknown } | null;
      if (!body || !TRACKING_MODES.includes(body.mode as TrackingMode)) return errorJson(400, 'invalid_mode');
      await setTrackingMode(env, body.mode as TrackingMode);
      const mode = body.mode as TrackingMode;
      const active: Record<string, boolean> = {};
      for (const p of PARKS) active[p.id] = await trackingActive(p, mode);
      return json({ mode, active });
    }
    return errorJson(405, 'method_not_allowed');
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
