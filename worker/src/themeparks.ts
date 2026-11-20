import type {
  EntitiesResponse,
  EntityInfo,
  LiveInfo,
  LiveResponse,
  LiveStatus,
  Showtime,
} from '../../packages/shared/src/index';
import { PARKS, type ParkConfig } from './parks';

const BASE = 'https://api.themeparks.wiki/v1';

const TTL_DESTINATIONS = 24 * 3600;
const TTL_ENTITIES = 6 * 3600;
const TTL_LIVE = 30;

export class UpstreamError extends Error {
  constructor(public status: number, path: string) {
    super(`ThemeParks.wiki ${status} voor ${path}`);
  }
}

interface Upstream<T> {
  data: T;
  ageSeconds: number;
}

/** Haalt JSON op via de Cloudflare-cache, zodat we de gratis API niet onnodig belasten. */
async function upstream<T>(path: string, ttl: number): Promise<Upstream<T>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: 'application/json', 'user-agent': 'ParkPilot/0.1 (persoonlijk project)' },
    cf: { cacheTtl: ttl, cacheEverything: true },
  });
  if (!res.ok) throw new UpstreamError(res.status, path);
  const age = Number(res.headers.get('age') ?? 0);
  return { data: (await res.json()) as T, ageSeconds: Number.isFinite(age) ? age : 0 };
}

// ---- ID-resolutie ---------------------------------------------------------------------------

interface DestinationsPayload {
  destinations?: { name: string; slug?: string; parks?: { id: string; name: string }[] }[];
}

let resolved: { at: number; ids: Map<string, string> } | null = null;

/** Zoekt per geconfigureerd park het ThemeParks.wiki-entity-ID op via /destinations. */
export async function resolveParkIds(): Promise<Map<string, string>> {
  if (resolved && Date.now() - resolved.at < TTL_DESTINATIONS * 1000) return resolved.ids;
  const { data } = await upstream<DestinationsPayload>('/destinations', TTL_DESTINATIONS);
  const ids = new Map<string, string>();
  for (const cfg of PARKS) {
    for (const dest of data.destinations ?? []) {
      if (!cfg.destinationMatch.test(dest.name)) continue;
      const park = (dest.parks ?? []).find((p) => cfg.parkMatch.test(p.name));
      if (park) ids.set(cfg.id, park.id);
    }
  }
  resolved = { at: Date.now(), ids };
  return ids;
}

async function upstreamId(cfg: ParkConfig): Promise<string | null> {
  return (await resolveParkIds()).get(cfg.id) ?? null;
}

// ---- Normalisatie ---------------------------------------------------------------------------

interface RawChild {
  id: string;
  name: string;
  entityType: string;
  location?: { latitude?: number | null; longitude?: number | null } | null;
  children?: RawChild[];
}

function walk(nodes: RawChild[] | undefined, out: RawChild[]): void {
  for (const n of nodes ?? []) {
    out.push(n);
    walk(n.children, out);
  }
}

export async function getEntities(cfg: ParkConfig): Promise<EntitiesResponse | null> {
  const id = await upstreamId(cfg);
  if (!id) return null;
  const { data, ageSeconds } = await upstream<{ children?: RawChild[] }>(
    `/entity/${id}/children`,
    TTL_ENTITIES,
  );
  const flat: RawChild[] = [];
  walk(data.children, flat);

  const seen = new Set<string>();
  const entities: EntityInfo[] = [];
  for (const c of flat) {
    const type = c.entityType === 'ATTRACTION' ? 'attraction' : c.entityType === 'SHOW' ? 'show' : null;
    if (!type || seen.has(c.id)) continue;
    seen.add(c.id);
    const lat = c.location?.latitude;
    const lng = c.location?.longitude;
    entities.push({
      id: c.id,
      type,
      name: c.name,
      location: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
    });
  }
  entities.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  return {
    parkId: cfg.id,
    generatedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    entities,
  };
}

interface RawLive {
  id: string;
  entityType: string;
  status?: string;
  lastUpdated?: string;
  queue?: { STANDBY?: { waitTime?: number | null } | null } | null;
  showtimes?: { startTime?: string; endTime?: string | null }[] | null;
}

const STATUS: Record<string, LiveStatus> = {
  OPERATING: 'open',
  CLOSED: 'closed',
  DOWN: 'down',
  DOWNTIME: 'down',
  REFURBISHMENT: 'refurbishment',
};

export async function getLive(cfg: ParkConfig): Promise<LiveResponse | null> {
  const id = await upstreamId(cfg);
  if (!id) return null;
  const { data, ageSeconds } = await upstream<{ liveData?: RawLive[] }>(`/entity/${id}/live`, TTL_LIVE);

  const live: LiveInfo[] = [];
  let newest: number | null = null;
  for (const l of data.liveData ?? []) {
    if (l.entityType !== 'ATTRACTION' && l.entityType !== 'SHOW') continue;
    const showtimes: Showtime[] = (l.showtimes ?? [])
      .filter((s): s is { startTime: string; endTime?: string | null } => typeof s.startTime === 'string')
      .map((s) => ({ start: s.startTime, end: s.endTime ?? null }))
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    const wait = l.queue?.STANDBY?.waitTime;
    const updated = l.lastUpdated ? Date.parse(l.lastUpdated) : NaN;
    if (Number.isFinite(updated) && (newest === null || updated > newest)) newest = updated;
    live.push({
      id: l.id,
      status: STATUS[(l.status ?? '').toUpperCase()] ?? 'unknown',
      waitMinutes: typeof wait === 'number' ? wait : null,
      showtimes,
      updatedAt: Number.isFinite(updated) ? new Date(updated).toISOString() : null,
    });
  }
  return {
    parkId: cfg.id,
    generatedAt: new Date(Date.now() - ageSeconds * 1000).toISOString(),
    sourceUpdatedAt: newest === null ? null : new Date(newest).toISOString(),
    live,
  };
}
