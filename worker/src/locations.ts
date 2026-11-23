// Kijkplekken van shows zonder bronlocatie (sinds 0.12.0), met controle door de beheerder (sinds 0.23.0).
//
// Regels bij opslaan (PUT /api/locations/:park/:entity):
//   - gps-nauwkeurigheid verplicht en hooguit LOC_MAX_ACCURACY_M; boven LOC_WEAK_M krijgt de inzending de vlag "weak";
//   - de plek moet in het park liggen: binnen de omhullende van alle bronlocaties van dat park plus LOC_EDGE_M
//     (vlag "edge" als hij buiten de omhullende maar binnen die rand ligt);
//   - nog geen plek: meteen in gebruik, onbevestigd, en naar de beheerder;
//   - wel een plek: pas na akkoord van de beheerder (de oude blijft in gebruik). Vlag "far" boven LOC_FAR_M afstand.
//     Uitzondering: je eigen, nog onbevestigde plek mag je zelf meteen aanpassen of weghalen;
//   - verwijderen werkt hetzelfde als vervangen.
// Elke inzending staat in location_submissions (ook de geschiedenis) en geeft een pushbericht aan de beheerder.
import type { EntityInfo, LatLng } from '../../packages/shared/src/index';
import type { Env } from './auth';
import type { ParkConfig } from './parks';
import { notifyAdmin } from './push';
import { json, errorJson, nowSec } from './util';

export const LOC_MAX_ACCURACY_M = 50;
export const LOC_WEAK_M = 25;
export const LOC_EDGE_M = 150;
export const LOC_FAR_M = 150;
const AREA_POINT_MAX_M = 1500; // bronlocaties verder dan dit van het parkcentrum tellen niet mee (uitschieters)

