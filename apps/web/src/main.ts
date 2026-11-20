import './style.css';
import {
  DEFAULT_PREFERENCES,
  type EntityInfo,
  type HistoryResponse,
  type LatLng,
  type LiveInfo,
  type ParkInfo,
  type PreferencesDto,
  type ScheduleEntry,
  type SortMode,
} from '../../../packages/shared/src/index';
import { APP_VERSION } from '../../../packages/shared/src/version';
import {
  ApiError, createRecoveryCode, deleteFavorite, ensureProfile, fetchEntities, fetchFavorites, fetchHealth, fetchHistoryToday,
  fetchLive, fetchParks, fetchPreferences, fetchSchedule, putFavorite, redeemRecoveryCode, savePreferences, setCreds,
} from './api';
import { parkArt } from './art';
import { h, svg } from './dom';
import { agoLabel, clock, waitLevel } from './format';
import { GeoError, formatDistance, getPosition, haversineMeters, hasGeoPermission, walkMinutes } from './geo';
import { icon, iconForKind } from './icons';
import { blurbFor } from './info';
import { distanceOf, nextStartMs, sortEntities } from './logic';
import { applyTheme, effectiveTheme, getPref, setPref, watchSystemTheme, type ThemePref } from './theme';

// ---- State -----------------------------------------------------------------------------------

type Tab = 'attractions' | 'shows' | 'favorites';
type LocStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'error';
const POS_KEY = 'pp.pos';

function loadPos(): LatLng | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { lat: number; lng: number; at: number } | null;
    return p && Date.now() - p.at < 10 * 60_000 ? { lat: p.lat, lng: p.lng } : null;
  } catch { return null; }
}

const state = {
  parks: [] as ParkInfo[],
  parkId: localStorage.getItem('pp.park') ?? '',
  entities: [] as EntityInfo[],
  live: new Map<string, LiveInfo>(),
  schedule: [] as ScheduleEntry[],
  generatedAt: null as string | null,
  sourceUpdatedAt: null as string | null,
  favorites: new Set<string>(),
  prefs: { ...DEFAULT_PREFERENCES } as PreferencesDto,
  tab: 'attractions' as Tab,
  onlyOpen: false,
  pos: loadPos(),
  loc: 'idle' as LocStatus,
  loading: true,
  error: null as string | null,
  fromCache: false,
  serverVersion: null as string | null,
};

const root = document.getElementById('app') as HTMLElement;
const currentPark = (): ParkInfo | undefined => state.parks.find((p) => p.id === state.parkId);
const tz = (): string => currentPark()?.timezone ?? 'Europe/Paris';

// ---- Locatie (alleen op verzoek, nooit bij het opstarten) ------------------------------------

function storePos(): void {
  if (state.pos) localStorage.setItem(POS_KEY, JSON.stringify({ ...state.pos, at: Date.now() }));
}

async function ensurePosition(): Promise<boolean> {
  state.loc = 'asking';
  render();
  try {
    state.pos = await getPosition();
    state.loc = 'ok';
    storePos();
    render();
    return true;
  } catch (err) {
    state.loc = err instanceof GeoError && err.code === 'denied' ? 'denied' : 'error';
    render();
    return false;
  }
}

async function refreshPositionQuietly(): Promise<void> {
  const needed = state.prefs.sort === 'distance' || [...state.favorites].some((id) => state.entities.find((e) => e.id === id)?.type === 'show');
  if (!needed || state.loc === 'denied' || state.loc === 'asking') return;
  if (state.loc !== 'ok' && !(await hasGeoPermission())) return;
  try { state.pos = await getPosition(); state.loc = 'ok'; storePos(); } catch { /* oude positie blijft */ }
}

// ---- Afgeleide gegevens ----------------------------------------------------------------------

function parkStatus(now = Date.now()): { open: boolean | null; text: string } {
  const entries = state.schedule.filter((s) => s.type === 'OPERATING');
  if (!state.schedule.length) return { open: null, text: 'Openingstijden onbekend' };
  const list = entries.length ? entries : state.schedule;
  const cur = list.find((s) => Date.parse(s.opens) <= now && now < Date.parse(s.closes));
  if (cur) return { open: true, text: `Open tot ${clock(cur.closes, tz())}` };
  const next = list.find((s) => Date.parse(s.opens) > now);
  if (next) return { open: false, text: `Gesloten, opent om ${clock(next.opens, tz())}` };
  return { open: false, text: 'Vandaag gesloten' };
}

function parkStats(): { openCount: number; avg: number | null; short: { name: string; min: number } | null } {
  let openCount = 0, sum = 0, n = 0;
  let short: { name: string; min: number } | null = null;
  for (const e of state.entities) {
    if (e.type !== 'attraction') continue;
    const l = state.live.get(e.id);
    if (l?.status !== 'open') continue;
    openCount++;
    if (l.waitMinutes === null) continue;
    sum += l.waitMinutes; n++;
    if (!short || l.waitMinutes < short.min) short = { name: e.name, min: l.waitMinutes };
  }
  return { openCount, avg: n ? Math.round(sum / n) : null, short };
}

