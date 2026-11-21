import './style.css';
import {
  DEFAULT_PREFERENCES,
  type EntityInfo,
  type HistoryResponse,
  type LatLng,
  type LiveInfo,
  type ParkInfo,
  type PreferencesDto,
  type ScheduleDay,
  type ScheduleEntry,
  type ShowDayResponse,
  type SortMode,
  type TrackingMode,
} from '../../../packages/shared/src/index';
import { APP_VERSION } from '../../../packages/shared/src/version';
import { CHANGELOG } from './changelog';
import {
  ApiError, createRecoveryCode, deleteFavorite, ensureProfile, fetchEntities, fetchFavorites, fetchHealth, fetchHistoryToday,
  fetchLive, fetchParks, fetchPreferences, fetchSchedule, fetchShowDay, fetchTracking, saveTracking, putFavorite, redeemRecoveryCode, savePreferences, setCreds,
} from './api';
import { parkArt } from './art';
import { h, svg } from './dom';
import { agoLabel, clock, waitLevel } from './format';
import { GeoError, formatDistance, getPosition, haversineMeters, hasGeoPermission, walkMinutes } from './geo';
import { icon, iconForKind } from './icons';
import { blurbFor } from './info';
import { kindArt } from './kindart';
import { simulateHistory, simulateLive, simulateSchedule } from './sim';
import { distanceOf, nextStartMs, sortEntities } from './logic';
import { applyTheme, effectiveTheme, getPref, setPref, watchSystemTheme, type ThemePref } from './theme';

// ---- State -----------------------------------------------------------------------------------

type Tab = 'attractions' | 'shows' | 'favorites';
type LocStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'error';
const POS_KEY = 'pp.pos';
type View = 'full' | 'plan';
type Density = 'compact' | 'comfortable';
const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* geen opslag */ } },
};
const DEFAULT_PARK = 'dlp-studios'; // Disney Adventure World, tenzij de gebruiker zelf een ander park koos


function loadPos(): LatLng | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { lat: number; lng: number; at: number } | null;
    return p && Date.now() - p.at < 10 * 60_000 ? { lat: p.lat, lng: p.lng } : null;
  } catch { return null; }
}

const sim = (() => {
  try { const v = JSON.parse(store.get('pp.sim') ?? 'null') as { on: boolean; spot: string } | null; return { on: !!v?.on, spot: v?.spot ?? '' }; }
  catch { return { on: false, spot: '' }; }
})();
const saveSim = (): void => store.set('pp.sim', JSON.stringify(sim));

/** Simulatiestand: eigen positie, een open park en verzonnen wachttijden en showtijden. Echte data blijft in de cache. */
function applySimulation(): void {
  if (!sim.on || state.entities.length === 0) return;
  const spot = state.entities.find((e) => e.id === sim.spot && e.location) ?? null;
  const park = currentPark();
  const where = spot?.location ?? park?.center ?? null;
  if (where) { state.pos = { ...where }; state.loc = 'ok'; }
  state.live = new Map(simulateLive(state.entities).map((l) => [l.id, l]));
  state.schedule = simulateSchedule();
  state.scheduleDays = [];
  state.generatedAt = new Date().toISOString();
  state.sourceUpdatedAt = state.generatedAt;
  state.fromCache = false;
  state.error = null;
}

const state = {
  parks: [] as ParkInfo[],
  parkId: localStorage.getItem('pp.park') ?? DEFAULT_PARK,
  entities: [] as EntityInfo[],
  live: new Map<string, LiveInfo>(),
  schedule: [] as ScheduleEntry[],
  scheduleDays: [] as ScheduleDay[],
  showDay: null as string | null, // null = nu / vandaag, anders een datum JJJJ-MM-DD
  dayData: new Map<string, ShowDayResponse | 'loading' | 'error'>(),
  generatedAt: null as string | null,
  sourceUpdatedAt: null as string | null,
  favorites: new Set<string>(),
  prefs: { ...DEFAULT_PREFERENCES } as PreferencesDto,
  tab: 'attractions' as Tab,
  onlyOpen: false,
  expanded: new Set<string>(), // uitgeklapte rijen (verloop of showtijden)
  hist: new Map<string, { at: number; data: HistoryResponse | 'loading' | 'error' }>(),
  view: 'plan' as View, // bij opstarten: Mijn programma, tenzij dat leeg is (zie loadPark)
  viewDecided: false,
  refreshing: false,
  density: (store.get('pp.density') === 'comfortable' ? 'comfortable' : 'compact') as Density,
  pos: loadPos(),
  loc: 'idle' as LocStatus,
  loading: true,
  error: null as string | null,
  fromCache: false,
  serverVersion: null as string | null,
  planShowsHidden: store.get('pp.planShows') === 'hidden', // Mijn programma: shows ingeklapt (onthouden)
};

function togglePlanShows(): void {
  state.planShowsHidden = !state.planShowsHidden;
  store.set('pp.planShows', state.planShowsHidden ? 'hidden' : 'shown');
  render();
}

const root = document.getElementById('app') as HTMLElement;
const currentPark = (): ParkInfo | undefined => state.parks.find((p) => p.id === state.parkId);
const tz = (): string => currentPark()?.timezone ?? 'Europe/Paris';

// ---- Locatie (alleen op verzoek, nooit bij het opstarten) ------------------------------------
// Eenmalig per keer dat de app opent: daarna gaat de gps weer uit. Alleen ↻ of "Gebruik mijn locatie" vraagt opnieuw.
let posAskedThisSession = false;

function storePos(): void {
  if (state.pos) localStorage.setItem(POS_KEY, JSON.stringify({ ...state.pos, at: Date.now() }));
}

async function ensurePosition(): Promise<boolean> {
  if (sim.on) return true;
  posAskedThisSession = true;
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
  if (sim.on || posAskedThisSession) return;
  const needed = state.prefs.sort === 'distance' || state.view === 'plan' || [...state.favorites].some((id) => state.entities.find((e) => e.id === id)?.type === 'show');
  if (!needed || state.loc === 'denied' || state.loc === 'asking') return;
  if (state.loc !== 'ok' && !(await hasGeoPermission())) return;
  posAskedThisSession = true;
  try { state.pos = await getPosition(); state.loc = 'ok'; storePos(); } catch { /* oude positie blijft */ }
}

// ---- Afgeleide gegevens ----------------------------------------------------------------------

const todayStr = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: tz() }).format(new Date());
const addDaysStr = (d: string, n: number): string => {
  const [y, mo, da] = d.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da + n)).toISOString().slice(0, 10);
};