export function haversine(a: LatLng, b: LatLng): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// ---- Ligt een punt in het park? -------------------------------------------------------------
type XY = [number, number];
const toXY = (o: LatLng, p: LatLng): XY => [(p.lng - o.lng) * 111_320 * Math.cos((o.lat * Math.PI) / 180), (p.lat - o.lat) * 110_540];
const cross = (o: XY, a: XY, b: XY): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convexe omhulling (monotone chain), tegen de klok in. */
function hull(pts: XY[]): XY[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lower: XY[] = [], upper: XY[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function segDist(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Hoe ver (meter) ligt het punt buiten het park? 0 = erbinnen. Het park = omhulling van de bronlocaties van alle
 * attracties en shows (binnen 1,5 km van het centrum). Te weinig punten: afstand tot het centrum min 1,5 km.
 */
export function outsideParkM(park: ParkConfig, entities: EntityInfo[], p: LatLng): number {
  const src = entities
    .filter((e) => e.location && e.locationSource !== 'user' && haversine(park.center, e.location) <= AREA_POINT_MAX_M)
    .map((e) => toXY(park.center, e.location as LatLng));
  const h = hull(src);
  if (h.length < 3) return Math.max(0, haversine(park.center, p) - AREA_POINT_MAX_M);
  const q = toXY(park.center, p);
  let inside = true;
  for (let i = 0; i < h.length; i++) if (cross(h[i], h[(i + 1) % h.length], q) < 0) { inside = false; break; }
  if (inside) return 0;
  let d = Infinity;
  for (let i = 0; i < h.length; i++) d = Math.min(d, segDist(q, h[i], h[(i + 1) % h.length]));
  return d;
}

// ---- Opslaan, vervangen, verwijderen ---------------------------------------------------------
export interface UserLocRow { entity_id: string; lat: number; lng: number; accuracy_m: number | null; updated_at: number; confirmed: number; profile_id: string }
export const USER_LOC_COLS = 'entity_id, lat, lng, accuracy_m, updated_at, confirmed, profile_id';
export const userLoc = (u: Pick<UserLocRow, 'lat' | 'lng' | 'accuracy_m' | 'updated_at' | 'confirmed'>) => ({
  location: { lat: u.lat, lng: u.lng },
  locationSource: 'user' as const,
  locationAccuracy: u.accuracy_m,
  locationUpdatedAt: new Date(u.updated_at * 1000).toISOString(),
  locationConfirmed: u.confirmed === 1,
});

async function pendingCount(env: Env): Promise<number> {
  return (await env.DB.prepare("SELECT COUNT(*) AS n FROM location_submissions WHERE status = 'pending'").first<{ n: number }>())?.n ?? 0;
}

/** Pushbericht aan de beheerder over een nieuwe inzending (op de achtergrond). */
async function notifySubmission(env: Env, park: ParkConfig, entity: EntityInfo, kind: 'new' | 'replace' | 'delete', detail: string): Promise<void> {
  const n = await pendingCount(env);
  const what = kind === 'new' ? 'Nieuwe kijkplek' : kind === 'replace' ? 'Kijkplek vervangen' : 'Kijkplek verwijderen';
  await notifyAdmin(env, {
    title: `${what}: ${entity.name}`,
    body: `${park.shortName}${detail ? ` · ${detail}` : ''}${n > 1 ? ` · ${n} te controleren` : ''}`,
    url: 'admin.html#review', tag: 'review', badge: n,
  });
}

async function supersedeOwn(env: Env, park: ParkConfig, entityId: string, profileId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE location_submissions SET status = 'superseded', decided_at = ? WHERE park_id = ? AND entity_id = ? AND profile_id = ? AND status = 'pending'",
  ).bind(nowSec(), park.id, entityId, profileId).run();
}

export async function putLocation(env: Env, ctx: ExecutionContext, park: ParkConfig, entities: EntityInfo[], entity: EntityInfo,
  profileId: string, body: Record<string, unknown> | null): Promise<Response> {
  const cur = await env.DB.prepare(`SELECT ${USER_LOC_COLS} FROM user_locations WHERE park_id = ? AND entity_id = ?`)
    .bind(park.id, entity.id).first<UserLocRow>();
  // Bestaande plek alleen vervangen als de app expliciet bevestigt (replace: true); anders 409 met de huidige plek.
  if (cur && body?.replace !== true) return json({ error: 'location_exists', current: userLoc(cur) }, 409);
  const lat = body?.lat, lng = body?.lng, acc = body?.accuracy;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return errorJson(400, 'invalid_location');
  if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0 || acc > LOC_MAX_ACCURACY_M) return json({ error: 'low_accuracy', max: LOC_MAX_ACCURACY_M }, 400);
  const outside = outsideParkM(park, entities, { lat, lng });
  if (outside > LOC_EDGE_M) return errorJson(400, 'outside_park');
  const accuracy = Math.round(acc);
  const flags: string[] = [];
  if (outside > 0) flags.push('edge');
  if (accuracy > LOC_WEAK_M) flags.push('weak');
  const dist = cur ? Math.round(haversine(cur, { lat, lng })) : null;
  if (dist !== null && dist > LOC_FAR_M) flags.push('far');
  const now = nowSec();
  const own = !!cur && cur.confirmed !== 1 && cur.profile_id === profileId;
  const direct = !cur || own;
  await supersedeOwn(env, park, entity.id, profileId); // eerdere voorstellen van jezelf voor deze show vervallen
  await env.DB.prepare(
    'INSERT INTO location_submissions (park_id, entity_id, kind, lat, lng, accuracy_m, profile_id, created_at, status, flags, dist_m, prev_lat, prev_lng, prev_accuracy_m) ' +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
  ).bind(park.id, entity.id, direct ? 'new' : 'replace', lat, lng, accuracy, profileId, now, JSON.stringify(flags), dist,
    cur?.lat ?? null, cur?.lng ?? null, cur?.accuracy_m ?? null).run();
  if (direct) {
    await env.DB.prepare(
      'INSERT INTO user_locations (park_id, entity_id, lat, lng, accuracy_m, profile_id, updated_at, confirmed) VALUES (?, ?, ?, ?, ?, ?, ?, 0) ' +
        'ON CONFLICT(park_id, entity_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, ' +
        'profile_id = excluded.profile_id, updated_at = excluded.updated_at, confirmed = 0',
    ).bind(park.id, entity.id, lat, lng, accuracy, profileId, now).run();
  }
  ctx.waitUntil(notifySubmission(env, park, entity, direct ? 'new' : 'replace',
    [`±${accuracy} m`, dist !== null ? `${dist} m van de huidige` : '', outside > 0 ? 'aan de rand van het park' : ''].filter(Boolean).join(' · '))
    .catch((e) => console.log('Push', e)));
  if (!direct) return json({ ok: true, pending: true });
  return json({ ok: true, pending: false, ...userLoc({ lat, lng, accuracy_m: accuracy, updated_at: now, confirmed: 0 }) });
}

export async function deleteLocation(env: Env, ctx: ExecutionContext, park: ParkConfig, entity: EntityInfo, profileId: string): Promise<Response> {
  const cur = await env.DB.prepare(`SELECT ${USER_LOC_COLS} FROM user_locations WHERE park_id = ? AND entity_id = ?`)
    .bind(park.id, entity.id).first<UserLocRow>();
  if (!cur) return json({ ok: true, pending: false });
  await supersedeOwn(env, park, entity.id, profileId);
  if (cur.confirmed !== 1 && cur.profile_id === profileId) {
    await env.DB.prepare('DELETE FROM user_locations WHERE park_id = ? AND entity_id = ?').bind(park.id, entity.id).run();
    return json({ ok: true, pending: false });
  }
  await env.DB.prepare(
    'INSERT INTO location_submissions (park_id, entity_id, kind, profile_id, created_at, status, flags, prev_lat, prev_lng, prev_accuracy_m) ' +
      "VALUES (?, ?, 'delete', ?, ?, 'pending', '[]', ?, ?, ?)",
  ).bind(park.id, entity.id, profileId, nowSec(), cur.lat, cur.lng, cur.accuracy_m).run();
  ctx.waitUntil(notifySubmission(env, park, entity, 'delete', '').catch((e) => console.log('Push', e)));
  return json({ ok: true, pending: true });
}