function changedText(live: LiveInfo | undefined): string {
  if (!live?.changedAt) return '';
  const ago = agoLabel(live.changedAt);
  if (live.changeObserved) return `gewijzigd ${ago}`;
  return ago === 'zojuist' ? '' : `ongewijzigd sinds ${ago.replace(' geleden', '')}`;
}

/** Pijl met het verschil sinds de vorige waarneming. Hoger is slechter (rood), lager is beter (groen). */
function trendDelta(live: LiveInfo | undefined): { up: boolean; diff: number } | null {
  if (!live?.changeObserved || live.waitMinutes === null || live.prevWaitMinutes === null) return null;
  if (live.waitMinutes === live.prevWaitMinutes) return null;
  return { up: live.waitMinutes > live.prevWaitMinutes, diff: live.waitMinutes - live.prevWaitMinutes };
}

function trendNode(live: LiveInfo | undefined): Node | null {
  const t = trendDelta(live);
  if (!t) return null;
  return h('span', { class: `trend ${t.up ? 'up' : 'down'}`, 'aria-label': t.up ? `${t.diff} minuten langer` : `${-t.diff} minuten korter` },
    `${t.up ? '▲ +' : '▼ −'}${Math.abs(t.diff)}`);
}

/** Hoe vers de meting van de bron is: groen tot 10 minuten, oranje tot 30, daarna rood. */
function freshness(iso: string | null): 'fresh' | 'aging' | 'old' | 'unknown' {
  if (!iso) return 'unknown';
  const min = (Date.now() - Date.parse(iso)) / 60000;
  return min <= 10 ? 'fresh' : min <= 30 ? 'aging' : 'old';
}

function metaLine(live: LiveInfo | undefined): HTMLElement | null {
  if (!live) return null;
  const parts: Node[] = [];
  const trend = trendNode(live);
  if (trend) parts.push(trend, ' · ');
  const changed = changedText(live);
  if (changed) parts.push(changed, ' · ');
  if (live.updatedAt) parts.push(h('span', { class: `src ${freshness(live.updatedAt)}` }, `bron ${agoLabel(live.updatedAt)}`));
  else if (parts.length) parts.pop();
  return parts.length ? h('div', { class: 'row-meta' }, ...parts) : null;
}

function upcomingStarts(live: LiveInfo | undefined): number[] {
  return (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter((t) => t > Date.now());
}

function untilLabel(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((ms - now) / 60000));
  if (m < 1) return 'nu';
  if (m < 60) return `over ${m} min`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `over ${hh} u ${mm} min` : `over ${hh} u`;
}

/** Vertrektijd voor een show: starttijd min jouw aankomstmarge min de looptijd. Alleen met bekende locatie. */
function departure(entity: EntityInfo, startMs: number): { text: string; walk: number } | null {
  const d = distanceOf(entity, state.pos);
  if (d === null) return null;
  const walk = walkMinutes(d, state.prefs.walkingSpeedKmh);
  const at = startMs - (state.prefs.arrivalMarginMin + walk) * 60_000;
  return { text: at > Date.now() ? `Vertrek om ${clock(at, tz())}` : 'Vertrek nu', walk };
}

function kindOf(entity: EntityInfo): string {
  return blurbFor(entity.name)?.kind ?? (entity.type === 'show' ? 'Show' : '');
}

// ---- Ring en rijen ---------------------------------------------------------------------------

function ring(cls: string, pct: number | null, inner: Node): HTMLElement {
  const R = 23, C = 2 * Math.PI * R;
  return h('div', { class: `ring ${cls}` },
    svg('svg', { viewBox: '0 0 56 56', 'aria-hidden': 'true' },
      svg('circle', { class: 'track', cx: 28, cy: 28, r: R }),
      pct === null ? svg('g') : svg('circle', {
        class: 'arc', cx: 28, cy: 28, r: R, transform: 'rotate(-90 28 28)',
        'stroke-dasharray': `${Math.max(3, pct * C).toFixed(1)} ${C.toFixed(1)}`,
      })),
    inner);
}

function statusRing(entity: EntityInfo, live: LiveInfo | undefined): HTMLElement {
  const txt = (t: string): HTMLElement => h('div', { class: 'ring-in txt' }, t);
  if (!live) return ring('', null, txt('–'));
  if (entity.type === 'show') {
    const next = nextStartMs(live);
    return next !== null
      ? ring('time', 1, h('div', { class: 'ring-in clock' }, clock(next, tz())))
      : ring('', null, txt('geen meer'));
  }
  switch (live.status) {
    case 'open':
      if (live.waitMinutes === null) return ring('', 1, txt('open'));
      {
        const r = ring(waitLevel(live.waitMinutes), Math.min(live.waitMinutes, 90) / 90, h('div', { class: 'ring-in' }, String(live.waitMinutes), h('small', {}, 'min')));
        const t = trendDelta(live);
        if (t) r.append(h('span', { class: `ring-arrow ${t.up ? 'up' : 'down'}`, 'aria-hidden': 'true' }, t.up ? '▲' : '▼'));
        return r;
      }
    case 'down': return ring('bad', 1, h('div', { class: 'ring-in' }, icon('warn', 22)));
    case 'closed': return ring('', null, h('div', { class: 'ring-in' }, icon('moon', 20)));
    case 'refurbishment': return ring('', null, h('div', { class: 'ring-in' }, icon('wrench', 20)));
    default: return ring('', null, txt('–'));
  }
}