function parkStatus(now = Date.now()): { open: boolean | null; text: string } {
  const entries = state.schedule.filter((s) => s.type === 'OPERATING');
  if (!state.schedule.length && !state.scheduleDays.length) return { open: null, text: 'Openingstijden onbekend' };
  const list = entries.length ? entries : state.schedule;
  const cur = list.find((s) => Date.parse(s.opens) <= now && now < Date.parse(s.closes));
  if (cur) return { open: true, text: `Open tot ${clock(cur.closes, tz())}` };
  const next = list.find((s) => Date.parse(s.opens) > now);
  if (next) return { open: false, text: `Gesloten, opent om ${clock(next.opens, tz())}` };
  const today = todayStr();
  const closedAt = list.length ? clock(list[list.length - 1].closes, tz()) : null;
  const upcoming = state.scheduleDays.find((d) => d.date > today && d.entries.length);
  const first = upcoming?.entries.filter((s) => s.type === 'OPERATING')[0] ?? upcoming?.entries[0];
  const when = upcoming && first
    ? `opent ${upcoming.date === addDaysStr(today, 1) ? 'morgen' : dayLabel(upcoming.date).toLowerCase()} om ${clock(first.opens, tz())}`
    : null;
  const head = closedAt ? `Gesloten sinds ${closedAt}` : 'Vandaag gesloten';
  return { open: false, text: when ? `${head}, ${when}` : head };
}

