import type { EntityInfo, LatLng, LiveInfo, SortMode } from '../../../packages/shared/src/index';
import { haversineMeters } from './geo';

/** Starttijd (ms) van de eerstvolgende show, of null als er vandaag niets meer komt. */
export function nextStartMs(live: LiveInfo | undefined, now = Date.now()): number | null {
  const next = live?.showtimes.find((s) => Date.parse(s.start) > now);
  return next ? Date.parse(next.start) : null;
}

export interface SortContext {
  sort: SortMode;
  live: Map<string, LiveInfo>;
  pos: LatLng | null;
  /** Items hiervan komen altijd bovenaan (gelikete shows). */
  pinned?: Set<string>;
  now?: number;
}

const cmp = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0);

export function distanceOf(e: EntityInfo, pos: LatLng | null): number | null {
  return pos && e.location ? haversineMeters(pos, e.location) : null;
}

/** Sorteersleutel voor "wachttijd": attracties eerst op wachttijd, dan shows op starttijd. */
function waitKey(e: EntityInfo, ctx: SortContext): [number, number] {
  const live = ctx.live.get(e.id);
  if (e.type === 'show') {
    const next = nextStartMs(live, ctx.now);
    return [1, next ?? Infinity];
  }
  if (!live) return [0, Infinity];
  if (live.status === 'open') return [0, live.waitMinutes ?? 10_000]; // open zonder tijd na de gemeten tijden
  return [0, 100_000]; // storing, dicht of onderhoud helemaal onderaan
}

export function sortEntities(list: EntityInfo[], ctx: SortContext): EntityInfo[] {
  return [...list].sort((a, b) => {
    if (ctx.pinned) {
      const p = cmp(ctx.pinned.has(a.id) ? 0 : 1, ctx.pinned.has(b.id) ? 0 : 1);
      if (p) return p;
    }
    let r = 0;
    if (ctx.sort === 'wait') {
      const [ga, va] = waitKey(a, ctx);
      const [gb, vb] = waitKey(b, ctx);
      r = cmp(ga, gb) || cmp(va, vb);
    } else if (ctx.sort === 'distance') {
      r = cmp(distanceOf(a, ctx.pos) ?? Infinity, distanceOf(b, ctx.pos) ?? Infinity);
    }
    return r || a.name.localeCompare(b.name, 'nl');
  });
}