function kindLine(entity: EntityInfo, extra: string[] = []): HTMLElement | null {
  const kind = kindOf(entity);
  if (!kind && !extra.length) return null;
  return h('div', { class: 'row-sub' },
    kind ? icon(iconForKind(kind), 14) : null,
    kind ? kind : null,
    ...extra.map((e) => h('span', { class: 'plain' }, `· ${e}`)));
}

function renderRow(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const isFav = state.favorites.has(entity.id);
  const blurb = blurbFor(entity.name);
  const extra: string[] = [];
  if (entity.type === 'show') {
    const later = upcomingStarts(live).slice(1, 4);
    if (later.length) extra.push(`daarna ${later.map((t) => clock(t, tz())).join(', ')}`);
  }
  if (live?.singleRider && entity.type === 'attraction') extra.push('single rider');
  const d = distanceOf(entity, state.pos);
  if (d !== null) extra.push(`${formatDistance(d)}, ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`);
  const meta = entity.type === 'attraction' ? metaLine(live) : null;
  return h('div', { class: 'row' },
    h('button', { class: 'row-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
      statusRing(entity, live),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-name' }, entity.name),
        kindLine(entity, extra),
        blurb?.text ? h('div', { class: 'row-desc' }, blurb.text) : null,
        meta)),
    heartButton(entity));
}

function heartButton(entity: EntityInfo): HTMLElement {
  const isFav = state.favorites.has(entity.id);
  return h('button', {
    class: 'heart', 'aria-pressed': isFav,
    'aria-label': isFav ? `${entity.name} niet meer volgen` : `${entity.name} volgen`,
    onclick: () => void toggleFavorite(entity),
  }, isFav ? '♥' : '♡');
}