function dayLabel(date: string): string {
  if (date === todayStr()) return 'Vandaag';
  if (date === addDaysStr(todayStr(), 1)) return 'Morgen';
  return new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function parkStats(): { openCount: number; down: number | null; refurb: number; avg: number | null; short: { name: string; min: number } | null } {
  const closed = parkStatus().open === false;
  let openCount = 0, down = 0, refurb = 0, sum = 0, n = 0;
  let short: { name: string; min: number } | null = null;
  for (const e of state.entities) {
    if (e.type !== 'attraction') continue;
    const l = state.live.get(e.id);
    if (l?.status === 'refurbishment') refurb++;
    if (closed) continue; // bij een gesloten park zijn open en storing niet actueel; onderhoud wel
    if (l?.status === 'down') down++;
    if (l?.status !== 'open') continue;
    openCount++;
    if (l.waitMinutes === null) continue;
    sum += l.waitMinutes; n++;
    if (!short || l.waitMinutes < short.min) short = { name: e.name, min: l.waitMinutes };
  }
  return { openCount, down: closed ? null : down, refurb, avg: n ? Math.round(sum / n) : null, short };
}

/** Lijsten voor de storingspagina. */
function issueLists(): { down: { e: EntityInfo; l: LiveInfo }[]; refurb: { e: EntityInfo; l: LiveInfo }[]; closedNow: { e: EntityInfo; l: LiveInfo }[] } {
  const out = { down: [] as { e: EntityInfo; l: LiveInfo }[], refurb: [] as { e: EntityInfo; l: LiveInfo }[], closedNow: [] as { e: EntityInfo; l: LiveInfo }[] };
  const parkClosed = parkStatus().open === false;
  for (const e of state.entities) {
    if (e.type !== 'attraction') continue;
    const l = state.live.get(e.id);
    if (!l) continue;
    if (l.status === 'refurbishment') out.refurb.push({ e, l });
    else if (!parkClosed && l.status === 'down') out.down.push({ e, l });
    else if (!parkClosed && l.status === 'closed') out.closedNow.push({ e, l });
  }
  const oldest = (x: { l: LiveInfo }, y: { l: LiveInfo }): number => Date.parse(x.l.changedAt ?? '') - Date.parse(y.l.changedAt ?? '') || 0;
  for (const k of ['down', 'refurb', 'closedNow'] as const) out[k].sort(oldest);
  return out;
}

const issuesKey = (): string => `pp.issuesSeen.${sim.on ? 'sim.' : ''}${state.parkId}`;

/** Sleutels van alle huidige storingen en sluitingen. Een nieuwe periode (ander tijdstip van wijziging) telt als nieuw. */
function issueKeys(): string[] {
  const l = issueLists();
  return [...l.down, ...l.refurb, ...l.closedNow].map(({ e, l: live }) => `${e.id}:${live.status}:${live.changedAt ?? ''}`);
}

function rememberIssues(): void { store.set(issuesKey(), JSON.stringify(issueKeys())); }

/** Is er sinds je laatste bezoek aan de storingspagina iets nieuws? De eerste keer (nog niets bekend) wordt de stand stil onthouden. */
function hasNewIssues(): boolean {
  if (state.entities.length === 0 || state.live.size === 0 || state.loading) return false;
  const raw = store.get(issuesKey());
  if (raw === null) {
    if (sim.on) return issueKeys().length > 0; // in de simulatie meteen zichtbaar, om het te kunnen testen
    rememberIssues();
    return false;
  }
  try {
    const seen = new Set(JSON.parse(raw) as string[]);
    return issueKeys().some((k) => !seen.has(k));
  } catch { return false; }
}

function sinceText(l: LiveInfo): string {
  if (!l.changedAt) return 'duur onbekend';
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(l.changedAt)) / 60000));
  const span = min < 1 ? 'zojuist' : min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} u${min % 60 ? ` ${min % 60} min` : ''}` : `${Math.floor(min / 1440)} dagen`;
  return l.changeObserved ? (span === 'zojuist' ? 'zojuist begonnen' : `al ${span}`) : `al minstens ${span}`;
}

function openIssues(): void {
  const lists = issueLists();
  rememberIssues();
  render();
  const close = (): void => sheet.remove();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Storingen en onderhoud' });
  const parkClosed = parkStatus().open === false;
  const section = (title: string, cls: string, rows: { e: EntityInfo; l: LiveInfo }[], empty: string): Node[] => [
    h('h3', { class: `issue-title ${cls}` }, `${title} (${rows.length})`),
    ...(rows.length ? rows.map(({ e, l }) => h('button', { class: 'issue', onclick: () => { close(); openDetail(e); } },
      h('div', { class: 'row-name' }, e.name),
      h('div', { class: 'issue-since' }, sinceText(l)))) : [h('p', {}, empty)]),
  ];
  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Storingen en onderhoud'), h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    ...(parkClosed ? [h('p', {}, 'Het park is nu dicht, dus storingen en tijdelijke sluitingen zijn niet actueel. Onderhoud (langere sluiting) staat hieronder wel.')] : []),
    ...(parkClosed ? [] : section('Storing', 'bad', lists.down, 'Geen storingen.')),
    ...section('Onderhoud (refurbishment)', 'mid', lists.refurb, 'Geen attracties in onderhoud.'),
    ...(parkClosed ? [] : section('Tijdelijk dicht', 'muted', lists.closedNow, 'Geen attracties tijdelijk dicht.')),
    h('p', { class: 'hint' }, 'De duur komt uit wat ParkPilot zelf heeft gezien. "Al minstens" betekent dat de sluiting al liep toen ParkPilot begon te meten.'));
  document.body.append(sheet);
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
  const parts: (Node | string)[] = [];
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
      : ring('', null, txt('–'));
  }
  const parkClosed = parkStatus().open === false;
  switch (live.status) {
    case 'open':
      if (parkClosed) return ring('stale', null, h('div', { class: 'ring-in' }, icon('moon', 20)));
      if (live.waitMinutes === null) return ring('', 1, txt('open'));
      {
        const r = ring(waitLevel(live.waitMinutes), Math.min(live.waitMinutes, 90) / 90, h('div', { class: `ring-in num${live.waitMinutes >= 100 ? ' tri' : ''}` }, String(live.waitMinutes)));
        const t = trendDelta(live);
        if (t) r.append(h('span', { class: `ring-arrow ${t.up ? 'up' : 'down'}`, 'aria-hidden': 'true' }, t.up ? '▲' : '▼'));
        return r;
      }
    case 'down': return h('div', { class: 'ring bare bad', 'aria-label': 'Storing' }, h('div', { class: 'ring-in bang' }, '!'));
    case 'closed': return ring('', null, h('div', { class: 'ring-in' }, icon('moon', 20)));
    case 'refurbishment': return h('div', { class: 'ring bare off', 'aria-label': 'Onderhoud' }, h('div', { class: 'ring-in' }, icon('wrench', 34)));
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

function timesNode(live: LiveInfo | undefined): Node {
  if (!live || !live.showtimes.length) return h('p', { class: 'caveat' }, 'Voor vandaag zijn geen tijden bekend.');
  const next = nextStartMs(live);
  return h('div', {},
    h('div', { class: 'section-title tight' }, 'Vandaag'),
    h('div', { class: 'times' }, ...live.showtimes.map((s) => {
      const t = Date.parse(s.start);
      return h('span', { class: `time${t === next ? ' next' : t < Date.now() ? ' past' : ''}` }, clock(t, tz()));
    })));
}

function toggleExpand(entity: EntityInfo): void {
  if (state.expanded.has(entity.id)) state.expanded.delete(entity.id);
  else {
    state.expanded.add(entity.id);
    if (entity.type === 'attraction') void loadHistory(entity.id);
  }
  render();
}

async function loadHistory(entityId: string): Promise<void> {
  const cur = state.hist.get(entityId);
  if (cur && (cur.data === 'loading' || (cur.data !== 'error' && Date.now() - cur.at < 60_000))) return;
  if (sim.on) return;
  state.hist.set(entityId, { at: Date.now(), data: 'loading' });
  try { state.hist.set(entityId, { at: Date.now(), data: await fetchHistoryToday(state.parkId, entityId) }); }
  catch { state.hist.set(entityId, { at: Date.now(), data: 'error' }); }
  render();
}

/** Het paneel dat onder een rij uitklapt: verloop van de wachttijd, of de showtijden van vandaag. */
function expandPanel(entity: EntityInfo): HTMLElement | null {
  if (!state.expanded.has(entity.id)) return null;
  if (entity.type === 'show') {
    const strip = showStrip(state.live.get(entity.id));
    return h('div', { class: 'expand' }, h('div', { class: 'section-title tight' }, 'Vandaag'), strip ?? h('p', { class: 'caveat' }, 'Voor vandaag zijn geen tijden bekend.'));
  }
  const hist = state.hist.get(entity.id);
  let inner: Node;
  if (sim.on) inner = sparkline(simulateHistory(entity.id), Date.now());
  else if (!hist || hist.data === 'loading') inner = h('div', { class: 'chart-note' }, 'Verloop laden…');
  else if (hist.data === 'error') inner = h('div', { class: 'chart-note' }, 'Verloop is nu niet beschikbaar.');
  else inner = sparkline(hist.data, Date.now());
  return h('div', { class: 'expand' }, h('div', { class: 'section-title tight' }, 'Verloop vandaag'), inner);
}

const ringToggle = (entity: EntityInfo, child: Node, cls = 'ring-btn'): HTMLElement =>
  h('button', { class: cls, 'aria-expanded': state.expanded.has(entity.id), 'aria-label': `${entity.name}, ${entity.type === 'show' ? 'tijden' : 'verloop'} ${state.expanded.has(entity.id) ? 'verbergen' : 'tonen'}`, onclick: () => toggleExpand(entity) }, child);

function renderRow(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const extra: string[] = [];
  if (entity.type === 'show') {
    const later = upcomingStarts(live).slice(1, 4);
    if (later.length) extra.push(`daarna ${later.map((t) => clock(t, tz())).join(', ')}`);
  }
  if (live && entity.type === 'attraction' && parkStatus().open !== false) {
    const label = { down: 'storing', refurbishment: 'onderhoud', closed: 'tijdelijk dicht' }[live.status as 'down' | 'refurbishment' | 'closed'];
    if (label) extra.unshift(label);
  }
  if (live?.singleRider && entity.type === 'attraction') extra.push('single rider');
  const d = distanceOf(entity, state.pos);
  if (d !== null) extra.push(`${formatDistance(d)}, ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`);
  const meta = entity.type === 'attraction' && parkStatus().open !== false ? metaLine(live) : null;
  return h('div', { class: 'rowwrap' },
    h('div', { class: 'row' },
      ringToggle(entity, statusRing(entity, live)),
      h('button', { class: 'row-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, entity.name),
          kindLine(entity, extra),
          meta)),
      heartButton(entity)),
    expandPanel(entity));
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
  return h('div', { class: 'showwrap' }, h('div', { class: 'showcard' },
    ringToggle(entity, whenNode, 'when-btn'),
    h('button', { class: 'showcard-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
      h('div', { class: 'showcard-main' },
        h('div', { class: 'row-name' }, entity.name),
        kindLine(entity, later.length ? [`daarna ${later.map((t) => clock(t, tz())).join(', ')}`] : []),
        note ? h('div', { class: 'row-meta' }, note) : null,
        dep ? h('div', { class: 'depart' }, icon('pin', 14), `${dep.text} (${dep.walk} min lopen)`) : null)),
    heartButton(entity)), expandPanel(entity));
}

function byNextStart(a: EntityInfo, b: EntityInfo): number {
  return (nextStartMs(state.live.get(a.id)) ?? Infinity) - (nextStartMs(state.live.get(b.id)) ?? Infinity) || a.name.localeCompare(b.name, 'nl');
}

function dayBar(): HTMLElement {
  const today = todayStr();
  const fromSchedule = state.scheduleDays.map((d) => d.date).filter((d) => d > today);
  const dates = fromSchedule.length ? fromSchedule.slice(0, 5) : [1, 2, 3].map((n) => addDaysStr(today, n));
  return h('div', { class: 'daybar', role: 'group', 'aria-label': 'Dag' },
    h('button', { class: 'day', 'aria-pressed': state.showDay === null, onclick: () => selectDay(null) }, 'Nu'),
    ...dates.map((d) => h('button', { class: 'day', 'aria-pressed': state.showDay === d, onclick: () => selectDay(d) }, dayLabel(d))));
}

function selectDay(date: string | null): void {
  state.showDay = date;
  render();
  if (date) void loadShowDay(date);
}

async function loadShowDay(date: string): Promise<void> {
  const key = `${state.parkId}:${date}`;
  const cur = state.dayData.get(key);
  if (cur && cur !== 'error') return;
  state.dayData.set(key, 'loading');
  try { state.dayData.set(key, await fetchShowDay(state.parkId, date)); }
  catch { state.dayData.set(key, 'error'); }
  render();
}

function programmeNodes(date: string): Node[] {
  const data = state.dayData.get(`${state.parkId}:${date}`);
  if (!data || data === 'loading') return [h('div', { class: 'empty' }, 'Programma laden…')];
  if (data === 'error') return [h('div', { class: 'empty' }, 'Het programma is nu niet beschikbaar.', h('div', {}, h('button', { class: 'btn', onclick: () => { state.dayData.delete(`${state.parkId}:${date}`); void loadShowDay(date); render(); } }, 'Opnieuw proberen')))];
  const byId = new Map(state.entities.map((e) => [e.id, e]));
  const slots = data.shows.flatMap((s) => s.slots.map((slot) => ({ entity: byId.get(s.entityId), slot }))).filter((x): x is { entity: EntityInfo; slot: (typeof data.shows)[number]['slots'][number] } => !!x.entity)
    .sort((a, b) => Date.parse(a.slot.start) - Date.parse(b.slot.start) || a.entity.name.localeCompare(b.entity.name, 'nl'));
  const out: Node[] = [];
  const open = data.opening.filter((o) => o.type === 'OPERATING')[0] ?? data.opening[0];
  const guessed = slots.some((x) => x.slot.source === 'verwacht');
  out.push(h('div', { class: 'prog-note' },
    `${dayLabel(date)}${open ? `, park open ${clock(open.opens, tz())} tot ${clock(open.closes, tz())}` : ''}.`,
    guessed ? ` Tijden met een streepjesrand zijn een verwachting op basis van ${data.expectedBasis ?? 'eerdere dagen'}. ThemeParks.wiki meldt voor deze dag nog geen definitieve tijden, dus ze kunnen afwijken.` : ''));
  if (!slots.length) {
    out.push(h('div', { class: 'empty' }, 'Voor deze dag zijn nog geen showtijden bekend. ParkPilot onthoudt de tijden die het ziet en kan er daarna een verwachting van maken.'));
    return out;
  }
  for (const { entity, slot } of slots) {
    const t = Date.parse(slot.start);
    out.push(h('div', { class: `slot${state.favorites.has(entity.id) ? ' fav' : ''}${slot.source === 'verwacht' ? ' guess' : ''}` },
      h('button', { class: 'slot-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
        h('div', { class: 'slot-time' }, clock(t, tz())),
        h('div', { class: 'row-main' }, h('div', { class: 'row-name' }, entity.name), kindLine(entity, slot.source === 'verwacht' ? ['verwacht'] : []))),
      heartButton(entity)));
  }
  return out;
}

const distText = (entity: EntityInfo): string | null => {
  const d = distanceOf(entity, state.pos);
  return d === null ? null : `${formatDistance(d)} · ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`;
};

/** Afstand vooraan de regel, groot: voor attracties en shows precies hetzelfde blok. */
function distBlock(entity: EntityInfo): HTMLElement {
  const d = distanceOf(entity, state.pos);
  if (d === null) return h('div', { class: 'pdist none' }, h('span', { class: 'pdnum' }, '–'));
  const near = d < 1000;
  const num = near ? String(Math.max(10, Math.round(d / 10) * 10)) : (d / 1000).toFixed(1).replace('.', ',');
  return h('div', { class: 'pdist' },
    h('span', { class: 'pdnum' }, num, h('small', {}, near ? 'm' : 'km')),
    h('span', { class: 'pdwalk' }, `${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`));
}

/** Alle showtijden van vandaag naast elkaar: geweest is grijs, wat nog komt vol, de eerstvolgende onderstreept, met een "nu"-streepje ertussen. */
function showStrip(live: LiveInfo | undefined): HTMLElement | null {
  const all = (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter(Number.isFinite).sort((x, y) => x - y);
  if (!all.length) return null;
  const now = Date.now();
  const past = all.filter((t) => t <= now), up = all.filter((t) => t > now);
  const t = (ms: number, cls: string): HTMLElement => h('span', { class: `pt ${cls}` }, clock(ms, tz()));
  return h('div', { class: 'pstrip', 'aria-label': 'Showtijden vandaag' },
    ...past.map((ms) => t(ms, 'past')),
    h('span', { class: 'pnow' }, 'nu'),
    ...up.map((ms, i) => t(ms, i === 0 ? 'next' : '')));
}

function planShow(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const starts = upcomingStarts(live);
  const next = starts[0] ?? null;
  const after = starts[1] ?? null; // in het overzicht alleen de eerstvolgende na de volgende; de rest zit in het uitklappen
  const dep = next !== null ? departure(entity, next) : null;
  const byDist = state.prefs.sort === 'distance';
  const nextText = next !== null ? clock(next, tz()) : '–';
  const sub = [next !== null ? untilLabel(next) : live ? 'geen shows meer vandaag' : 'tijden laden…', byDist ? null : distText(entity), dep?.text ?? null].filter(Boolean).join(' · ');
  const later = after !== null ? h('div', { class: 'plater' }, h('small', {}, 'daarna'), h('span', {}, clock(after, tz()))) : null;
  return h('div', { class: 'rowwrap' },
    h('div', { class: `prow show${next === null ? ' none' : ''}` },
      byDist ? distBlock(entity) : ringToggle(entity, h('span', { class: 'pbig' }, nextText), 'ptoggle'),
      h('button', { class: 'pmain', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
        h('div', { class: 'pname' }, entity.name),
        h('div', { class: 'psub' }, sub)),
      byDist
        ? h('div', { class: 'pend' }, ringToggle(entity, h('span', { class: 'pbig tm' }, nextText), 'ptoggle'), later)
        : later),
    expandPanel(entity));
}

function planAttraction(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const closed = parkStatus().open === false;
  const byDist = state.prefs.sort === 'distance';
  let label = '–', cls = '';
  if (live && !closed) {
    if (live.status === 'open') {
      if (live.waitMinutes !== null) { label = String(live.waitMinutes); cls = waitLevel(live.waitMinutes); } else label = 'open';
    } else label = { down: 'storing', closed: 'dicht', refurbishment: 'onderhoud', open: 'open', unknown: '–' }[live.status];
  } else if (closed) label = 'dicht';
  const t = closed ? null : trendDelta(live);
  const dist = byDist ? null : distText(entity);
  return h('div', { class: 'rowwrap' },
    h('div', { class: 'prow' },
      byDist ? distBlock(entity) : null,
      h('button', { class: 'pmain', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
        h('div', { class: 'pname' }, entity.name),
        dist ? h('div', { class: 'psub' }, dist) : null),
      ringToggle(entity, h('span', { class: 'pright' },
        t ? h('span', { class: `trend ${t.up ? 'up' : 'down'}` }, `${t.up ? '▲' : '▼'}${Math.abs(t.diff)}`) : null,
        h('span', { class: `pbig ${cls}${label.length > 3 ? ' word' : ''}` }, label)), 'ptoggle')),
    expandPanel(entity));
}

/** Dichtstbijzijnde attractie of show binnen 400 meter, voor de kleine kop. */
function nearestName(): string | null {
  if (!state.pos) return null;
  let best: { name: string; d: number } | null = null;
  for (const e of state.entities) {
    if (!e.location) continue;
    const d = haversineMeters(state.pos, e.location);
    if (!best || d < best.d) best = { name: e.name, d };
  }
  return best && best.d <= 400 ? best.name : null;
}

function planHeader(): HTMLElement {
  const near = nearestName();
  return h('header', { class: 'phead' },
    h('button', { class: 'pback', onclick: () => setView('full') }, '‹ Overzicht'),
    h('div', { class: 'ploc' }, h('b', {}, currentPark()?.shortName ?? ''), near ? ` · bij ${near}` : ''),
    refreshButton(),
    h('button', { class: 'icon-btn', 'aria-label': 'Instellingen', onclick: openSettings }, icon('gear', 20)));
}

function planNodes(): Node[] {
  const favs = state.entities.filter((e) => state.favorites.has(e.id));
  const ctx = { sort: state.prefs.sort, live: state.live, pos: state.pos };
  const render1 = (e: EntityInfo): HTMLElement => (e.type === 'show' ? planShow(e) : planAttraction(e));
  const showList = favs.filter((e) => e.type === 'show');
  const hidden = state.planShowsHidden && showList.length > 0;
  // Ingeklapt: één tikbare regel in plaats van de shows.
  const showsTitle = (): HTMLElement => h('button', { class: 'ptitle pshows-toggle', 'aria-expanded': !hidden, onclick: togglePlanShows },
    hidden ? `Shows (${showList.length}) ▸` : 'Shows ▾');
  // Op afstand: shows en attracties door elkaar, de dichtstbijzijnde bovenaan.
  if (state.prefs.sort === 'distance') {
    return hidden ? [showsTitle(), ...sortEntities(favs.filter((e) => e.type !== 'show'), ctx).map(render1)] : sortEntities(favs, ctx).map(render1);
  }
  // Anders blijven de shows bovenaan, op starttijd (of naam), en daaronder de attracties.
  const shows = state.prefs.sort === 'name' ? [...showList].sort((x, y) => x.name.localeCompare(y.name, 'nl')) : showList.sort(byNextStart);
  const atts = sortEntities(favs.filter((e) => e.type === 'attraction'), ctx);
  const out: Node[] = [];
  if (shows.length) out.push(showsTitle(), ...(hidden ? [] : shows.map(planShow)));
  if (atts.length) out.push(h('h2', { class: 'ptitle' }, 'Attracties'), ...atts.map(planAttraction));
  return out;
}

function listNodes(): Node[] {
  const ctx = { sort: state.prefs.sort, live: state.live, pos: state.pos };
  const parkClosed = parkStatus().open === false;
  const openOk = (e: EntityInfo): boolean => !state.onlyOpen || e.type !== 'attraction' || (!parkClosed && state.live.get(e.id)?.status === 'open');
  const out: Node[] = [];
  if (state.tab === 'attractions') {
    for (const e of sortEntities(state.entities.filter((x) => x.type === 'attraction' && openOk(x)), ctx)) out.push(renderRow(e));
  } else if (state.tab === 'shows' && state.showDay) {
    out.push(...programmeNodes(state.showDay));
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
  if (state.prefs.sort === 'distance' || state.view === 'plan') {
    if (state.loc === 'asking') return h('div', { class: 'notice' }, 'Locatie bepalen…');
    if (state.loc === 'denied') {
      return h('div', { class: 'notice' }, 'ParkPilot mag je locatie niet gebruiken. Zet dat aan via Instellingen op je iPhone, bij Privacy en beveiliging, Locatievoorzieningen. Open daarna de app opnieuw.');
    }
    if (!state.pos) {
      return h('div', { class: 'notice' },
        state.loc === 'error' ? 'Locatie bepalen is niet gelukt.' : state.view === 'plan' ? 'Voor afstanden en looptijd heeft ParkPilot je locatie nodig.' : 'Sorteren op afstand heeft je locatie nodig.',
        h('div', {}, h('button', { class: 'btn', onclick: () => void ensurePosition() }, 'Gebruik mijn locatie')));
    }
  }
  if (state.view !== 'plan' && state.pos && park && haversineMeters(state.pos, park.center) > 3000) {
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
  const newIssues = hasNewIssues();
  const plan = state.view === 'plan';
  const nodes = state.entities.length ? (plan ? planNodes() : listNodes()) : [];

  let body: Node;
  if (state.loading && state.entities.length === 0) body = h('div', { class: 'empty' }, 'Gegevens laden…');
  else if (state.entities.length === 0) body = h('div', { class: 'empty' }, state.error ?? 'Geen attracties gevonden voor dit park.');
  else if (nodes.length === 0) {
    body = h('div', { class: 'empty' }, plan ? 'Je programma is nog leeg. Kies Overzicht en tik op het hartje bij attracties en shows die je wilt volgen.' : state.onlyOpen && status.open === false ? 'Het park is dicht, dus er is nu niets open.' : state.tab === 'favorites' ? 'Nog niets om te volgen. Tik op het hartje bij een attractie of show.' : 'Niets gevonden met dit filter.');
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
  document.documentElement.dataset.density = state.density;
  const scrollTop = window.scrollY;
  const closedNote = !plan && status.open === false && state.tab !== 'shows' && state.entities.length
    ? h('div', { class: 'closed-note' }, 'Het park is nu dicht. Er zijn geen actuele wachttijden.') : null;
  const items: (Node | null)[] = [
    sim.on ? h('div', { class: 'simbar' }, 'SIMULATIE: verzonnen wachttijden en showtijden, alsof je in het park staat. ', h('button', { onclick: () => void setSim(false) }, 'Stop')) : null,
    plan ? planHeader() : h('header', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('div', { class: 'brand' }, 'ParkPilot', h('span', { class: 'ver' }, `v${APP_VERSION}`)),
        h('div', { class: 'top-actions' },
          refreshButton(),
          h('button', { class: 'icon-btn aa', 'aria-label': state.density === 'compact' ? 'Grotere tekst' : 'Compacte tekst', onclick: () => setDensity(state.density === 'compact' ? 'comfortable' : 'compact') }, 'Aa'),
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
        state.entities.length && !plan
          ? h('div', { class: 'stats' },
              h('button', { class: `stat issues${newIssues ? ' alert' : ''}`, 'aria-label': `Open, storing en onderhoud: toon de storingspagina${newIssues ? '. Er is iets nieuws' : ''}`, onclick: openIssues },
                icon('door', 18),
                h('div', { class: 'snums' },
                  h('div', { class: 'snum good' }, h('b', {}, String(stats.openCount))),
                  h('div', { class: 'snum bad' }, h('b', {}, stats.down === null ? '–' : String(stats.down))),
                  h('div', { class: 'snum off' }, h('b', {}, String(stats.refurb))))),
              h('div', { class: 'stat' }, icon('gauge', 18), h('b', {}, stats.avg === null ? '–' : String(stats.avg)), h('span', {}, 'gemiddeld')),
              h('div', { class: 'stat' }, icon('bolt', 18), h('b', {}, stats.short ? String(stats.short.min) : '–'), h('span', {}, stats.short ? `korst: ${stats.short.name}` : 'korst')))
          : null)),
    plan ? h('div', { class: 'pbar' },
      h('div', { class: 'pleft' },
        h('div', { class: 'pseg', role: 'group', 'aria-label': 'Sorteren' },
          ...(['wait', 'distance', 'name'] as SortMode[]).map((mode) => h('button', { 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, { wait: 'Wachttijd', distance: 'Afstand', name: 'Naam' }[mode]))),
        state.entities.some((e) => e.type === 'show' && state.favorites.has(e.id))
          ? h('button', { class: 'pchip', 'aria-pressed': !state.planShowsHidden, 'aria-label': state.planShowsHidden ? 'Shows tonen' : 'Shows inklappen', onclick: togglePlanShows }, 'Shows')
          : null),
      h('div', { class: `pfresh${offline || state.error || state.fromCache || srcStale ? ' stale' : ''}` },
        offline ? `geen verbinding, gegevens van ${age}` : state.error ? `verversen mislukt, gegevens van ${age}` : state.fromCache ? `opgeslagen, ${age}` : `bron ${agoLabel(state.sourceUpdatedAt ?? state.generatedAt)}`)) : h('nav', { class: 'nav' },
      h('div', { class: 'segments', role: 'group', 'aria-label': 'Modus' },
        h('button', { 'aria-pressed': !plan, onclick: () => setView('full') }, 'Overzicht'),
        h('button', { 'aria-pressed': plan, onclick: () => setView('plan') }, 'Mijn programma')),
      plan ? null : h('div', { class: 'segments sub', role: 'group', 'aria-label': 'Weergave' },
        h('button', { 'aria-pressed': state.tab === 'attractions', onclick: () => setTab('attractions') }, 'Attracties'),
        h('button', { 'aria-pressed': state.tab === 'shows', onclick: () => setTab('shows') }, 'Shows'),
        h('button', { 'aria-pressed': state.tab === 'favorites', onclick: () => setTab('favorites') }, `Volgend${state.favorites.size ? ` (${state.favorites.size})` : ''}`)),
      plan || (state.tab === 'shows' && state.showDay) ? null : h('div', { class: 'chips', role: 'group', 'aria-label': 'Sorteren en filteren' },
        ...sortLabels.map(([mode, text]) => h('button', { class: 'chip', 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, text)),
        state.tab !== 'shows'
          ? h('button', { class: 'chip divider', 'aria-pressed': state.onlyOpen, onclick: () => { state.onlyOpen = !state.onlyOpen; render(); } }, 'Alleen open')
          : null),
      h('div', { class: `fresh${offline || state.error || state.fromCache || srcStale ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    ...[locationNotice(), !plan && state.tab === 'shows' && state.entities.length ? dayBar() : null].filter((n): n is HTMLElement => n !== null),
    closedNote,
    h('main', {}, body),
    h('footer', { class: 'foot' },
      `ParkPilot v${APP_VERSION}${state.serverVersion && state.serverVersion !== APP_VERSION ? ` · server v${state.serverVersion}` : ''} · wachttijden via ThemeParks.wiki · niet gelieerd aan Disney`)];
  root.replaceChildren(...items.filter((n): n is Node => n !== null));
  window.scrollTo(0, scrollTop);
}

function toggleTheme(): void {
  setPref(effectiveTheme() === 'dark' ? 'light' : 'dark');
  render();
}

async function setSim(on: boolean, spot?: string): Promise<void> {
  sim.on = on;
  if (spot !== undefined) sim.spot = spot;
  saveSim();
  if (on) { applySimulation(); render(); }
  else { state.pos = loadPos(); state.loc = 'idle'; render(); await refreshLive(); }
}

function setView(view: View): void {
  state.view = view; render(); window.scrollTo(0, 0);
  if (view === 'plan') void refreshPositionQuietly().then(render);
}
function setDensity(d: Density): void { state.density = d; store.set('pp.density', d); render(); }

function setTab(tab: Tab): void { state.tab = tab; render(); }

function switchPark(id: string): void {
  if (id === state.parkId) return;
  state.parkId = id;
  state.showDay = null;
  try { localStorage.setItem('pp.park', id); } catch { /* geen opslag */ }
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
  const rows = data.rows.map((r) => ({ t: Math.max(Date.parse(data.from), Date.parse(r.at)), down: r.status === 'down', open: r.status === 'open' && r.wait !== null, y: r.status === 'open' && r.wait !== null ? r.wait : 0 }));
  if (rows.length < 2) return h('div', { class: 'chart-note' }, 'Het verloop van vandaag wordt opgebouwd zodra ParkPilot wijzigingen ziet. Kom later terug.');
  const from = rows[0].t;
  const max = Math.max(60, ...rows.map((p) => p.y));
  const x = (t: number): number => PAD + ((t - from) / Math.max(1, now - from)) * (W - 2 * PAD);
  const y = (v: number): number => H - PAD - (v / max) * (H - 2 * PAD);
  const shapes: SVGElement[] = [];
  for (const g of [20, 45]) {
    if (g < max) shapes.push(svg('path', { d: `M${PAD} ${y(g).toFixed(1)}H${W - PAD}`, stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '3 4', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  // Storingen: lichtrode zone over de hele hoogte en een gestippelde rode lijn onderin voor de duur.
  const outages: { from: number; to: number }[] = [];
  rows.forEach((r, i) => {
    if (!r.down) return;
    const to = i + 1 < rows.length ? rows[i + 1].t : now;
    const last = outages[outages.length - 1];
    if (last && last.to === r.t) last.to = to; else outages.push({ from: r.t, to });
  });
  for (const o of outages) {
    const x0 = x(o.from), x1 = Math.max(x(o.to), x0 + 2);
    shapes.push(svg('rect', { x: x0.toFixed(1), y: 0, width: (x1 - x0).toFixed(1), height: H, fill: 'var(--high)', 'fill-opacity': 0.17 }));
  }
  rows.forEach((r, i) => {
    const t1 = i + 1 < rows.length ? rows[i + 1].t : now;
    if (i > 0) shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(rows[i - 1].y).toFixed(1)}V${y(r.y).toFixed(1)}`, stroke: 'var(--muted)', 'stroke-opacity': 0.5, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
    shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(r.y).toFixed(1)}H${x(t1).toFixed(1)}`, stroke: levelColor(r), 'stroke-width': 3.5, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  });
  for (const o of outages) {
    const x0 = x(o.from), x1 = Math.max(x(o.to), x0 + 2);
    shapes.push(svg('path', { d: `M${x0.toFixed(1)} ${y(0).toFixed(1)}H${x1.toFixed(1)}`, stroke: 'var(--high)', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 6', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  const downMin = Math.round(outages.reduce((sum, o) => sum + (o.to - o.from), 0) / 60000);
  const fmtMin = (min: number): string => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} u${min % 60 ? ` ${min % 60} min` : ''}`);
  const open = rows.filter((r) => r.open).map((r) => r.y);
  const ticks = [0, 20, 45, max].filter((v, i, arr) => v <= max && arr.indexOf(v) === i && (v !== 45 || max - 45 >= 8) && (v !== 20 || max >= 28));
  return h('div', {},
    h('div', { class: 'chartrow' },
      svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Verloop van de wachttijd vandaag' }, ...shapes),
      h('div', { class: 'yaxis', 'aria-hidden': 'true' }, ...ticks.map((v) => h('span', { style: `top:${((y(v) / H) * 100).toFixed(1)}%` }, String(v))))),
    h('div', { class: 'chart-axis' }, h('span', {}, clock(from, tz())), h('span', {}, 'nu')),
    outages.length ? h('div', { class: 'chart-note outage' }, `Storing: ${outages.length === 1 ? '1 keer' : `${outages.length} keer`}, samen ${fmtMin(downMin)}. Lichtrode zone en gestippelde lijn.`) : null,
    h('div', { class: 'chart-note' }, open.length
      ? `Vandaag laagst ${Math.min(...open)}, hoogst ${Math.max(...open)}. Schaal in minuten wachttijd. Alleen wijzigingen die ParkPilot zag.`
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
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, 'wachttijd')));
    } else {
      const t = { open: 'Open, geen wachttijd bekend', down: 'Storing', closed: 'Dicht', refurbishment: 'In onderhoud', unknown: 'Status onbekend' }[live.status];
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, t)));
    }
    addFact('Wachttijd gewijzigd', live.changeObserved ? agoLabel(live.changedAt) : null);
    if (live.changeObserved && live.prevWaitMinutes !== null) addFact('Daarvoor', String(live.prevWaitMinutes));
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
    (sim.on ? Promise.resolve(simulateHistory(entity.id)) : fetchHistoryToday(state.parkId, entity.id))
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
    kind ? kindArt(kind) : null,
    ...bigNodes,
    entity.type === 'attraction' ? h('div', { class: 'section-title' }, 'Verloop vandaag') : null,
    entity.type === 'attraction' ? chartBox : null,
    facts.childNodes.length ? facts : null,
    caveat,
    blurb ? h('div', { class: 'about' },
      h('p', {}, blurb.text),
      blurb.area || blurb.opened ? h('div', { class: 'tip' }, h('b', {}, 'Gebied: '), [blurb.area, blurb.opened ? `geopend in ${blurb.opened}` : null].filter(Boolean).join(', ')) : null,
      blurb.height ? h('div', { class: 'tip' }, h('b', {}, 'Minimale lengte: '), blurb.height) : null,
      blurb.tip ? h('div', { class: 'tip' }, h('b', {}, 'Tip: '), blurb.tip) : null,
      h('div', { class: 'tip' }, 'Omschrijving en lengte zijn door ParkPilot samengesteld. Controleer de borden bij de ingang.')) : null,
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
      entities: state.entities, favorites: [...state.favorites], live: [...state.live.values()], schedule: state.schedule, generatedAt: state.generatedAt, sourceUpdatedAt: state.sourceUpdatedAt,
    }));
  } catch { /* opslag vol: geen ramp */ }
}

function loadCache(parkId: string): boolean {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(parkId)) ?? 'null') as
      { entities: EntityInfo[]; favorites?: string[]; live: LiveInfo[]; schedule: ScheduleEntry[]; generatedAt: string; sourceUpdatedAt?: string | null } | null;
    if (!c) return false;
    state.entities = c.entities;
    state.favorites = new Set(c.favorites ?? []);
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
  state.loading = true; state.entities = []; state.live = new Map(); state.schedule = []; state.scheduleDays = [];
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
    state.scheduleDays = schedule?.days ?? [];
    state.favorites = new Set(favs.map((f) => f.entityId));
    state.prefs = prefs;
    if (!state.viewDecided) { state.viewDecided = true; state.view = state.favorites.size ? 'plan' : 'full'; }
    saveCache();
    applySimulation();
    await refreshPositionQuietly();
  } catch (err) {
    if (parkId !== state.parkId) return;
    if (!loadCache(parkId)) {
      state.error = err instanceof ApiError && err.code === 'park_not_found_upstream' ? 'Dit park is niet gevonden bij ThemeParks.wiki.' : 'Gegevens laden mislukt.';
    }
  }
  if (!state.viewDecided) { state.viewDecided = true; state.view = state.favorites.size ? 'plan' : 'full'; }
  state.loading = false;
  render();
}

/** Handmatig verversen: slaat de cache over en vraagt de bron meteen opnieuw. Alleen de bron zelf bepaalt hoe vers de data is. */
async function forceRefresh(): Promise<void> {
  if (state.refreshing) return;
  state.refreshing = true;
  render();
  const started = Date.now();
  posAskedThisSession = false; // ↻ werkt ook je locatie één keer bij
  await refreshLive(true);
  await new Promise((r) => setTimeout(r, Math.max(0, 600 - (Date.now() - started)))); // even zichtbaar draaien
  state.refreshing = false;
  render();
}

const refreshButton = (): HTMLElement => h('button', { class: `icon-btn refresh${state.refreshing ? ' spin' : ''}`, 'aria-label': 'Nu verversen', onclick: () => void forceRefresh() }, icon('refresh', 22));

let lastSchedule = Date.now(), lastFavs = Date.now();

async function refreshLive(force = false): Promise<void> {
  if (!state.parkId || state.entities.length === 0) return;
  try {
    // Favorieten worden mee ververst, zodat wijzigingen vanaf een ander apparaat met dezelfde koppelcode verschijnen.
    // Zuinig: wachttijden bij elke ronde, openingstijden hooguit elk kwartier en de favorieten (voor andere toestellen) elke 5 minuten.
    const now = Date.now();
    const needSchedule = force || now - lastSchedule > 15 * 60_000;
    const needFavs = force || now - lastFavs > 5 * 60_000;
    const [live, schedule, favs] = await Promise.all([
      fetchLive(state.parkId, force),
      needSchedule ? fetchSchedule(state.parkId).catch(() => null) : Promise.resolve(null),
      needFavs ? fetchFavorites(state.parkId).catch(() => null) : Promise.resolve(null),
    ]);
    if (schedule) lastSchedule = now;
    if (favs) lastFavs = now;
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.sourceUpdatedAt = live.sourceUpdatedAt;
    if (schedule) { state.schedule = schedule.today; state.scheduleDays = schedule.days ?? []; }
    if (favs) state.favorites = new Set(favs.map((f) => f.entityId));
    state.error = null; state.fromCache = false;
    saveCache();
    applySimulation();
    for (const id of state.expanded) if (state.entities.find((e) => e.id === id)?.type === 'attraction') void loadHistory(id);
  } catch { state.error = 'Verversen mislukt,'; }
  await refreshPositionQuietly();
  render();
}

// ---- Update zoeken ----------------------------------------------------------------------------

/** Vraagt de server welke versie live staat. Is die anders dan deze app, dan laadt de app opnieuw met de nieuwe versie. */
async function checkForUpdate(btn: HTMLButtonElement, say: (t: string, kind?: 'good' | 'err' | '') => void): Promise<void> {
  if (!navigator.onLine) { say('Geen verbinding, zoeken naar een update lukt nu niet.', 'err'); return; }
  btn.disabled = true;
  say('Zoeken naar een update…');
  try {
    const res = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    const live = ((await res.json()) as { version?: string }).version ?? null;
    state.serverVersion = live;
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
    await reg?.update().catch(() => undefined);
    if (live && live !== APP_VERSION) {
      say(`Nieuwe versie ${live} gevonden. Bijwerken…`, 'good');
      setTimeout(() => location.reload(), 800);
      return;
    }
    say(`Je hebt de nieuwste versie (${APP_VERSION}).`, 'good');
  } catch {
    say('Zoeken naar een update is mislukt. Probeer het zo nog eens.', 'err');
  }
  btn.disabled = false;
}

// ---- Instellingen en koppelcode --------------------------------------------------------------

function openSettings(): void {
  const mkMsg = (): { el: HTMLElement; say: (t: string, kind?: 'good' | 'err' | '') => void } => {
    const el = h('div', { class: 'msg', role: 'status' });
    return { el, say: (t, kind = '') => { el.className = `msg ${kind}`.trim(); el.textContent = t; } };
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Instellingen' });
  const close = (): void => sheet.remove();

  // Versie + update zoeken
  const update = mkMsg();
  const updateBtn = h('button', { class: 'btn secondary', onclick: () => void checkForUpdate(updateBtn as HTMLButtonElement, update.say) },
    `Versie ${APP_VERSION} · zoek update`) as HTMLButtonElement;

  // Thema
  const themeLabels: [ThemePref, string][] = [['auto', 'Automatisch'], ['light', 'Licht'], ['dark', 'Donker']];
  const themeBox = h('div', { class: 'segments', role: 'group', 'aria-label': 'Thema' });
  const paintTheme = (): void => {
    themeBox.replaceChildren(...themeLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': getPref() === v, onclick: () => { setPref(v); paintTheme(); render(); } }, t)));
  };
  paintTheme();

  const densLabels: [Density, string][] = [['compact', 'Compact'], ['comfortable', 'Comfortabel (grotere tekst)']];
  const densBox = h('div', { class: 'segments', role: 'group', 'aria-label': 'Tekstgrootte' });
  const paintDens = (): void => {
    densBox.replaceChildren(...densLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': state.density === v, onclick: () => { setDensity(v); paintDens(); } }, t)));
  };
  paintDens();

  // Geschiedenis bijhouden (server)
  const trackMsg = mkMsg();
  const trackBox = h('div', { class: 'segments', role: 'group', 'aria-label': 'Geschiedenis bijhouden' });
  const trackLabels: [TrackingMode, string][] = [['off', 'Uit'], ['park-hours', 'Alleen overdag'], ['always', 'Altijd']];
  let trackMode: TrackingMode | null = null;
  const paintTrack = (): void => {
    trackBox.replaceChildren(...trackLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': trackMode === v, onclick: async () => {
        const before = trackMode;
        trackMode = v; paintTrack();
        try { const r = await saveTracking(v); trackMode = r.mode; trackMsg.say(v === 'off' ? 'Bijhouden staat uit.' : v === 'always' ? 'De server houdt dag en nacht bij.' : 'De server houdt alleen bij rond de openingstijden.', 'good'); }
        catch { trackMode = before; trackMsg.say('Opslaan mislukt.', 'err'); }
        paintTrack();
      } }, t)));
  };
  paintTrack();
  fetchTracking().then((r) => { trackMode = r.mode; paintTrack(); }).catch(() => trackMsg.say('Instelling ophalen mislukt.', 'err'));

  // Simulatie
  const simSpots = state.entities.filter((e) => e.location);
  const simSelect = h('select', { class: 'select', 'aria-label': 'Simulatielocatie', onchange: (ev: Event) => void setSim(true, (ev.target as HTMLSelectElement).value) },
    h('option', { value: '' }, 'Midden in het park'),
    ...[...simSpots].sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((e) => h('option', { value: e.id, selected: e.id === sim.spot }, e.name)));
  const simBox = h('div', { class: 'segments', role: 'group', 'aria-label': 'Simulatie' });
  const paintSim = (): void => {
    simBox.replaceChildren(
      h('button', { 'aria-pressed': !sim.on, onclick: () => { void setSim(false); paintSim(); } }, 'Uit'),
      h('button', { 'aria-pressed': sim.on, onclick: () => { void setSim(true); paintSim(); } }, 'Aan'));
  };
  paintSim();

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
    h('h3', {}, 'Tekstgrootte'), densBox,
    h('h3', {}, 'Geschiedenis bijhouden'),
    h('p', {}, 'De server onthoudt wachttijden (voor de daggrafiek en de pijltjes) en showtijden (voor de verwachting van morgen). Met "Alleen overdag" gebeurt dat rond de openingstijden van het park, een half uur ervoor en erna. Deze instelling geldt voor de hele server, dus ook voor iedereen die jouw installatie gebruikt.'),
    trackBox, trackMsg.el,
    h('h3', {}, 'Simulatie (om te testen)'),
    h('p', {}, 'Doet alsof je in het park staat: het park is open, je locatie staat bij de gekozen plek en de wachttijden en showtijden zijn verzonnen (ze verschuiven elke 5 minuten, zodat je pijltjes ziet). Er wordt niets opgeslagen of verstuurd. Bovenin de app zie je een balk zolang dit aan staat.'),
    simBox,
    h('label', { class: 'field' }, h('span', {}, 'Ik sta bij'), simSelect),
    h('h3', {}, 'Shows'),
    h('label', { class: 'field' }, h('span', {}, 'Ik wil zo ver van tevoren bij een show zijn'), marginSelect,
      h('div', { class: 'hint' }, 'Hiermee toont ParkPilot bij shows die je volgt wanneer je moet vertrekken, zodra je locatie bekend is. Een melding hierover komt in een volgende versie.')),
    h('label', { class: 'field' }, h('span', {}, 'Looptempo'), speedSelect),
    h('h3', {}, 'Locatie'),
    h('p', {}, 'ParkPilot gebruikt je locatie alleen voor afstanden en vertrektijden, en alleen nadat je daar zelf om vraagt. De locatie wordt één keer bepaald als je de app opent; daarna gaat de gps weer uit. Tik op ↻ om je locatie bij te werken als je verder bent gelopen. Je locatie wordt niet naar de server gestuurd.'),
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
    updateBtn, update.el,
    h('details', { class: 'changelog' },
      h('summary', {}, 'Wat is er nieuw'),
      ...CHANGELOG.map((c) => h('div', { class: 'cl-entry' },
        h('div', { class: 'cl-head' }, h('b', {}, c.version === 'Eerder' ? 'Eerder' : `Versie ${c.version}`), c.date ? h('span', {}, c.date) : null),
        h('ul', {}, ...c.changes.map((t) => h('li', {}, t)))))));
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
  if (!state.parks.some((p) => p.id === state.parkId)) {
    state.parkId = state.parks.some((p) => p.id === DEFAULT_PARK) ? DEFAULT_PARK : state.parks[0]?.id ?? '';
  }
  if (!state.parkId) { state.loading = false; state.error = 'Kan de server niet bereiken.'; render(); return; }
  await loadPark();
}

watchSystemTheme(render);
let tick = 0;
// Zuinig verversen, alleen als de app zichtbaar is en er verbinding is: Mijn programma elke minuut, het Overzicht elke 2 minuten.
setInterval(() => {
  tick++;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (tick % (state.view === 'plan' ? 2 : 4) === 0) void refreshLive();
}, 30_000);
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive(); });
window.addEventListener('online', () => void refreshLive());
window.addEventListener('offline', render);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

void boot();