/** Show die je volgt: grote tijd, aftelling en (met locatie) wanneer je moet vertrekken. */
function renderShowCard(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const next = nextStartMs(live);
  const blurb = blurbFor(entity.name);
  const later = upcomingStarts(live).slice(1, 4);
  let whenNode: HTMLElement;
  let note: string | null = null;
  if (next !== null) {
    whenNode = h('div', { class: 'when' }, h('b', {}, clock(next, tz())), h('span', {}, untilLabel(next)));
  } else {
    whenNode = h('div', { class: 'when none' }, h('b', {}, '–'), h('span', {}, 'geen meer'));
    note = !live ? 'Tijden laden…' : live.showtimes.length ? 'Geen shows meer vandaag.' : 'Voor vandaag zijn geen tijden bekend.';
  }
  const dep = next !== null ? departure(entity, next) : null;
  return h('div', { class: 'showcard' },
    h('button', { class: 'showcard-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
      whenNode,
      h('div', { class: 'showcard-main' },
        h('div', { class: 'row-name' }, entity.name),
        kindLine(entity, later.length ? [`daarna ${later.map((t) => clock(t, tz())).join(', ')}`] : []),
        blurb?.text ? h('div', { class: 'row-desc' }, blurb.text) : null,
        note ? h('div', { class: 'row-meta' }, note) : null,
        dep ? h('div', { class: 'depart' }, icon('pin', 14), `${dep.text} (${dep.walk} min lopen)`) : null)),
    heartButton(entity));
}

function byNextStart(a: EntityInfo, b: EntityInfo): number {
  return (nextStartMs(state.live.get(a.id)) ?? Infinity) - (nextStartMs(state.live.get(b.id)) ?? Infinity) || a.name.localeCompare(b.name, 'nl');
}

function listNodes(): Node[] {
  const ctx = { sort: state.prefs.sort, live: state.live, pos: state.pos };
  const openOk = (e: EntityInfo): boolean => !state.onlyOpen || e.type !== 'attraction' || state.live.get(e.id)?.status === 'open';
  const out: Node[] = [];
  if (state.tab === 'attractions') {
    for (const e of sortEntities(state.entities.filter((x) => x.type === 'attraction' && openOk(x)), ctx)) out.push(renderRow(e));
  } else if (state.tab === 'shows') {
    const shows = state.entities.filter((x) => x.type === 'show');
    for (const e of shows.filter((x) => state.favorites.has(x.id)).sort(byNextStart)) out.push(renderShowCard(e));
    for (const e of sortEntities(shows.filter((x) => !state.favorites.has(x.id)), ctx)) out.push(renderRow(e));
  } else {
    const favs = state.entities.filter((x) => state.favorites.has(x.id));
    for (const e of favs.filter((x) => x.type === 'show').sort(byNextStart)) out.push(renderShowCard(e));
    for (const e of sortEntities(favs.filter((x) => x.type === 'attraction' && openOk(x)), ctx)) out.push(renderRow(e));
  }
  return out;
}

function locationNotice(): HTMLElement | null {
  const park = currentPark();
  if (state.prefs.sort === 'distance') {
    if (state.loc === 'asking') return h('div', { class: 'notice' }, 'Locatie bepalen…');
    if (state.loc === 'denied') {
      return h('div', { class: 'notice' }, 'ParkPilot mag je locatie niet gebruiken. Zet dat aan via Instellingen op je iPhone, bij Privacy en beveiliging, Locatievoorzieningen. Open daarna de app opnieuw.');
    }
    if (!state.pos) {
      return h('div', { class: 'notice' },
        state.loc === 'error' ? 'Locatie bepalen is niet gelukt.' : 'Sorteren op afstand heeft je locatie nodig.',
        h('div', {}, h('button', { class: 'btn', onclick: () => void ensurePosition() }, 'Gebruik mijn locatie')));
    }
  }
  if (state.pos && park && haversineMeters(state.pos, park.center) > 3000) {
    return h('div', { class: 'notice' }, 'Je bent niet in het park. Afstanden zijn vanaf je huidige locatie.');
  }
  return null;
}

// ---- Hoofdscherm -----------------------------------------------------------------------------

function render(): void {
  const park = currentPark();
  document.documentElement.dataset.park = state.parkId;
  applyTheme();
  const offline = !navigator.onLine;
  const status = parkStatus();
  const stats = parkStats();
  const nodes = state.entities.length ? listNodes() : [];

  let body: Node;
  if (state.loading && state.entities.length === 0) body = h('div', { class: 'empty' }, 'Gegevens laden…');
  else if (state.entities.length === 0) body = h('div', { class: 'empty' }, state.error ?? 'Geen attracties gevonden voor dit park.');
  else if (nodes.length === 0) {
    body = h('div', { class: 'empty' }, state.tab === 'favorites' ? 'Nog niets om te volgen. Tik op het hartje bij een attractie of show.' : 'Niets gevonden met dit filter.');
  } else body = h('div', {}, ...nodes);

  const age = agoLabel(state.generatedAt);
  const srcAge = state.sourceUpdatedAt ? ` · nieuwste bronmeting ${agoLabel(state.sourceUpdatedAt)}` : '';
  const srcStale = status.open === true && freshness(state.sourceUpdatedAt) === 'old';
  const freshText = state.fromCache ? `Opgeslagen gegevens, ${age}`
    : offline ? `Geen verbinding, gegevens van ${age}`
    : state.error && state.entities.length > 0 ? `${state.error.replace(/[.,]$/, '')} (gegevens van ${age})`
    : `Bijgewerkt ${age}${srcAge}`;

  const sortLabels: [SortMode, string][] = [['wait', state.tab === 'shows' ? 'Starttijd' : 'Wachttijd'], ['distance', 'Afstand'], ['name', 'Naam']];
  const dark = effectiveTheme() === 'dark';
  const scrollTop = window.scrollY;
  root.replaceChildren(
    h('header', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('div', { class: 'brand' }, 'ParkPilot', h('span', { class: 'ver' }, `v${APP_VERSION}`)),
        h('div', { class: 'top-actions' },
          h('button', { class: 'icon-btn', 'aria-label': dark ? 'Schakel naar licht thema' : 'Schakel naar donker thema', onclick: toggleTheme }, icon(dark ? 'sun' : 'moon', 22)),
          h('button', { class: 'icon-btn', 'aria-label': 'Instellingen', onclick: openSettings }, icon('gear', 22)))),
      state.parks.length > 1
        ? h('div', { class: 'parks', role: 'group', 'aria-label': 'Park' },
            ...state.parks.map((p) => h('button', { class: 'park-pill', 'aria-pressed': p.id === state.parkId, onclick: () => switchPark(p.id) }, p.shortName)))
        : null,
      h('div', { class: 'hero-main' },
        parkArt(state.parkId),
        h('h1', { class: 'park-name' }, park?.name ?? 'ParkPilot'),
        h('div', { class: 'park-status' }, h('span', { class: `dot${status.open === true ? ' open' : status.open === false ? ' closed' : ''}` }), status.text),
        state.entities.length
          ? h('div', { class: 'stats' },
              h('div', { class: 'stat' }, icon('door', 18), h('b', {}, String(stats.openCount)), h('span', {}, 'attracties open')),
              h('div', { class: 'stat' }, icon('gauge', 18), h('b', {}, stats.avg === null ? '–' : `${stats.avg} min`), h('span', {}, 'gemiddeld')),
              h('div', { class: 'stat' }, icon('bolt', 18), h('b', {}, stats.short ? `${stats.short.min} min` : '–'), h('span', {}, stats.short ? `korst: ${stats.short.name}` : 'korst')))
          : null)),
    h('nav', { class: 'nav' },
      h('div', { class: 'segments', role: 'group', 'aria-label': 'Weergave' },
        h('button', { 'aria-pressed': state.tab === 'attractions', onclick: () => setTab('attractions') }, 'Attracties'),
        h('button', { 'aria-pressed': state.tab === 'shows', onclick: () => setTab('shows') }, 'Shows'),
        h('button', { 'aria-pressed': state.tab === 'favorites', onclick: () => setTab('favorites') }, `Volgend${state.favorites.size ? ` (${state.favorites.size})` : ''}`)),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Sorteren en filteren' },
        ...sortLabels.map(([mode, text]) => h('button', { class: 'chip', 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, text)),
        state.tab !== 'shows'
          ? h('button', { class: 'chip divider', 'aria-pressed': state.onlyOpen, onclick: () => { state.onlyOpen = !state.onlyOpen; render(); } }, 'Alleen open')
          : null),
      h('div', { class: `fresh${offline || state.error || state.fromCache || srcStale ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    locationNotice(),
    h('main', {}, body),
    h('footer', { class: 'foot' },
      `ParkPilot v${APP_VERSION}${state.serverVersion && state.serverVersion !== APP_VERSION ? ` · server v${state.serverVersion}` : ''} · wachttijden via ThemeParks.wiki · niet gelieerd aan Disney`));
  window.scrollTo(0, scrollTop);
}

function toggleTheme(): void {
  setPref(effectiveTheme() === 'dark' ? 'light' : 'dark');
  render();
}

function setTab(tab: Tab): void { state.tab = tab; render(); }

function switchPark(id: string): void {
  if (id === state.parkId) return;
  state.parkId = id;
  localStorage.setItem('pp.park', id);
  void loadPark();
}

async function setSort(sort: SortMode): Promise<void> {
  if (sort === 'distance' && !state.pos) {
    state.prefs.sort = 'distance';
    if (!(await ensurePosition())) return;
  }
  state.prefs.sort = sort;
  render();
  void persistPrefs();
}

async function persistPrefs(): Promise<void> {
  try { await savePreferences(state.parkId, state.prefs); } catch { state.error = 'Voorkeuren opslaan mislukt.'; render(); }
}

// ---- Detailscherm ----------------------------------------------------------------------------

function levelColor(row: { open: boolean; y: number }): string {
  if (!row.open) return 'var(--muted)';
  return `var(--${waitLevel(row.y)})`;
}

/** Dagverloop: elke trede is gekleurd naar de wachttijd (groen is kort, rood is lang). */
function sparkline(data: HistoryResponse, now: number): Node {
  const W = 300, H = 88, PAD = 6;
  const rows = data.rows.map((r) => ({ t: Math.max(Date.parse(data.from), Date.parse(r.at)), open: r.status === 'open' && r.wait !== null, y: r.status === 'open' && r.wait !== null ? r.wait : 0 }));
  if (rows.length < 2) return h('div', { class: 'chart-note' }, 'Het verloop van vandaag wordt opgebouwd zodra ParkPilot wijzigingen ziet. Kom later terug.');
  const from = rows[0].t;
  const max = Math.max(60, ...rows.map((p) => p.y));
  const x = (t: number): number => PAD + ((t - from) / Math.max(1, now - from)) * (W - 2 * PAD);
  const y = (v: number): number => H - PAD - (v / max) * (H - 2 * PAD);
  const shapes: SVGElement[] = [];
  for (const g of [20, 45]) {
    if (g < max) shapes.push(svg('path', { d: `M${PAD} ${y(g).toFixed(1)}H${W - PAD}`, stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '3 4', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  rows.forEach((r, i) => {
    const t1 = i + 1 < rows.length ? rows[i + 1].t : now;
    if (i > 0) shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(rows[i - 1].y).toFixed(1)}V${y(r.y).toFixed(1)}`, stroke: 'var(--muted)', 'stroke-opacity': 0.5, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
    shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(r.y).toFixed(1)}H${x(t1).toFixed(1)}`, stroke: levelColor(r), 'stroke-width': 3.5, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  });
  const open = rows.filter((r) => r.open).map((r) => r.y);
  return h('div', {},
    svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Verloop van de wachttijd vandaag' }, ...shapes),
    h('div', { class: 'chart-axis' }, h('span', {}, clock(from, tz())), h('span', {}, 'nu')),
    h('div', { class: 'chart-note' }, open.length
      ? `Vandaag laagst ${Math.min(...open)} min, hoogst ${Math.max(...open)} min. Gestreepte lijnen: 20 en 45 min. Alleen wijzigingen die ParkPilot zag.`
      : 'Vandaag nog geen wachttijd gezien. Alleen wijzigingen die ParkPilot zag.'));
}

function openDetail(entity: EntityInfo): void {
  const live = state.live.get(entity.id);
  const blurb = blurbFor(entity.name);
  const kind = kindOf(entity);
  const close = (): void => { scrim.remove(); drawer.remove(); };
  const scrim = h('div', { class: 'scrim', onclick: close });
  const favBtn = h('button', { class: 'btn secondary' });
  const setFav = (): void => { favBtn.textContent = state.favorites.has(entity.id) ? '♥ Je volgt dit' : '♡ Volgen'; };
  setFav();
  favBtn.addEventListener('click', async () => { await toggleFavorite(entity); setFav(); });

  const facts = h('dl', { class: 'facts' });
  const addFact = (k: string, v: string | null): void => { if (v) facts.append(h('dt', {}, k), h('dd', {}, v)); };
  const bigNodes: Node[] = [];

  if (entity.type === 'attraction' && live) {
    if (live.status === 'open' && live.waitMinutes !== null) {
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, 'minuten wachttijd')));
    } else {
      const t = { open: 'Open, geen wachttijd bekend', down: 'Storing', closed: 'Dicht', refurbishment: 'In onderhoud', unknown: 'Status onbekend' }[live.status];
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, t)));
    }
    addFact('Wachttijd gewijzigd', live.changeObserved ? agoLabel(live.changedAt) : null);
    if (live.changeObserved && live.prevWaitMinutes !== null) addFact('Daarvoor', `${live.prevWaitMinutes} min`);
    addFact('Bron bijgewerkt', live.updatedAt ? `${agoLabel(live.updatedAt)}${{ fresh: ' (actueel)', aging: ' (wat oud)', old: ' (verouderd)', unknown: '' }[freshness(live.updatedAt)]}` : null);
    if (live.singleRider) addFact('Single rider', 'beschikbaar');
  }
  if (entity.type === 'show' && live) {
    const next = nextStartMs(live);
    if (next !== null) {
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, `Volgende voorstelling, ${untilLabel(next)}`)));
      const dep = departure(entity, next);
      if (dep) addFact('Vertrek', `${dep.text} (${dep.walk} min lopen, ${state.prefs.arrivalMarginMin} min eerder aanwezig)`);
    }
  }
  const d = distanceOf(entity, state.pos);
  if (d !== null) addFact('Afstand', `${formatDistance(d)}, ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`);

  const caveat = entity.type === 'attraction' && live && !live.changeObserved
    ? h('p', { class: 'caveat' }, `ParkPilot zag deze wachttijd nog niet veranderen sinds het begon te meten (${agoLabel(live.changedAt)}). Het echte moment van wijziging kan eerder zijn.`)
    : null;

  const chartBox = h('div', {});
  if (entity.type === 'attraction') {
    chartBox.append(h('div', { class: 'chart-note' }, 'Verloop laden…'));
    const now = Date.now();
    fetchHistoryToday(state.parkId, entity.id)
      .then((data) => chartBox.replaceChildren(sparkline(data, now)))
      .catch(() => chartBox.replaceChildren(h('div', { class: 'chart-note' }, 'Verloop is nu niet beschikbaar.')));
  }

  let times: Node | null = null;
  if (entity.type === 'show' && live) {
    const next = nextStartMs(live);
    times = live.showtimes.length
      ? h('div', { class: 'times' }, ...live.showtimes.map((s) => {
          const t = Date.parse(s.start);
          return h('span', { class: `time${t === next ? ' next' : t < Date.now() ? ' past' : ''}` }, clock(t, tz()));
        }))
      : h('p', { class: 'caveat' }, 'Voor vandaag zijn geen tijden bekend.');
  }

  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-label': entity.name },
    h('div', { class: 'grab' }),
    h('div', { class: 'drawer-head' },
      h('div', {}, h('h2', {}, entity.name), kind ? h('div', { class: 'kind' }, icon(iconForKind(kind), 15), kind) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    blurb?.text ? h('p', { class: 'blurb' }, blurb.text) : null,
    ...bigNodes,
    facts.childNodes.length ? facts : null,
    caveat,
    entity.type === 'attraction' ? h('div', { class: 'section-title' }, 'Verloop vandaag') : null,
    entity.type === 'attraction' ? chartBox : null,
    times ? h('div', { class: 'section-title' }, 'Vandaag') : null,
    times,
    favBtn);
  document.body.append(scrim, drawer);
}

// ---- Gegevens --------------------------------------------------------------------------------

async function toggleFavorite(entity: EntityInfo): Promise<void> {
  const wasFav = state.favorites.has(entity.id);
  if (wasFav) state.favorites.delete(entity.id); else state.favorites.add(entity.id);
  render();
  if (!wasFav && entity.type === 'show') void refreshPositionQuietly().then(render);
  try {
    if (wasFav) await deleteFavorite(state.parkId, entity.id); else await putFavorite(state.parkId, entity.id, entity.type);
  } catch {
    if (wasFav) state.favorites.add(entity.id); else state.favorites.delete(entity.id);
    state.error = 'Opslaan mislukt. Probeer het opnieuw.';
    render();
  }
}

const cacheKey = (parkId: string): string => `pp.cache.${parkId}`;

function saveCache(): void {
  try {
    localStorage.setItem(cacheKey(state.parkId), JSON.stringify({
      entities: state.entities, live: [...state.live.values()], schedule: state.schedule, generatedAt: state.generatedAt, sourceUpdatedAt: state.sourceUpdatedAt,
    }));
  } catch { /* opslag vol: geen ramp */ }
}

function loadCache(parkId: string): boolean {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(parkId)) ?? 'null') as
      { entities: EntityInfo[]; live: LiveInfo[]; schedule: ScheduleEntry[]; generatedAt: string; sourceUpdatedAt?: string | null } | null;
    if (!c) return false;
    state.entities = c.entities;
    state.live = new Map(c.live.map((l) => [l.id, l]));
    state.schedule = c.schedule;
    state.generatedAt = c.generatedAt;
    state.sourceUpdatedAt = c.sourceUpdatedAt ?? null;
    state.fromCache = true;
    return true;
  } catch { return false; }
}

async function loadPark(): Promise<void> {
  if (!state.parkId) return;
  const parkId = state.parkId;
  state.loading = true; state.entities = []; state.live = new Map(); state.schedule = [];
  state.generatedAt = null; state.sourceUpdatedAt = null; state.error = null; state.fromCache = false;
  render();
  try {
    const [entities, live, favs, prefs, schedule] = await Promise.all([
      fetchEntities(parkId), fetchLive(parkId), fetchFavorites(parkId),
      fetchPreferences(parkId).catch(() => ({ ...DEFAULT_PREFERENCES })),
      fetchSchedule(parkId).catch(() => null),
    ]);
    if (parkId !== state.parkId) return;
    state.entities = entities.entities;
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.sourceUpdatedAt = live.sourceUpdatedAt;
    state.schedule = schedule?.today ?? [];
    state.favorites = new Set(favs.map((f) => f.entityId));
    state.prefs = prefs;
    saveCache();
    await refreshPositionQuietly();
  } catch (err) {
    if (parkId !== state.parkId) return;
    if (!loadCache(parkId)) {
      state.error = err instanceof ApiError && err.code === 'park_not_found_upstream' ? 'Dit park is niet gevonden bij ThemeParks.wiki.' : 'Gegevens laden mislukt.';
    }
  }
  state.loading = false;
  render();
}

async function refreshLive(): Promise<void> {
  if (!state.parkId || state.entities.length === 0) return;
  try {
    // Favorieten worden mee ververst, zodat wijzigingen vanaf een ander apparaat met dezelfde koppelcode verschijnen.
    const [live, schedule, favs] = await Promise.all([
      fetchLive(state.parkId), fetchSchedule(state.parkId).catch(() => null), fetchFavorites(state.parkId).catch(() => null),
    ]);
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.sourceUpdatedAt = live.sourceUpdatedAt;
    if (schedule) state.schedule = schedule.today;
    if (favs) state.favorites = new Set(favs.map((f) => f.entityId));
    state.error = null; state.fromCache = false;
    saveCache();
  } catch { state.error = 'Verversen mislukt,'; }
  await refreshPositionQuietly();
  render();
}

// ---- Instellingen en koppelcode --------------------------------------------------------------

function openSettings(): void {
  const mkMsg = (): { el: HTMLElement; say: (t: string, kind?: 'good' | 'err' | '') => void } => {
    const el = h('div', { class: 'msg', role: 'status' });
    return { el, say: (t, kind = '') => { el.className = `msg ${kind}`.trim(); el.textContent = t; } };
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Instellingen' });
  const close = (): void => sheet.remove();

  // Thema
  const themeLabels: [ThemePref, string][] = [['auto', 'Automatisch'], ['light', 'Licht'], ['dark', 'Donker']];
  const themeBox = h('div', { class: 'segments', role: 'group', 'aria-label': 'Thema' });
  const paintTheme = (): void => {
    themeBox.replaceChildren(...themeLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': getPref() === v, onclick: () => { setPref(v); paintTheme(); render(); } }, t)));
  };
  paintTheme();

  // Shows
  const marginOptions = [0, 5, 10, 15, 20, 30, 45, 60];
  const speeds: [number, string][] = [[3.5, 'Rustig (3,5 km/u)'], [4.5, 'Normaal (4,5 km/u)'], [5.5, 'Vlot (5,5 km/u)']];
  const marginSelect = h('select', { class: 'select', onchange: (ev: Event) => { state.prefs.arrivalMarginMin = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); render(); } },
    ...marginOptions.map((m) => h('option', { value: m, selected: m === state.prefs.arrivalMarginMin }, m === 0 ? 'Op het moment zelf' : `${m} minuten`)));
  const speedSelect = h('select', { class: 'select', onchange: (ev: Event) => { state.prefs.walkingSpeedKmh = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); render(); } },
    ...speeds.map(([v, t]) => h('option', { value: v, selected: v === state.prefs.walkingSpeedKmh }, t)));

  // Eigen koppelcode
  const custom = mkMsg();
  const customInput = h('input', { class: 'input', type: 'text', placeholder: 'bijv. 1234', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': 'Eigen koppelcode', maxlength: 24 });
  const saveCustom = h('button', { class: 'btn' }, 'Bewaar mijn code');
  saveCustom.addEventListener('click', async () => {
    const value = customInput.value.trim();
    if (value.replace(/[^A-Za-z0-9]/g, '').length < 4) return custom.say('Gebruik minimaal 4 letters of cijfers.', 'err');
    saveCustom.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode(value);
      custom.say(`Bewaard. Met "${code}" open je dit lijstje op elk ander toestel.`, 'good');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_taken') custom.say('Deze code is al in gebruik. Kies een andere.', 'err');
      else if (err instanceof ApiError && err.code === 'invalid_code') custom.say('Gebruik minimaal 4 letters of cijfers.', 'err');
      else custom.say('Opslaan mislukt. Probeer het opnieuw.', 'err');
    }
    saveCustom.removeAttribute('disabled');
  });

  // Sterke code
  const strongBox = h('div');
  const strongBtn = h('button', { class: 'btn secondary' }, 'Maak een sterke code');
  strongBtn.addEventListener('click', async () => {
    strongBtn.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode();
      const copy = h('button', { class: 'btn secondary' }, 'Kopieer');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); copy.textContent = 'Gekopieerd'; } catch { copy.textContent = 'Kopiëren lukt niet, noteer de code'; }
      });
      strongBox.replaceChildren(h('div', { class: 'code' }, code), h('p', {}, 'Bewaar deze code veilig. Hij wordt maar één keer getoond en vervangt je vorige code.'), copy);
    } catch { strongBox.replaceChildren(h('p', {}, 'Koppelcode maken mislukt. Probeer het opnieuw.')); }
    strongBtn.removeAttribute('disabled');
  });

  // Terughalen
  const restore = mkMsg();
  const input = h('input', { class: 'input', type: 'text', placeholder: 'Je koppelcode', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': 'Koppelcode', maxlength: 24 });
  const restoreBtn = h('button', { class: 'btn secondary' }, 'Lijst terughalen');
  restoreBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return restore.say('Vul eerst je koppelcode in.', 'err');
    if (state.favorites.size > 0 && !confirm('De favorieten op dit toestel worden vervangen door de lijst van de koppelcode. Doorgaan?')) return;
    restoreBtn.setAttribute('disabled', '');
    try {
      const result = await redeemRecoveryCode(code);
      setCreds({ deviceId: result.deviceId, token: result.token });
      input.value = '';
      await loadPark();
      restore.say(result.favoriteCount === 1 ? '1 favoriet teruggezet.' : `${result.favoriteCount} favorieten teruggezet.`, 'good');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) restore.say('Te veel pogingen. Probeer het over een uur opnieuw.', 'err');
      else if (err instanceof ApiError && err.code === 'invalid_code') restore.say('Deze koppelcode klopt niet.', 'err');
      else restore.say('Terughalen mislukt. Controleer je verbinding.', 'err');
    }
    restoreBtn.removeAttribute('disabled');
  });

  // Omschrijvingen die nog ontbreken
  const missing = state.entities.filter((e) => !blurbFor(e.name));
  const copyMissing = h('button', { class: 'btn secondary' }, `Kopieer lijst zonder omschrijving (${missing.length})`);
  copyMissing.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${currentPark()?.name}\n${missing.map((e) => `${e.type === 'show' ? 'Show' : 'Attractie'}: ${e.name}`).join('\n')}`); copyMissing.textContent = 'Gekopieerd'; }
    catch { copyMissing.textContent = 'Kopiëren lukt niet'; }
  });

  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Instellingen'), h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    h('h3', {}, 'Thema'), themeBox,
    h('h3', {}, 'Shows'),
    h('label', { class: 'field' }, h('span', {}, 'Ik wil zo ver van tevoren bij een show zijn'), marginSelect,
      h('div', { class: 'hint' }, 'Hiermee toont ParkPilot bij shows die je volgt wanneer je moet vertrekken, zodra je locatie bekend is. Een melding hierover komt in een volgende versie.')),
    h('label', { class: 'field' }, h('span', {}, 'Looptempo'), speedSelect),
    h('h3', {}, 'Locatie'),
    h('p', {}, 'ParkPilot gebruikt je locatie alleen voor afstanden en vertrektijden, en alleen nadat je daar zelf om vraagt. Je locatie wordt niet naar de server gestuurd.'),
    h('h3', {}, 'Je lijstje op meerdere toestellen'),
    h('p', {}, 'Kies een eigen code, bijvoorbeeld 1234. Vul je die op een ander toestel in, dan zie en wijzig je daar hetzelfde lijstje. Alle toestellen met de code delen één lijst. Let op: een korte code is makkelijk te raden. Je lijstje bevat alleen favorieten en voorkeuren, maar kies liever 6 of meer tekens als je dat liever niet deelt. De app op je beginscherm heeft op iPhone eigen opslag, los van Safari.'),
    customInput,
    h('div', { class: 'inline-actions' }, saveCustom, strongBtn),
    custom.el, strongBox,
    h('h3', {}, 'Heb je al een code?'),
    input,
    h('div', { class: 'inline-actions' }, restoreBtn),
    restore.el,
    h('h3', {}, 'Omschrijvingen'),
    h('p', {}, 'De omschrijvingen zijn door ParkPilot zelf geschreven, want ThemeParks.wiki levert ze niet. Mist er een? Kopieer de lijst en stuur hem door, dan worden ze aangevuld.'),
    copyMissing,
    h('h3', {}, 'Versie'),
    h('p', {}, `App v${APP_VERSION}${state.serverVersion ? `, server v${state.serverVersion}` : ''}. Zie je een oudere versie dan verwacht, sluit de app dan helemaal af en open hem opnieuw.`));
  document.body.append(sheet);
}

// ---- Start -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  applyTheme();
  render();
  fetchHealth().then((r) => { state.serverVersion = r.version ?? null; render(); }).catch(() => undefined);
  try {
    await ensureProfile();
    state.parks = await fetchParks();
    localStorage.setItem('pp.parks', JSON.stringify(state.parks));
  } catch {
    try { state.parks = JSON.parse(localStorage.getItem('pp.parks') ?? '[]') as ParkInfo[]; } catch { state.parks = []; }
  }
  const usable = state.parks.filter((p) => p.available);
  if (usable.length) state.parks = usable;
  if (!state.parks.some((p) => p.id === state.parkId)) state.parkId = state.parks[0]?.id ?? '';
  if (!state.parkId) { state.loading = false; state.error = 'Kan de server niet bereiken.'; render(); return; }
  await loadPark();
}

watchSystemTheme(render);
setInterval(() => { if (document.visibilityState === 'visible') void refreshLive(); }, 60_000);
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive(); });
window.addEventListener('online', () => void refreshLive());
window.addEventListener('offline', render);

void boot();
