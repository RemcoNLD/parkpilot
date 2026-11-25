import './style.css';
import {
  DEFAULT_PREFERENCES,
  type EntityInfo,
  type HistoryResponse,
  type WeekRefResponse,
  type IncidentsResponse,
  type LatLng,
  type LiveInfo,
  type ParkInfo,
  type PreferencesDto,
  type ScheduleDay,
  type ScheduleEntry,
  type ShowDayResponse,
  type SortMode,
  type TrackingMode,
  isSourceStale,
  isLongClosed,
} from '../../../packages/shared/src/index';
import { APP_VERSION } from '../../../packages/shared/src/version';
import { CHANGELOG, changelogDate, changesFor } from './changelog';
import {
  ApiError, createRecoveryCode, deleteFavorite, deleteShowLocation, ensureProfile, putShowLocation, fetchEntities, fetchFavorites, fetchHealth, fetchHistoryToday, fetchIncidents, fetchWeekRef,
  fetchLive, fetchParks, fetchPreferences, fetchSchedule, fetchShowDay, fetchTracking, saveTracking, putFavorite, redeemRecoveryCode, savePreferences, setCreds,
} from './api';
import { parkArt, parkIcon } from './art';
import { h, svg } from './dom';
import { agoLabel, clock, dec1, dur, durHuman, minutesSince, waitLevel } from './format';
import { applyLang, getLangPref, kindName, lang, LANG_NAMES, LANGS, setLangPref, t as T, type LangPref } from './i18n';
import { GeoError, formatDistance, getPosition, getPrecisePosition, haversineMeters, hasGeoPermission, walkMinutes } from './geo';
import { icon, iconForKind } from './icons';
import { blurbFor } from './info';
import { kindArt } from './kindart';
import { codeTakenOffer, openHelp, openTour, tourWanted } from './onboarding';
import { gameAskOn, openGame, setGameAsk } from './game';
import { simulateHistory, simulateIncidents, simulateLive, simulateSchedule } from './sim';
import { distanceOf, nextStartMs, sortEntities } from './logic';
import { applyTheme, effectiveTheme, getPref, setPref, watchSystemTheme, type ThemePref } from './theme';

// ---- State -----------------------------------------------------------------------------------

type Tab = 'attractions' | 'shows' | 'favorites';
type LocStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'error';
const POS_KEY = 'pp.pos';
type View = 'full' | 'plan';
/** Wachttijdverloop van één attractie. `at` = wanneer deze gegevens van de server kwamen; `ok` = laatste poging lukte. */
type HistEntry = { at: number; data: HistoryResponse | null; ok: boolean };
type Density = 'compact' | 'comfortable';
const store = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* geen opslag */ } },
  remove: (k: string): void => { try { localStorage.removeItem(k); } catch { /* geen opslag */ } },
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
  hist: new Map<string, HistEntry>(),
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
  planDoneHidden: store.get('pp.planDone') === 'hidden', // Mijn programma: afgestreepte rijen verborgen (onthouden)
};

function togglePlanDone(): void {
  state.planDoneHidden = !state.planDoneHidden;
  store.set('pp.planDone', state.planDoneHidden ? 'hidden' : 'shown');
  render();
}

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
  if (!state.schedule.length && !state.scheduleDays.length) return { open: null, text: T.hoursUnknown };
  const list = entries.length ? entries : state.schedule;
  const cur = list.find((s) => Date.parse(s.opens) <= now && now < Date.parse(s.closes));
  if (cur) return { open: true, text: T.openUntil(clock(cur.closes, tz())) };
  const next = list.find((s) => Date.parse(s.opens) > now);
  if (next) return { open: false, text: T.closedOpensAt(clock(next.opens, tz())) };
  const today = todayStr();
  const closedAt = list.length ? clock(list[list.length - 1].closes, tz()) : null;
  const upcoming = state.scheduleDays.find((d) => d.date > today && d.entries.length);
  const first = upcoming?.entries.filter((s) => s.type === 'OPERATING')[0] ?? upcoming?.entries[0];
  const when = upcoming && first
    ? T.opensOn(upcoming.date === addDaysStr(today, 1) ? T.tomorrowInline : T.lowerInline ? dayLabel(upcoming.date).toLowerCase() : dayLabel(upcoming.date), clock(first.opens, tz()))
    : null;
  const head = closedAt ? T.closedSince(closedAt) : T.closedToday;
  return { open: false, text: when ? `${head}, ${when}` : head };
}

function dayLabel(date: string): string {
  if (date === todayStr()) return T.today;
  if (date === addDaysStr(todayStr(), 1)) return T.tomorrow;
  return new Intl.DateTimeFormat(T.locale, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

/** Bron zegt al lang niets over deze attractie (open, met wachttijd): getal grijs tonen. Alleen bij open park. */
function srcStale(live: LiveInfo | undefined): boolean {
  return !sim.on && isSourceStale(live) && parkStatus().open !== false;
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
    if (l.waitMinutes === null || srcStale(l)) continue; // oude getallen niet meetellen in gemiddelde en kortste
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
  const since = (l: LiveInfo): number => Date.parse(l.longClosedSince ?? l.changedAt ?? '');
  const oldest = (x: { l: LiveInfo }, y: { l: LiveInfo }): number => since(x.l) - since(y.l) || 0;
  for (const k of ['down', 'refurb', 'closedNow'] as const) out[k].sort(oldest);
  return out;
}

/** Live-gegevens in de app zetten; langdurig dichte attracties (isLongClosed) tellen als onderhoud. */
function liveMap(list: LiveInfo[], now = Date.now()): Map<string, LiveInfo> {
  return new Map(list.map((l) => [l.id, isLongClosed(l, now)
    ? { ...l, status: 'refurbishment' as const, longClosedSince: l.updatedAt as string }
    : l]));
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
  if (l.longClosedSince) {
    const at = Date.parse(l.longClosedSince);
    const date = new Date(at).toLocaleDateString(T.locale, { day: 'numeric', month: 'short', timeZone: tz() });
    return T.longClosedSince(date, Math.floor((Date.now() - at) / 86400_000));
  }
  if (!l.changedAt) return T.durUnknown;
  const min = minutesSince(l.changedAt);
  if (min < 1) return l.changeObserved ? T.justStarted : T.atLeast(T.justNow);
  const span = min < 48 * 60 ? dur(min) : T.days(Math.floor(min / 1440));
  return l.changeObserved ? T.forSpan(span) : T.atLeast(span);
}

// ---- Storingen van vandaag (storingspagina, sinds 0.20.0) -------------------------------------
// Opgehaald bij het openen van de storingspagina; bewaard per park voor vandaag, zodat je bij slecht bereik
// de laatste stand ziet (grijs met tijdstip), net als bij het verloop in de grafiek.

type IncEntry = { at: number; ok: boolean; data: IncidentsResponse | null };
const incMem = new Map<string, IncEntry>();
const incKey = (parkId: string): string => `pp.inc.${parkId}`;

function incEntry(parkId = state.parkId): IncEntry | null {
  const m = incMem.get(parkId);
  if (m) return m;
  try {
    const v = JSON.parse(store.get(incKey(parkId)) ?? 'null') as { date: string; at: number; data: IncidentsResponse } | null;
    if (v && v.date === todayStr()) {
      const e = { at: v.at, ok: true, data: v.data };
      incMem.set(parkId, e);
      return e;
    }
  } catch { /* kapotte opslag: negeren */ }
  return null;
}

async function loadIncidents(): Promise<void> {
  const parkId = state.parkId;
  const cur = incEntry(parkId);
  if (cur?.ok && Date.now() - cur.at < 60_000) return; // hooguit eens per minuut
  try {
    const data = await fetchIncidents(parkId);
    const at = Date.now();
    incMem.set(parkId, { at, ok: true, data });
    store.set(incKey(parkId), JSON.stringify({ date: todayStr(), at, data }));
  } catch {
    incMem.set(parkId, { at: cur?.at ?? 0, ok: false, data: cur?.data ?? null });
  }
}

/** Sortering van de storingstabel. Standaard nieuwste eerst; onthouden op dit toestel (`pp.incSort`). */
type IncSortKey = 'time' | 'dur' | 'name';
const INC_SORT_KEY = 'pp.incSort';
let incSort: { key: IncSortKey; dir: 1 | -1 } = (() => {
  try {
    const v = JSON.parse(store.get(INC_SORT_KEY) ?? 'null') as { key: IncSortKey; dir: 1 | -1 } | null;
    if (v && ['time', 'dur', 'name'].includes(v.key) && (v.dir === 1 || v.dir === -1)) return v;
  } catch { /* negeren */ }
  return { key: 'time', dir: -1 };
})();

/** Zelfde kop nog eens: omdraaien. Andere kop: tijd en duur beginnen aflopend (nieuwste/langste), naam oplopend (A–Z). */
function setIncSort(key: IncSortKey): void {
  incSort = incSort.key === key ? { key, dir: incSort.dir === 1 ? -1 : 1 } : { key, dir: key === 'name' ? 1 : -1 };
  store.set(INC_SORT_KEY, JSON.stringify(incSort));
}

/** Storingen van vandaag: samenvatting en een sorteerbare tabel (tijd · duur · attractie). */
function incidentsNode(close: () => void): HTMLElement {
  const now = Date.now();
  const entry: IncEntry | null = sim.on ? { at: now, ok: true, data: simulateIncidents(state.entities, now) } : incEntry();
  const box = h('div', { class: 'inc' });
  if (!entry?.data) {
    box.append(h('p', { class: 'inc-msg' }, entry && !entry.ok ? T.incOffline : T.incLoading));
    return box;
  }
  const stale = !entry.ok || now - entry.at > 10 * 60_000;
  if (stale) box.classList.add('stale');
  const byId = new Map(state.entities.map((e) => [e.id, e]));
  // Alleen wat binnen de openingstijden valt telt (een "storing" terwijl het park dicht is, is geen storing).
  const hours = todayHours();
  const items = entry.data.incidents
    .filter((i) => byId.has(i.entityId))
    .map((i) => {
      const s0 = Date.parse(i.start);
      const e0 = i.end ? Date.parse(i.end) : Math.max(now, s0);
      const s = hours ? Math.max(s0, hours.from) : s0;
      const e = hours ? Math.min(e0, Math.max(hours.to, s)) : e0;
      return { ...i, s, e, cut: !i.startKnown || s > s0, min: Math.max(1, Math.round((e - s) / 60000)) };
    })
    .filter((x) => !hours || x.e > hours.from);
  if (!items.length) {
    box.append(h('p', { class: 'inc-msg' }, T.incNone));
    if (stale) box.append(h('p', { class: 'inc-stale' }, T.histStale(clock(entry.at, tz()))));
    return box;
  }

  // Tabel: één regel per storing (tijd · duur · attractie). Sorteren door op de kop te tikken (sinds 0.21.1).
  const rides = new Set(items.map((x) => x.entityId)).size;
  const totalMin = items.reduce((n, x) => n + x.min, 0);
  box.append(h('p', { class: 'inc-sum' }, ...T.incSummary(items.length, rides, dur(totalMin)).map((part, i) => (i % 2 ? h('b', {}, part) : part))));
  const nameOf = (x: typeof items[number]): string => byId.get(x.entityId)?.name ?? '';
  const table = h('div', { class: 'inc-table', role: 'table' });
  const paintTable = (): void => {
    const { key, dir } = incSort;
    const cmp = (x: typeof items[number], y: typeof items[number]): number =>
      key === 'dur' ? x.min - y.min : key === 'name' ? nameOf(x).localeCompare(nameOf(y), T.locale) : x.s - y.s;
    const rows = [...items].sort((x, y) => dir * cmp(x, y) || y.s - x.s);
    const head = (k: IncSortKey, label: string): Node => {
      const on = key === k;
      return h('button', {
        class: `inc-sort${on ? ' on' : ''}`, role: 'columnheader',
        'aria-sort': on ? (dir === 1 ? 'ascending' : 'descending') : 'none',
        onclick: () => { setIncSort(k); paintTable(); },
      }, label, h('span', { class: 'inc-arrow', 'aria-hidden': 'true' }, on ? (dir === 1 ? '▲' : '▼') : ''));
    };
    table.replaceChildren(h('div', { class: 'inc-tr inc-th', role: 'row' },
      head('time', T.incColTime), head('dur', T.incColDur), head('name', T.incColName)));
    for (const x of rows) {
      const e = byId.get(x.entityId) as EntityInfo;
      const live = x.end === null;
      table.append(h('button', { class: `inc-tr${live ? ' live' : ''}`, role: 'row', onclick: () => { close(); openDetail(e); } },
        h('span', { class: 'inc-time', role: 'cell' }, `${x.startKnown || hours ? clock(x.s, tz()) : T.incEarlier}–${live ? T.now : clock(x.e, tz())}`),
        h('span', { class: 'inc-dur', role: 'cell' }, dur(x.min)),
        h('span', { class: 'inc-name', role: 'cell' }, live ? h('i', { class: 'inc-dot', 'aria-label': T.incOngoing }) : null, e.name)));
    }
  };
  paintTable();
  box.append(table);
  if (stale) box.append(h('p', { class: 'inc-stale' }, T.histStale(clock(entry.at, tz()))));
  return box;
}

function openIssues(): void {
  const lists = issueLists();
  rememberIssues();
  render();
  const close = (): void => sheet.remove();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': T.issuesTitle });
  const parkClosed = parkStatus().open === false;
  const section = (title: string, cls: string, rows: { e: EntityInfo; l: LiveInfo }[], empty: string): Node[] => [
    h('h3', { class: `issue-title ${cls}` }, `${title} (${rows.length})`),
    ...(rows.length ? rows.map(({ e, l }) => h('button', { class: 'issue', onclick: () => { close(); openDetail(e); } },
      h('div', { class: 'row-name' }, e.name),
      h('div', { class: 'issue-since' }, sinceText(l)))) : [h('p', {}, empty)]),
  ];
  let inc = incidentsNode(close);
  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, T.issuesTitle), h('button', { class: 'icon-btn', 'aria-label': T.close, onclick: close }, '✕')),
    ...(parkClosed ? [h('p', {}, T.issuesParkClosed)] : []),
    ...(parkClosed ? [] : section(T.secDown, 'bad', lists.down, T.noDown)),
    h('h3', { class: 'issue-title inc-title' }, T.incTitle),
    inc,
    ...section(T.secRefurb, 'mid', lists.refurb, T.noRefurb),
    ...(parkClosed ? [] : section(T.secClosed, 'muted', lists.closedNow, T.noClosed)));
  document.body.append(sheet);
  if (!sim.on) {
    void loadIncidents().then(() => {
      if (!sheet.isConnected) return;
      const next = incidentsNode(close);
      inc.replaceWith(next);
      inc = next;
    });
  }
}

/** Wanneer de wachttijd/status voor het laatst veranderde. Onze cron ziet een wijziging pas een paar minuten
 *  nadat de bron hem doorgaf; is de bron-update ouder dan ons tijdstip, dan gebeurde de wijziging uiterlijk
 *  toen. Zo is "veranderd" nooit recenter dan "bevestigd". Zelfde regel voor "al gelijk sinds". */
function changedAtMs(live: LiveInfo | undefined): number | null {
  if (!live?.changedAt) return null;
  const c = Date.parse(live.changedAt);
  const u = live.updatedAt ? Date.parse(live.updatedAt) : NaN;
  return Number.isFinite(u) ? Math.min(c, u) : c;
}

/** Tekst voor de rij: "@24 min geleden", of (niet zelf zien veranderen) "@meer dan 3 u 10 min geleden". */
function changedText(live: LiveInfo | undefined): string {
  const c = changedAtMs(live);
  if (c === null) return '';
  const min = Math.max(0, Math.floor((Date.now() - c) / 60000));
  if (live!.changeObserved) return T.atAgo(min < 1 ? T.justNow : T.ago(durHuman(min)));
  return min < 1 ? '' : T.atMoreThan(durHuman(min));
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
  return h('span', { class: `trend ${t.up ? 'up' : 'down'}`, 'aria-label': t.up ? T.longer(t.diff) : T.shorter(-t.diff) },
    `${t.up ? '▲ +' : '▼ −'}${Math.abs(t.diff)}`);
}

/** Hoe vers de meting van de bron is: groen tot 10 minuten, oranje tot 30, daarna rood. */
function freshness(iso: string | null): 'fresh' | 'aging' | 'old' | 'unknown' {
  if (!iso) return 'unknown';
  const min = (Date.now() - Date.parse(iso)) / 60000;
  return min <= 10 ? 'fresh' : min <= 30 ? 'aging' : 'old';
}

/** Regel onder de naam: ▼ −5 · @24 min geleden. Versheid van de bron staat bovenaan de lijst en in het detailvenster. */
function metaLine(live: LiveInfo | undefined): HTMLElement | null {
  if (!live) return null;
  const parts: (Node | string)[] = [];
  const trend = trendNode(live);
  if (trend) parts.push(trend);
  const changed = changedText(live);
  if (changed) parts.push(parts.length ? ' · ' : '', changed);
  return parts.length ? h('div', { class: 'row-meta one' }, ...parts) : null;
}

function upcomingStarts(live: LiveInfo | undefined): number[] {
  return (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter((t) => t > Date.now());
}

function untilLabel(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((ms - now) / 60000));
  return m < 1 ? T.now : T.inDur(dur(m));
}

/** Vertrektijd voor een show: starttijd min jouw aankomstmarge min de looptijd. Alleen met bekende locatie. */
function departure(entity: EntityInfo, startMs: number): { text: string; walk: number } | null {
  const d = distanceOf(entity, state.pos);
  if (d === null) return null;
  const walk = walkMinutes(d, state.prefs.walkingSpeedKmh);
  const at = startMs - (state.prefs.arrivalMarginMin + walk) * 60_000;
  return { text: at > Date.now() ? T.leaveAt(clock(at, tz())) : T.leaveNow, walk };
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
      if (live.waitMinutes === null) return ring('', 1, txt(T.open));
      if (srcStale(live)) return ring('nosrc', Math.min(live.waitMinutes, 90) / 90, h('div', { class: `ring-in num${live.waitMinutes >= 100 ? ' tri' : ''}`, title: T.staleSrc }, String(live.waitMinutes)));
      {
        const r = ring(waitLevel(live.waitMinutes), Math.min(live.waitMinutes, 90) / 90, h('div', { class: `ring-in num${live.waitMinutes >= 100 ? ' tri' : ''}` }, String(live.waitMinutes)));
        const t = trendDelta(live);
        if (t) r.append(h('span', { class: `ring-arrow ${t.up ? 'up' : 'down'}`, 'aria-hidden': 'true' }, t.up ? '▲' : '▼'));
        return r;
      }
    case 'down': return h('div', { class: 'ring bare bad', 'aria-label': T.downCap }, h('div', { class: 'ring-in bang' }, '!'));
    case 'closed': return ring('', null, h('div', { class: 'ring-in' }, icon('moon', 20)));
    case 'refurbishment': return h('div', { class: 'ring bare off', 'aria-label': T.refurbCap }, h('div', { class: 'ring-in' }, icon('wrench', 34)));
    default: return ring('', null, txt('–'));
  }
}

function kindLine(entity: EntityInfo, extra: string[] = []): HTMLElement | null {
  const kind = kindOf(entity);
  if (!kind && !extra.length) return null;
  return h('div', { class: 'row-sub' },
    kind ? icon(iconForKind(kind), 14) : null,
    kind ? kindName(kind) : null,
    ...extra.map((e) => h('span', { class: 'plain' }, `· ${e}`)));
}

function timesNode(live: LiveInfo | undefined): Node {
  if (!live || !live.showtimes.length) return h('p', { class: 'caveat' }, T.noTimesToday);
  const next = nextStartMs(live);
  return h('div', {},
    h('div', { class: 'section-title tight' }, T.today),
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

// ---- Wachttijdverloop: in het geheugen én op het toestel bewaard ------------------------------
// Bij slecht bereik toont de app het laatst opgehaalde verloop (grijs, "niet actueel") en haalt het later
// vanzelf opnieuw op zodra verversen weer lukt. Alleen van vandaag (Parijse datum), per park.

const HIST_FRESH_MS = 60_000;      // niet vaker ophalen dan eens per minuut
const HIST_CURRENT_MS = 10 * 60_000; // ouder dan dit = niet actueel (grijs), ook als het ophalen toen lukte
const histKey = (): string => `pp.hist.${state.parkId}`;
const histLoads = new Map<string, Promise<void>>();

function storedHist(): Record<string, { at: number; data: HistoryResponse }> {
  try {
    const v = JSON.parse(store.get(histKey()) ?? 'null') as { date: string; items: Record<string, { at: number; data: HistoryResponse }> } | null;
    return v && v.date === todayStr() ? v.items : {};
  } catch { return {}; }
}

function saveHist(id: string, at: number, data: HistoryResponse): void {
  const items = storedHist();
  items[id] = { at, data };
  store.set(histKey(), JSON.stringify({ date: todayStr(), items }));
}

function histEntry(id: string): HistEntry | undefined {
  let cur = state.hist.get(id);
  if (!cur) {
    const saved = storedHist()[id];
    if (saved) { cur = { at: saved.at, data: saved.data, ok: false }; state.hist.set(id, cur); }
  }
  return cur;
}

const histCurrent = (e: HistEntry | undefined): boolean => !!e && e.ok && Date.now() - e.at < HIST_CURRENT_MS;

function loadHistory(entityId: string): Promise<void> {
  if (sim.on) return Promise.resolve();
  void loadRef(entityId);
  const running = histLoads.get(entityId);
  if (running) return running;
  const cur = histEntry(entityId);
  if (cur?.ok && Date.now() - cur.at < HIST_FRESH_MS) return Promise.resolve();
  const parkId = state.parkId;
  const p = (async () => {
    try {
      const data = await fetchHistoryToday(parkId, entityId);
      if (parkId !== state.parkId) return;
      const at = Date.now();
      state.hist.set(entityId, { at, data, ok: true });
      saveHist(entityId, at, data);
    } catch {
      // Oude gegevens blijven staan, gemarkeerd als niet actueel.
      const e = histEntry(entityId);
      state.hist.set(entityId, e ? { ...e, ok: false } : { at: 0, data: null, ok: false });
    } finally {
      histLoads.delete(entityId);
    }
    render();
  })();
  histLoads.set(entityId, p);
  return p;
}

// ---- Vorige weken (stippellijn): zelfde weekdag, één keer per dag per attractie opgehaald -------------
// Verandert niet tijdens de dag, dus op het toestel bewaard (pp.ref.<park>, alleen vandaag).

const refKey = (): string => `pp.ref.${state.parkId}`;
const refMem = new Map<string, WeekRefResponse>();
const refLoads = new Set<string>();

function storedRefs(): Record<string, WeekRefResponse> {
  try {
    const v = JSON.parse(store.get(refKey()) ?? 'null') as { date: string; items: Record<string, WeekRefResponse> } | null;
    return v && v.date === todayStr() ? v.items : {};
  } catch { return {}; }
}

function refEntry(id: string): WeekRefResponse | undefined {
  const cur = refMem.get(id);
  if (cur && cur.date === todayStr()) return cur;
  const saved = storedRefs()[id];
  if (saved) refMem.set(id, saved);
  return saved;
}

async function loadRef(entityId: string): Promise<void> {
  if (sim.on || refLoads.has(entityId) || refEntry(entityId)) return;
  const parkId = state.parkId;
  refLoads.add(entityId);
  try {
    const data = await fetchWeekRef(parkId, entityId);
    if (parkId !== state.parkId || data.date !== todayStr()) return;
    refMem.set(entityId, data);
    const items = storedRefs();
    items[entityId] = data;
    store.set(refKey(), JSON.stringify({ date: todayStr(), items }));
    render();
  } catch { /* geen bereik: later opnieuw, de grafiek werkt ook zonder */ } finally {
    refLoads.delete(entityId);
  }
}

/** Kop "Verloop vandaag" + grafiek, of een melding. Niet actueel = grijze achtergrond, tijdstip rechts in de kop.
 *  Kop en kader zijn in beide standen even groot, zodat de grafiek niet verspringt als het bijwerken klaar is. */
function historyNode(entity: EntityInfo, titleCls = 'section-title'): Node {
  const head = (note: string | null): HTMLElement =>
    h('div', { class: `${titleCls} chart-head` }, h('span', {}, T.histToday), note ? h('span', { class: 'stale-note' }, note) : null);
  if (sim.on) return h('div', {}, head(null), h('div', { class: 'chart-wrap' }, sparkline(simulateHistory(entity.id), Date.now())));
  const e = histEntry(entity.id);
  if (!e?.data) {
    return h('div', {}, head(null), h('div', { class: 'chart-note' }, histLoads.has(entity.id) || !e ? T.histLoading : T.histUnavailable));
  }
  const chart = sparkline(withLiveTail(e.data, state.live.get(entity.id)), Date.now(), refEntry(entity.id));
  if (histCurrent(e)) return h('div', {}, head(null), h('div', { class: 'chart-wrap' }, chart));
  const note = histLoads.has(entity.id) ? T.histUpdating(clock(e.at, tz())) : T.histStale(clock(e.at, tz()));
  return h('div', {}, head(note), h('div', { class: 'chart-wrap chart-stale' }, chart));
}

/** Het paneel dat onder een rij uitklapt: verloop van de wachttijd, of de showtijden van vandaag. */
function expandPanel(entity: EntityInfo): HTMLElement | null {
  if (!state.expanded.has(entity.id)) return null;
  if (entity.type === 'show') {
    const strip = showStrip(state.live.get(entity.id));
    return h('div', { class: 'expand' }, h('div', { class: 'section-title tight' }, T.today), strip ?? h('p', { class: 'caveat' }, T.noTimesToday));
  }
  return h('div', { class: 'expand' }, singleRiderLine(state.live.get(entity.id)), historyNode(entity, 'section-title tight'));
}

/** Wachttijd voor single riders in het uitklappen, alleen als de attractie een single-rider-rij heeft en open is. */
function singleRiderLine(live: LiveInfo | undefined): HTMLElement | null {
  if (!live?.singleRider || live.status !== 'open' || parkStatus().open === false) return null;
  const w = live.singleRiderWait ?? null;
  return h('div', { class: 'srline' }, h('span', {}, T.singleRider),
    w === null ? h('span', { class: 'srnone' }, T.srNone) : h('b', { class: srcStale(live) ? 'nosrc' : waitLevel(w) }, String(w)));
}

const ringToggle = (entity: EntityInfo, child: Node, cls = 'ring-btn'): HTMLElement =>
  h('button', { class: cls, 'aria-expanded': state.expanded.has(entity.id), 'aria-label': T.toggleAria(entity.name, entity.type === 'show', state.expanded.has(entity.id)), onclick: () => toggleExpand(entity) }, child);

function renderRow(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const extra: string[] = [];
  if (entity.type === 'show') {
    const later = upcomingStarts(live).slice(1, 4);
    if (later.length) extra.push(T.later(later.map((t) => clock(t, tz())).join(', ')));
  }
  if (live && entity.type === 'attraction' && parkStatus().open !== false) {
    const label = { down: T.down, refurbishment: T.refurb, closed: T.tempClosed }[live.status as 'down' | 'refurbishment' | 'closed'];
    if (label) extra.unshift(label);
  }
  if (live?.singleRider && entity.type === 'attraction') extra.push(T.singleRiderLower);
  const d = distanceOf(entity, state.pos);
  if (d !== null) extra.push(`${formatDistance(d)}, ${T.walkMin(walkMinutes(d, state.prefs.walkingSpeedKmh))}`);
  const meta = entity.type === 'attraction' && parkStatus().open !== false ? metaLine(live) : null;
  return h('div', { class: 'rowwrap' },
    withLongPress(entity, h('div', { class: `row${inQueue(entity) ? ' inq' : ''}` },
      ringToggle(entity, statusRing(entity, live)),
      h('button', { class: 'row-open', 'aria-label': T.details(entity.name), onclick: () => openDetail(entity) },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-name' }, entity.name),
          kindLine(entity, extra),
          meta)),
      heartButton(entity))),
    expandPanel(entity));
}

function heartButton(entity: EntityInfo): HTMLElement {
  const isFav = state.favorites.has(entity.id);
  return h('button', {
    class: 'heart', 'aria-pressed': isFav,
    'aria-label': isFav ? T.unfollow(entity.name) : T.follow(entity.name),
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
    whenNode = h('div', { class: 'when none' }, h('b', {}, '–'), h('span', {}, T.noneLeft));
    note = !live ? T.timesLoading : live.showtimes.length ? T.noMoreShows : T.noTimesToday;
  }
  const dep = next !== null ? departure(entity, next) : null;
  return h('div', { class: 'showwrap' }, withLongPress(entity, h('div', { class: 'showcard' },
    ringToggle(entity, whenNode, 'when-btn'),
    h('button', { class: 'showcard-open', 'aria-label': T.details(entity.name), onclick: () => openDetail(entity) },
      h('div', { class: 'showcard-main' },
        h('div', { class: 'row-name' }, entity.name),
        kindLine(entity, later.length ? [T.later(later.map((t) => clock(t, tz())).join(', '))] : []),
        note ? h('div', { class: 'row-meta' }, note) : null,
        dep ? h('div', { class: 'depart' }, icon('pin', 14), `${dep.text} (${T.walkMin(dep.walk)})`) : null)),
    heartButton(entity))), expandPanel(entity));
}

function byNextStart(a: EntityInfo, b: EntityInfo): number {
  return (nextStartMs(state.live.get(a.id)) ?? Infinity) - (nextStartMs(state.live.get(b.id)) ?? Infinity) || a.name.localeCompare(b.name, lang);
}

function dayBar(): HTMLElement {
  const today = todayStr();
  const fromSchedule = state.scheduleDays.map((d) => d.date).filter((d) => d > today);
  const dates = fromSchedule.length ? fromSchedule.slice(0, 5) : [1, 2, 3].map((n) => addDaysStr(today, n));
  return h('div', { class: 'daybar', role: 'group', 'aria-label': T.day },
    h('button', { class: 'day', 'aria-pressed': state.showDay === null, onclick: () => selectDay(null) }, T.nowCap),
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
  if (!data || data === 'loading') return [h('div', { class: 'empty' }, T.progLoading)];
  if (data === 'error') return [h('div', { class: 'empty' }, T.progUnavailable, h('div', {}, h('button', { class: 'btn', onclick: () => { state.dayData.delete(`${state.parkId}:${date}`); void loadShowDay(date); render(); } }, T.retry)))];
  const byId = new Map(state.entities.map((e) => [e.id, e]));
  const slots = data.shows.flatMap((s) => s.slots.map((slot) => ({ entity: byId.get(s.entityId), slot }))).filter((x): x is { entity: EntityInfo; slot: (typeof data.shows)[number]['slots'][number] } => !!x.entity)
    .sort((a, b) => Date.parse(a.slot.start) - Date.parse(b.slot.start) || a.entity.name.localeCompare(b.entity.name, lang));
  const out: Node[] = [];
  const open = data.opening.filter((o) => o.type === 'OPERATING')[0] ?? data.opening[0];
  out.push(h('div', { class: 'prog-note' }, `${dayLabel(date)}${open ? T.progOpen(clock(open.opens, tz()), clock(open.closes, tz())) : ''}`));
  if (!slots.length) {
    out.push(h('div', { class: 'empty' }, T.progEmpty));
    return out;
  }
  for (const { entity, slot } of slots) {
    const t = Date.parse(slot.start);
    out.push(h('div', { class: `slot${state.favorites.has(entity.id) ? ' fav' : ''}${slot.source === 'verwacht' ? ' guess' : ''}` },
      h('button', { class: 'slot-open', 'aria-label': T.details(entity.name), onclick: () => openDetail(entity, { date, slots: slots.filter((x) => x.entity.id === entity.id).map((x) => x.slot) }) },
        h('div', { class: 'slot-time' }, clock(t, tz())),
        h('div', { class: 'row-main' }, h('div', { class: 'row-name' }, entity.name), kindLine(entity, slot.source === 'verwacht' ? [T.expected] : []))),
      heartButton(entity)));
  }
  return out;
}

const distText = (entity: EntityInfo): string | null => {
  const d = distanceOf(entity, state.pos);
  return d === null ? null : `${formatDistance(d)} · ${T.walkMin(walkMinutes(d, state.prefs.walkingSpeedKmh))}`;
};

/** Afstand vooraan de regel, groot: voor attracties en shows precies hetzelfde blok. */
function distBlock(entity: EntityInfo): HTMLElement {
  const d = distanceOf(entity, state.pos);
  if (d === null) return h('div', { class: 'pdist none' }, h('span', { class: 'pdnum' }, '–'));
  const near = d < 1000;
  const num = near ? String(Math.max(10, Math.round(d / 10) * 10)) : dec1(d / 1000);
  return h('div', { class: 'pdist' },
    h('span', { class: 'pdnum' }, num, h('small', {}, near ? 'm' : 'km')),
    h('span', { class: 'pdwalk' }, T.walkMin(walkMinutes(d, state.prefs.walkingSpeedKmh))));
}

/** Alle showtijden van vandaag naast elkaar: geweest is grijs, wat nog komt vol, de eerstvolgende onderstreept, met een "nu"-streepje ertussen. */
function showStrip(live: LiveInfo | undefined): HTMLElement | null {
  const all = (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter(Number.isFinite).sort((x, y) => x - y);
  if (!all.length) return null;
  const now = Date.now();
  const past = all.filter((t) => t <= now), up = all.filter((t) => t > now);
  const t = (ms: number, cls: string): HTMLElement => h('span', { class: `pt ${cls}` }, clock(ms, tz()));
  return h('div', { class: 'pstrip', 'aria-label': T.showtimesToday },
    ...past.map((ms) => t(ms, 'past')),
    h('span', { class: 'pnow' }, T.now),
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
  const sub = [next !== null ? untilLabel(next) : live ? T.noMoreShowsLower : T.timesLoadingLower, byDist ? null : distText(entity), dep?.text ?? null].filter(Boolean).join(' · ');
  const later = after !== null ? h('div', { class: 'plater' }, h('small', {}, T.laterLabel), h('span', {}, clock(after, tz()))) : null;
  return h('div', { class: 'rowwrap' },
    withLongPress(entity, h('div', { class: `prow show${next === null ? ' none' : ''}` },
      byDist ? distBlock(entity) : ringToggle(entity, h('span', { class: 'pbig' }, nextText), 'ptoggle'),
      h('button', { class: 'pmain', 'aria-label': T.details(entity.name), onclick: () => openDetail(entity) },
        h('div', { class: 'pname' }, entity.name),
        h('div', { class: 'psub' }, sub)),
      byDist
        ? h('div', { class: 'pend' }, ringToggle(entity, h('span', { class: `pnumcol${planLayout.side ? ' gutter' : ''}` }, h('span', { class: 'pbig tm' }, nextText)), 'ptoggle'), later)
        : later)),
    expandPanel(entity));
}

function planAttraction(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const closed = parkStatus().open === false;
  const byDist = state.prefs.sort === 'distance';
  let label = '–', cls = '';
  if (live && !closed) {
    if (live.status === 'open') {
      if (live.waitMinutes !== null) { label = String(live.waitMinutes); cls = srcStale(live) ? 'nosrc' : waitLevel(live.waitMinutes); } else label = T.open;
    } else label = { down: T.down, closed: T.closed, refurbishment: T.refurb, open: T.open, unknown: '–' }[live.status];
  } else if (closed) label = T.closed;
  const t = closed || srcStale(live) ? null : trendDelta(live);
  const dist = byDist ? null : distText(entity);
  // Single rider klein rechtsboven de wachttijd: alleen een getal, alleen als de bron er een geeft en de attractie open is.
  const sr = srOf(live);
  return h('div', { class: 'rowwrap' },
    withLongPress(entity, h('div', { class: `prow${inQueue(entity) ? ' inq' : ''}` },
      byDist ? distBlock(entity) : null,
      h('button', { class: 'pmain', 'aria-label': T.details(entity.name), onclick: () => openDetail(entity) },
        h('div', { class: 'pname' }, entity.name),
        dist ? h('div', { class: 'psub' }, dist) : null),
      ringToggle(entity, h('span', { class: 'pright' },
        h('span', { class: `pnumcol${planLayout.side ? ' gutter' : ''}` },
          h('span', { class: `pbig pwait-xl ${cls}${label.length > 3 ? ' word' : ''}`, style: label.length > 3 ? null : `min-width:${planLayout.digits}ch` }, label),
          // Rechts van de wachttijd, onder elkaar: single rider (badge) boven, verschil (▲/▼) onder.
          sr !== null ? h('span', { class: `psr ${srcStale(live) ? 'nosrc' : waitLevel(sr)}`, 'aria-label': `${T.singleRiderLower} ${sr}` }, String(sr)) : null,
          t ? h('span', { class: `trend ptr ${t.up ? 'up' : 'down'}` }, `${t.up ? '▲' : '▼'}${Math.abs(t.diff)}`) : null)), 'ptoggle'))),
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

/** Schakelaar bovenin, in beide schermen op dezelfde plek: Alles (hele park) of Mijn dag (favorieten). */
function viewSwitch(): HTMLElement {
  const plan = state.view === 'plan';
  return h('div', { class: 'vswitch', role: 'group', 'aria-label': T.mode },
    h('button', { 'aria-pressed': !plan, onclick: () => setView('full') }, icon('grid', 15), T.overview),
    h('button', { 'aria-pressed': plan, onclick: () => setView('plan') }, icon('heart', 15), T.myPlan));
}

function planHeader(): HTMLElement {
  const near = nearestName();
  // Rij 1: schakelaar + knoppen (zelfde plek als in Alles). Rij 2: het park met icoontje in de parkkleur, even hoog als de schakelaar.
  return h('header', {},
    h('div', { class: 'phead' },
      menuButton(),
      viewSwitch(),
      h('div', { class: 'spacer' }),
      refreshButton()),
    h('div', { class: 'parkline' },
      h('div', { class: 'park-chip' }, parkIcon(state.parkId), h('b', {}, currentPark()?.shortName ?? ''), near ? h('span', { class: 'near' }, T.near(near)) : null)));
}

// ---- Mijn programma: vegen (links = afstrepen, rechts = navigeren) ---------------------------

let swipeBusy = false;
let renderPending = false;
const SWIPE_TRIGGER = 80; // pixels voordat een veeg telt

/** Afgestreepte favorieten per park, alleen voor vandaag (Parijse datum) en alleen op dit toestel. */
function doneKey(): string { return `pp.done.${state.parkId}`; }
function doneSet(): Set<string> {
  try {
    const v = JSON.parse(store.get(doneKey()) ?? 'null') as { date: string; ids: string[] } | null;
    return v && v.date === todayStr() ? new Set(v.ids) : new Set();
  } catch { return new Set(); }
}
function setDone(id: string, done: boolean): void {
  const set = doneSet();
  if (done) set.add(id); else set.delete(id);
  store.set(doneKey(), JSON.stringify({ date: todayStr(), ids: [...set] }));
  render();
}

/** Keuzemenu onderin het scherm. Tikken naast het menu of op de laatste knop sluit het. */
function actionSheet(title: string, sub: string | null, options: { label: string; kind?: 'primary' | 'danger' | 'cancel'; run?: () => void }[]): () => void {
  const overlay = h('div', { class: 'asheet-bg', role: 'dialog', 'aria-label': title });
  const close = (): void => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.append(h('div', { class: 'asheet' },
    h('div', { class: 'asheet-title' }, h('b', {}, title), sub ? h('span', {}, sub) : null),
    ...options.map((o) => h('button', { class: `asheet-btn ${o.kind ?? ''}`.trim(), onclick: () => { close(); o.run?.(); } }, o.label))));
  document.body.append(overlay);
  return close;
}

function confirmDone(entity: EntityInfo): void {
  const done = doneSet().has(entity.id);
  actionSheet(entity.name, done ? T.markedSeen : null, done
    ? [{ label: T.undoSeen, kind: 'primary', run: () => setDone(entity.id, false) }, { label: T.cancel, kind: 'cancel' }]
    : [{ label: T.markSeen, kind: 'primary', run: () => setDone(entity.id, true) }, { label: T.cancel, kind: 'cancel' }]);
}

/** Opent lopende navigatie in Apple Kaarten of Google Maps naar de attractie of show. */
function chooseNavigation(entity: EntityInfo): void {
  const loc = entity.location;
  if (!loc) {
    actionSheet(entity.name, T.noLocNav, [{ label: T.ok, kind: 'cancel' }]);
    return;
  }
  const dest = `${loc.lat},${loc.lng}`;
  const go = (url: string): void => { window.location.href = url; };
  actionSheet(T.walkTo(entity.name), T.chooseMaps, [
    { label: T.appleMaps, kind: 'primary', run: () => go(`https://maps.apple.com/?daddr=${dest}&dirflg=w`) },
    { label: 'Google Maps', kind: 'primary', run: () => {
      // Eerst de app zelf; staat die er niet op (de app blijft dan zichtbaar), dan de website.
      go(`comgooglemaps://?daddr=${dest}&directionsmode=walking`);
      setTimeout(() => { if (document.visibilityState === 'visible') go(`https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking&dir_action=navigate`); }, 1500);
    } },
    { label: T.cancel, kind: 'cancel' },
  ]);
}

/** Maakt een rij in Mijn programma veegbaar. Verticaal scrollen blijft gewoon werken (touch-action: pan-y). */
function withSwipe(wrap: HTMLElement, entity: EntityInfo): HTMLElement {
  const row = wrap.querySelector('.prow') as HTMLElement | null;
  if (!row) return wrap;
  if (doneSet().has(entity.id)) wrap.classList.add('done');
  const track = h('div', { class: 'swipe' },
    h('div', { class: 'swipe-bg nav' }, T.swipeNav),
    h('div', { class: 'swipe-bg seen' }, doneSet().has(entity.id) ? T.swipeUnseen : T.swipeSeen));
  row.replaceWith(track);
  track.append(row);

  let startX = 0, startY = 0, dx = 0, mode: 'idle' | 'maybe' | 'swipe' | 'scroll' = 'idle', pointer = -1, suppressClickUntil = 0;
  row.addEventListener('click', (ev) => { if (Date.now() < suppressClickUntil) { ev.stopPropagation(); ev.preventDefault(); } }, { capture: true });
  const reset = (): void => {
    row.style.transition = 'transform .18s ease';
    row.style.transform = '';
    track.classList.remove('to-left', 'to-right');
    mode = 'idle'; pointer = -1;
    swipeBusy = false;
    if (renderPending) { renderPending = false; setTimeout(render, 200); }
  };
  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY; dx = 0; mode = 'maybe'; pointer = e.pointerId;
    row.style.transition = '';
  });
  row.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer || mode === 'idle' || mode === 'scroll') return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (mode === 'maybe') {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { mode = 'scroll'; return; }
      if (Math.abs(mx) < 10) return;
      mode = 'swipe'; swipeBusy = true;
      try { row.setPointerCapture(pointer); } catch { /* niet ondersteund */ }
    }
    dx = Math.max(-140, Math.min(140, mx));
    row.style.transform = `translateX(${dx}px)`;
    track.classList.toggle('to-left', dx < 0);
    track.classList.toggle('to-right', dx > 0);
    track.classList.toggle('armed', Math.abs(dx) >= SWIPE_TRIGGER);
  });
  const end = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    const wasSwipe = mode === 'swipe', d = dx;
    reset();
    track.classList.remove('armed');
    if (!wasSwipe) return;
    suppressClickUntil = Date.now() + 400; // de veeg telt niet ook als tik op de rij
    if (d <= -SWIPE_TRIGGER) confirmDone(entity);
    else if (d >= SWIPE_TRIGGER) chooseNavigation(entity);
  };
  row.addEventListener('pointerup', end);
  row.addEventListener('pointercancel', (e) => { if (e.pointerId === pointer) reset(); });
  return wrap;
}

// ---- Kijkplek van een show vastleggen (lang drukken) -----------------------------------------
// Voor shows zonder locatie in de bron. De plek gaat naar de server en geldt voor alle gebruikers.

/** Mag je voor deze show een kijkplek vastleggen? Alleen als de bron geen locatie heeft. */
const canSetSpot = (e: EntityInfo): boolean =>
  e.type === 'show' && (!e.location || e.locationSource === 'user');

const LONG_PRESS_MS = 600;

/**
 * Lang drukken (0,6 s stil houden): op een attractie inchecken in de rij, op een show zonder bronlocatie het
 * kijkplek-menu. Bewegen of vegen annuleert.
 */
function withLongPress(entity: EntityInfo, el: HTMLElement): HTMLElement {
  const isAttraction = entity.type === 'attraction';
  if (!isAttraction && !canSetSpot(entity)) return el;
  el.classList.add('lp');
  let timer = 0, sx = 0, sy = 0, pid = -1, suppressUntil = 0;
  const cancel = (): void => { clearTimeout(timer); timer = 0; pid = -1; el.classList.remove('lp-hold'); };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    sx = e.clientX; sy = e.clientY; pid = e.pointerId;
    el.classList.add('lp-hold');
    timer = window.setTimeout(() => {
      timer = 0; el.classList.remove('lp-hold');
      suppressUntil = Date.now() + 700; // de tik die op het loslaten volgt niet ook laten tellen
      if (isAttraction) showQueueMenu(entity); else void showSpotMenu(entity);
    }, LONG_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === pid && timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
  });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', (e) => { if (Date.now() < suppressUntil) { e.stopPropagation(); e.preventDefault(); } }, { capture: true });
  return el;
}

const accText = (m: number | null | undefined): string => (typeof m === 'number' ? `±${Math.round(m)} m` : T.accUnknown);

/** Lang drukken: eerst je plek meten, dan altijd bevestigen (met de gps-nauwkeurigheid; bij een bestaande plek van allebei). */
async function showSpotMenu(entity: EntityInfo): Promise<void> {
  if (sim.on) {
    actionSheet(entity.name, T.simNoSpot, [{ label: T.ok, kind: 'cancel' }]);
    return;
  }
  let cancelled = false;
  const closeWait = actionSheet(T.spotTitle(entity.name), T.locating, [{ label: T.cancel, kind: 'cancel', run: () => { cancelled = true; } }]);
  const waitSheet = [...document.querySelectorAll('.asheet-bg')].pop() ?? null;
  let pos: { lat: number; lng: number; accuracy: number | null };
  const subEl = waitSheet?.querySelector('.asheet-title span') ?? null;
  try { pos = await getPrecisePosition((acc) => { if (subEl) subEl.textContent = T.spotMeasuring(accText(acc)); }); }
  catch (err) {
    if (waitSheet && !waitSheet.isConnected) cancelled = true;
    closeWait();
    if (cancelled) return;
    const denied = err instanceof GeoError && err.code === 'denied';
    actionSheet(T.locNotFound, denied ? T.locDenied : T.locFailed, [{ label: T.ok, kind: 'cancel' }]);
    return;
  }
  if (waitSheet && !waitSheet.isConnected) cancelled = true; // naast het menu getikt = ook annuleren
  closeWait();
  if (cancelled) return;
  state.pos = { lat: pos.lat, lng: pos.lng }; state.loc = 'ok'; storePos();
  // De server weigert boven ±50 m; meteen zeggen, met de keuze om opnieuw te meten.
  if (pos.accuracy === null || pos.accuracy > SPOT_ACCURACY_MAX_M) {
    actionSheet(T.spotTooWeakTitle, T.spotTooWeakBody(accText(pos.accuracy), SPOT_ACCURACY_MAX_M), [
      { label: T.spotRetry, kind: 'primary', run: () => void showSpotMenu(entity) },
      { label: T.cancel, kind: 'cancel' },
    ]);
    return;
  }
  confirmSpot(entity, pos);
}

function confirmSpot(entity: EntityInfo, pos: { lat: number; lng: number; accuracy: number | null }): void {
  const cur = state.entities.find((e) => e.id === entity.id) ?? entity;
  const weak = pos.accuracy !== null && pos.accuracy > SPOT_ACCURACY_WARN_M
    ? T.spotWeak : '';
  if (cur.location && cur.locationSource === 'user') {
    const apart = Math.round(haversineMeters(cur.location, pos));
    const when = cur.locationUpdatedAt ? T.spotRecorded(agoLabel(cur.locationUpdatedAt)) : '';
    actionSheet(T.spotReplaceTitle(cur.name),
      T.spotReplaceBody(accText(cur.locationAccuracy), when, accText(pos.accuracy), apart, weak) + T.spotReviewNote, [
        { label: T.spotReplaceBtn, kind: 'primary', run: () => void saveSpot(cur, pos, true) },
        { label: T.spotRemoveBtn, kind: 'danger', run: () => void removeSpot(cur) },
        { label: T.cancel, kind: 'cancel' },
      ]);
    return;
  }
  actionSheet(T.spotSaveTitle(cur.name),
    T.spotSaveBody(accText(pos.accuracy), weak), [
      { label: T.spotSaveBtn, kind: 'primary', run: () => void saveSpot(cur, pos, false) },
      { label: T.cancel, kind: 'cancel' },
    ]);
}

function setEntityLocation(id: string, patch: Pick<EntityInfo, 'location' | 'locationSource' | 'locationAccuracy' | 'locationUpdatedAt'> & { locationConfirmed?: boolean }): void {
  state.entities = state.entities.map((e) => (e.id === id ? { ...e, ...patch } : e));
  saveCache();
  render();
}

const SPOT_ACCURACY_WARN_M = 25;
/** Zelfde grens als de server (LOC_MAX_ACCURACY_M in worker/src/locations.ts). */
const SPOT_ACCURACY_MAX_M = 50;

async function saveSpot(entity: EntityInfo, pos: { lat: number; lng: number; accuracy: number | null }, replace: boolean): Promise<void> {
  try {
    const res = await putShowLocation(state.parkId, entity.id, pos.lat, pos.lng, pos.accuracy, replace);
    if (res.pending) {
      // Vervangen van een bestaande plek: eerst de beheerder. De huidige plek blijft staan.
      actionSheet(T.spotSent, T.spotSentBody(entity.name), [{ label: T.ok, kind: 'cancel' }]);
      return;
    }
    setEntityLocation(entity.id, { location: { lat: pos.lat, lng: pos.lng }, locationSource: 'user', locationAccuracy: pos.accuracy === null ? null : Math.round(pos.accuracy), locationUpdatedAt: new Date().toISOString(), locationConfirmed: false });
    actionSheet(T.spotSaved, T.spotSavedBody(entity.name, accText(pos.accuracy)), [{ label: T.ok, kind: 'cancel' }]);
  } catch (err) {
    const code = err instanceof ApiError ? err.code : '';
    if (code === 'location_exists' && err instanceof ApiError) {
      // Iemand anders legde intussen een plek vast: die tonen en opnieuw om bevestiging vragen.
      const c = err.data?.current as Partial<EntityInfo> | undefined;
      if (c?.location) {
        setEntityLocation(entity.id, { location: c.location, locationSource: 'user', locationAccuracy: c.locationAccuracy ?? null, locationUpdatedAt: c.locationUpdatedAt ?? null, locationConfirmed: c.locationConfirmed });
        confirmSpot(entity, pos);
        return;
      }
    }
    const msg = code === 'too_far_from_park' ? T.errTooFar
      : code === 'outside_park' ? T.errOutsidePark
      : code === 'low_accuracy' ? T.spotTooWeakBody(accText(pos.accuracy), SPOT_ACCURACY_MAX_M)
      : code === 'has_source_location' ? T.errHasSource
      : code === 'rate_limited' ? T.errRate
      : T.errSaveConn;
    actionSheet(T.notSaved, msg, [{ label: T.ok, kind: 'cancel' }]);
  }
}

async function removeSpot(entity: EntityInfo): Promise<void> {
  try {
    const res = await deleteShowLocation(state.parkId, entity.id);
    if (res.pending) {
      actionSheet(T.spotSent, T.spotRemoveSentBody(entity.name), [{ label: T.ok, kind: 'cancel' }]);
      return;
    }
    setEntityLocation(entity.id, { location: null, locationSource: null, locationAccuracy: null, locationUpdatedAt: null });
  } catch {
    actionSheet(T.notRemoved, T.errRemoveConn, [{ label: T.ok, kind: 'cancel' }]);
  }
}

// ---- Inchecken in de rij (lang drukken op een attractie) ---------------------------------------
// Eén rij tegelijk, alleen op dit toestel. Statussen: in de rij → aan de beurt → eruit.

type QueueLine = 'standby' | 'single';
interface QueueState { id: string; parkId: string; name: string; line: QueueLine; expected: number | null; start: number; turnAt: number | null }
interface QueueDone extends QueueState { outAt: number }

const QUEUE_MAX_MS = 12 * 3600_000; // een vergeten rij vervalt na 12 uur

function loadQueue(): QueueState | null {
  try {
    const q = JSON.parse(store.get('pp.queue') ?? 'null') as QueueState | null;
    if (!q || typeof q.start !== 'number' || Date.now() - q.start > QUEUE_MAX_MS) return null;
    return q;
  } catch { return null; }
}
let queue: QueueState | null = loadQueue();
function saveQueue(q: QueueState | null): void {
  queue = q;
  if (q) store.set('pp.queue', JSON.stringify(q)); else store.remove('pp.queue');
}
const inQueue = (e: EntityInfo): boolean => !!queue && queue.id === e.id && queue.parkId === state.parkId;

/** Afgeronde rijen van vandaag (Parijse datum), alleen op dit toestel. */
function queueLog(): QueueDone[] {
  try {
    const v = JSON.parse(store.get('pp.queueLog') ?? 'null') as { date: string; items: QueueDone[] } | null;
    return v && v.date === todayStr() ? v.items : [];
  } catch { return []; }
}
function addQueueLog(item: QueueDone): void {
  store.set('pp.queueLog', JSON.stringify({ date: todayStr(), items: [...queueLog(), item] }));
}

const lineName = (l: QueueLine): string => (l === 'single' ? T.singleRider : T.qStandby);
/** Lopende tijd als m:ss (of u:mm:ss boven het uur). */
function stopwatch(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n: number): string => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
const minutesOf = (ms: number): number => Math.max(0, Math.round(ms / 60000));

function showQueueMenu(entity: EntityInfo): void {
  if (queue && queue.id === entity.id && queue.parkId === state.parkId) { queueOptions(); return; }
  if (queue) {
    const cur = queue;
    actionSheet(T.qSwitchTitle(entity.name), T.qSwitchBody(cur.name), [
      { label: T.qSwitchBtn, kind: 'primary', run: () => { saveQueue(null); chooseLine(entity); } },
      { label: T.cancel, kind: 'cancel' },
    ]);
    return;
  }
  chooseLine(entity);
}

function chooseLine(entity: EntityInfo): void {
  const live = state.live.get(entity.id);
  const parkOpen = parkStatus().open !== false;
  const standby = parkOpen && live?.status === 'open' && typeof live.waitMinutes === 'number' ? live.waitMinutes : null;
  const single = srOf(live);
  const label = (name: string, n: number | null): string => (n === null ? name : `${name} · ${n}`);
  actionSheet(T.qWhichLine, entity.name, [
    { label: label(T.qStandby, standby), kind: 'primary', run: () => checkIn(entity, 'standby', standby) },
    ...(live?.singleRider ? [{ label: label(T.singleRider, single), kind: 'primary' as const, run: () => checkIn(entity, 'single', single) }] : []),
    { label: T.cancel, kind: 'cancel' },
  ]);
}

function checkIn(entity: EntityInfo, line: QueueLine, expected: number | null): void {
  saveQueue({ id: entity.id, parkId: state.parkId, name: entity.name, line, expected, start: Date.now(), turnAt: null });
  render();
  if (!gameAskOn()) return;
  actionSheet(T.gameAsk, T.gameAskBody, [
    { label: T.gamePlay, kind: 'primary', run: playGame },
    { label: T.gameNeverAsk, run: () => setGameAsk(false) },
    { label: T.gameNoThanks, kind: 'cancel' },
  ]);
}

/** Spelletje tijdens het wachten (game.ts). Bovenin het spel lopen de rij en de tijd mee. */
function playGame(): void {
  openGame({
    queue: () => (queue ? { name: queue.name, time: stopwatch((queue.turnAt ?? Date.now()) - queue.start), canTurn: queue.turnAt === null } : null),
    onTurn: markTurn,
  });
}

/** Tik op de balk: alle keuzes voor de rij waar je in staat. */
function queueOptions(): void {
  const q = queue;
  if (!q) return;
  const sub = `${lineName(q.line)} · ${stopwatch((q.turnAt ?? Date.now()) - q.start)}`;
  actionSheet(q.name, sub, q.turnAt === null
    ? [
        { label: T.qTurn, kind: 'primary', run: markTurn },
        { label: T.qOut, kind: 'primary', run: markOut },
        { label: T.gameFromQueue, kind: 'primary', run: playGame },
        { label: T.qUndo, kind: 'danger', run: () => { saveQueue(null); render(); } },
        { label: T.cancel, kind: 'cancel' },
      ]
    : [
        { label: T.qOut, kind: 'primary', run: markOut },
        { label: T.qBackInLine, kind: 'primary', run: () => { if (queue) { saveQueue({ ...queue, turnAt: null }); render(); } } },
        { label: T.qUndo, kind: 'danger', run: () => { saveQueue(null); render(); } },
        { label: T.cancel, kind: 'cancel' },
      ]);
}

function markTurn(): void {
  if (!queue || queue.turnAt !== null) return;
  saveQueue({ ...queue, turnAt: Date.now() });
  render();
}

function markOut(): void {
  const q = queue;
  if (!q) return;
  const done: QueueDone = { ...q, outAt: Date.now() };
  addQueueLog(done);
  saveQueue(null);
  render();
  // Meteen aanbieden om af te strepen in Mijn dag (alleen als het nog niet gedaan is en je in hetzelfde park kijkt).
  const canMark = q.parkId === state.parkId && !doneSet().has(q.id);
  actionSheet(T.qDoneTitle(q.name), queueResult(done), canMark
    ? [{ label: T.markSeen, kind: 'primary', run: () => setDone(q.id, true) }, { label: T.ok, kind: 'cancel' }]
    : [{ label: T.ok, kind: 'cancel' }]);
}

/** "Je wachtte X. Verwacht was Y: Z sneller/langer. Rit tot eruit: R." */
function queueResult(d: QueueDone): string {
  const waited = minutesOf((d.turnAt ?? d.outAt) - d.start);
  const parts = [T.qWaited(dur(waited))];
  if (d.expected === null) parts.push(T.qNoExpected);
  else {
    const diff = waited - d.expected;
    parts.push(diff === 0 ? T.qExactly(d.expected) : diff < 0 ? T.qFaster(d.expected, dur(-diff)) : T.qSlower(d.expected, dur(diff)));
  }
  if (d.turnAt !== null) parts.push(T.qRide(dur(minutesOf(d.outAt - d.turnAt))));
  else parts.push(T.qNoTurn);
  return parts.join(' ');
}

/** Balk onderin zolang je in een rij staat. De tijd wordt elke seconde bijgewerkt door paintQueue(). */
function queueBar(): HTMLElement | null {
  const q = queue;
  if (!q) return null;
  return h('div', { class: `qbar${q.turnAt !== null ? ' turn' : ''}`, role: 'region', 'aria-label': T.qBarAria },
    h('button', { class: 'qbar-main', onclick: queueOptions },
      h('div', { class: 'qbar-top' },
        h('b', { class: 'qbar-name' }, q.name),
        h('span', { class: 'qbar-time' }, '')),
      h('div', { class: 'qbar-sub' }, h('span', { class: 'qbar-line' }, lineName(q.line)), h('span', { class: 'qbar-exp' }, '')),
      h('div', { class: 'qbar-prog' }, h('div', { class: 'qbar-fill' }))),
    h('button', { class: 'qbar-btn', onclick: (ev: Event) => { ev.stopPropagation(); if (q.turnAt === null) markTurn(); else markOut(); } },
      q.turnAt === null ? T.qTurn : T.qOut));
}

function paintQueue(): void {
  const bar = document.querySelector('.qbar');
  const q = queue;
  if (!bar || !q) return;
  const now = Date.now();
  const waitMs = (q.turnAt ?? now) - q.start;
  const time = bar.querySelector('.qbar-time'), exp = bar.querySelector('.qbar-exp'), fill = bar.querySelector('.qbar-fill') as HTMLElement | null;
  if (time) time.textContent = stopwatch(waitMs);
  const over = q.expected !== null && waitMs > q.expected * 60000;
  if (exp) {
    if (q.turnAt !== null) exp.textContent = T.qTurnSince(stopwatch(now - q.turnAt));
    else if (q.expected === null) exp.textContent = T.qExpUnknown;
    else if (over) exp.textContent = T.qExpOver(q.expected, minutesOf(waitMs - q.expected * 60000));
    else exp.textContent = T.qExpLeft(q.expected, Math.max(0, Math.ceil((q.expected * 60000 - waitMs) / 60000)));
    exp.classList.toggle('over', over && q.turnAt === null);
  }
  bar.classList.toggle('over', over);
  if (fill) {
    const pct = q.expected === null ? 0 : q.expected === 0 ? 100 : Math.min(100, (waitMs / (q.expected * 60000)) * 100);
    fill.style.width = `${q.turnAt !== null ? 100 : pct}%`;
    bar.classList.toggle('noexp', q.expected === null);
  }
}

/** Uitlijning in Mijn programma: alle grote getallen en pijltjes staan recht onder elkaar. */
let planLayout = { side: false, digits: 2 };
const srOf = (live: LiveInfo | undefined): number | null =>
  parkStatus().open !== false && live?.status === 'open' && typeof live.singleRiderWait === 'number' ? live.singleRiderWait : null;

function planNodes(): Node[] {
  const allFavs = state.entities.filter((e) => state.favorites.has(e.id));
  {
    // Ruimte voor single rider rechts naast elk groot getal reserveren als er ergens een is, en de breedte
    // van het grote getal gelijk maken aan het breedste getal in de lijst. Zo lijnt alles verticaal uit.
    const atts = allFavs.filter((e) => e.type === 'attraction').map((e) => state.live.get(e.id));
    const waits = atts.map((l) => (l?.status === 'open' && typeof l.waitMinutes === 'number' ? String(l.waitMinutes).length : 0));
    const closed = parkStatus().open === false;
    planLayout = { side: atts.some((l) => srOf(l) !== null || (!closed && trendDelta(l) !== null)), digits: Math.max(2, ...waits) };
  }
  const done = doneSet();
  const doneCount = allFavs.filter((e) => done.has(e.id)).length;
  const hideDone = state.planDoneHidden && doneCount > 0;
  const favs = hideDone ? allFavs.filter((e) => !done.has(e.id)) : allFavs;
  // Verborgen afgestreepte rijen: één tikbare regel onderaan.
  const doneStub = (): Node[] => (hideDone
    ? [h('button', { class: 'ptitle pshows-toggle', 'aria-expanded': false, onclick: togglePlanDone }, T.doneStub(doneCount))]
    : []);
  const ctx = { sort: state.prefs.sort, live: state.live, pos: state.pos };
  const planShowS = (e: EntityInfo): HTMLElement => withSwipe(planShow(e), e);
  const planAttractionS = (e: EntityInfo): HTMLElement => withSwipe(planAttraction(e), e);
  const render1 = (e: EntityInfo): HTMLElement => (e.type === 'show' ? planShowS(e) : planAttractionS(e));
  const showList = favs.filter((e) => e.type === 'show');
  const hidden = state.planShowsHidden && showList.length > 0;
  // Ingeklapt: één tikbare regel in plaats van de shows.
  const showsTitle = (): HTMLElement => h('button', { class: 'ptitle pshows-toggle', 'aria-expanded': !hidden, onclick: togglePlanShows },
    hidden ? T.showsCollapsed(showList.length) : T.showsOpen);
  // Op afstand: shows en attracties door elkaar, de dichtstbijzijnde bovenaan.
  if (state.prefs.sort === 'distance') {
    return [...(hidden ? [showsTitle(), ...sortEntities(favs.filter((e) => e.type !== 'show'), ctx).map(render1)] : sortEntities(favs, ctx).map(render1)), ...doneStub()];
  }
  // Anders blijven de shows bovenaan, op starttijd (of naam), en daaronder de attracties.
  const shows = state.prefs.sort === 'name' ? [...showList].sort((x, y) => x.name.localeCompare(y.name, lang)) : showList.sort(byNextStart);
  const atts = sortEntities(favs.filter((e) => e.type === 'attraction'), ctx);
  const out: Node[] = [];
  if (shows.length) out.push(showsTitle(), ...(hidden ? [] : shows.map(planShowS)));
  if (atts.length) out.push(h('h2', { class: 'ptitle' }, T.attractions), ...atts.map(planAttractionS));
  out.push(...doneStub());
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
    if (state.loc === 'asking') return h('div', { class: 'notice' }, T.locatingNotice);
    if (state.loc === 'denied') {
      return h('div', { class: 'notice' }, T.locDeniedNotice);
    }
    if (!state.pos) {
      return h('div', { class: 'notice' },
        state.loc === 'error' ? T.locError : state.view === 'plan' ? T.locNeedPlan : T.locNeedSort,
        h('div', {}, h('button', { class: 'btn', onclick: () => void ensurePosition() }, T.useMyLoc)));
    }
  }
  return null;
}

// ---- Hoofdscherm -----------------------------------------------------------------------------

function render(): void {
  if (swipeBusy) { renderPending = true; return; } // niet verversen midden in een veeg
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
  if (state.loading && state.entities.length === 0) body = h('div', { class: 'empty' }, T.loadingData);
  else if (state.entities.length === 0) body = h('div', { class: 'empty' }, state.error ?? T.noAttractions);
  else if (nodes.length === 0) {
    body = h('div', { class: 'empty' }, plan ? T.emptyPlan : state.onlyOpen && status.open === false ? T.emptyClosed : state.tab === 'favorites' ? T.emptyFavs : T.emptyFilter);
  } else body = h('div', {}, ...nodes);

  const age = agoLabel(state.generatedAt);
  const srcAge = state.sourceUpdatedAt ? T.srcLatest(agoLabel(state.sourceUpdatedAt)) : '';
  const srcStale = status.open === true && freshness(state.sourceUpdatedAt) === 'old';
  const freshText = state.fromCache ? T.freshCached(age)
    : offline ? T.freshOffline(age)
    : state.error && state.entities.length > 0 ? T.freshError(state.error.replace(/[.,]$/, ''), age)
    : T.freshUpdated(age, srcAge);

  const sortLabels: [SortMode, string][] = [['wait', state.tab === 'shows' ? T.sortStart : T.sortWait], ['distance', T.sortDistance], ['name', T.sortName]];
  const dark = effectiveTheme() === 'dark';
  document.documentElement.dataset.density = state.density;
  const scrollTop = window.scrollY;
  const items: (Node | null)[] = [
    sim.on ? h('div', { class: 'simbar' }, T.simBar, h('button', { onclick: () => void setSim(false) }, T.stop)) : null,
    plan ? planHeader() : h('header', { class: 'hero' },
      h('div', { class: 'hero-top' },
        menuButton(),
        viewSwitch(),
        h('div', { class: 'spacer' }),
        h('div', { class: 'top-actions' },
          refreshButton(),
          h('button', { class: 'icon-btn aa', 'aria-label': state.density === 'compact' ? T.biggerText : T.compactText, onclick: () => setDensity(state.density === 'compact' ? 'comfortable' : 'compact') }, 'Aa'),
          h('button', { class: 'icon-btn', 'aria-label': dark ? T.toLight : T.toDark, onclick: toggleTheme }, icon(dark ? 'sun' : 'moon', 22)))),
      state.parks.length > 1
        ? h('div', { class: 'parks', role: 'group', 'aria-label': T.park },
            ...state.parks.map((p) => h('button', { class: 'park-pill', 'aria-pressed': p.id === state.parkId, onclick: () => switchPark(p.id) }, parkIcon(p.id, 16), p.shortName)))
        : null,
      h('div', { class: 'brand' }, 'ParkPilot', h('span', { class: 'ver' }, `v${APP_VERSION}`)),
      h('div', { class: 'hero-main' },
        parkArt(state.parkId),
        h('h1', { class: 'park-name' }, park?.name ?? 'ParkPilot'),
        h('div', { class: 'park-status' }, h('span', { class: `dot${status.open === true ? ' open' : status.open === false ? ' closed' : ''}` }), status.text),
        state.entities.length && !plan
          ? h('div', { class: 'stats' },
              h('button', { class: `stat issues${newIssues ? ' alert' : ''}`, 'aria-label': T.issuesAria(newIssues), onclick: openIssues },
                icon('door', 18),
                h('div', { class: 'snums' },
                  h('div', { class: 'snum good' }, h('b', {}, String(stats.openCount))),
                  h('div', { class: 'snum bad' }, h('b', {}, stats.down === null ? '–' : String(stats.down))),
                  h('div', { class: 'snum off' }, h('b', {}, String(stats.refurb))))),
              h('div', { class: 'stat' }, icon('gauge', 18), h('b', {}, stats.avg === null ? '–' : String(stats.avg)), h('span', {}, T.average)),
              h('div', { class: 'stat' }, icon('bolt', 18), h('b', {}, stats.short ? String(stats.short.min) : '–'), h('span', {}, stats.short ? T.shortestOf(stats.short.name) : T.shortest)))
          : null)),
    plan ? h('div', { class: 'pbar' },
      h('div', { class: 'pleft' },
        h('div', { class: 'pseg', role: 'group', 'aria-label': T.sort },
          ...(['wait', 'distance', 'name'] as SortMode[]).map((mode) => h('button', { 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, { wait: T.sortWait, distance: T.sortDistance, name: T.sortName }[mode]))),
        state.entities.some((e) => e.type === 'show' && state.favorites.has(e.id))
          ? h('button', { class: 'pchip', 'aria-pressed': !state.planShowsHidden, 'aria-label': state.planShowsHidden ? T.showsShow : T.showsHide, onclick: togglePlanShows }, T.shows)
          : null,
        state.entities.some((e) => state.favorites.has(e.id) && doneSet().has(e.id))
          ? h('button', { class: 'pchip', 'aria-pressed': !state.planDoneHidden, 'aria-label': state.planDoneHidden ? T.seenShow : T.seenHide, onclick: togglePlanDone }, T.seen)
          : null),
      h('div', { class: `pfresh${offline || state.error || state.fromCache || srcStale ? ' stale' : ''}` },
        offline ? T.pOffline(age) : state.error ? T.pError(age) : state.fromCache ? T.pCached(age) : T.srcAgo(agoLabel(state.sourceUpdatedAt ?? state.generatedAt)))) : h('nav', { class: 'nav' },
      plan ? null : h('div', { class: 'segments sub', role: 'group', 'aria-label': T.view },
        h('button', { 'aria-pressed': state.tab === 'attractions', onclick: () => setTab('attractions') }, T.attractions),
        h('button', { 'aria-pressed': state.tab === 'shows', onclick: () => setTab('shows') }, T.shows),
        h('button', { 'aria-pressed': state.tab === 'favorites', onclick: () => setTab('favorites') }, T.following(state.favorites.size))),
      plan || (state.tab === 'shows' && state.showDay) ? null : h('div', { class: 'chips', role: 'group', 'aria-label': T.sortFilter },
        ...sortLabels.map(([mode, text]) => h('button', { class: 'chip', 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, text)),
        state.tab !== 'shows'
          ? h('button', { class: 'chip divider', 'aria-pressed': state.onlyOpen, onclick: () => { state.onlyOpen = !state.onlyOpen; render(); } }, T.onlyOpen)
          : null),
      h('div', { class: `fresh${offline || state.error || state.fromCache || srcStale ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    ...[locationNotice(), !plan && state.tab === 'shows' && state.entities.length ? dayBar() : null].filter((n): n is HTMLElement => n !== null),
    h('main', {}, body),
    queueBar(),
    h('footer', { class: `foot${queue ? ' qspace' : ''}` },
      `ParkPilot v${APP_VERSION}${state.serverVersion && state.serverVersion !== APP_VERSION ? ` · server v${state.serverVersion}` : ''}${T.footer}`)];
  root.replaceChildren(...items.filter((n): n is Node => n !== null));
  paintQueue();
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
  try { await savePreferences(state.parkId, state.prefs); } catch { state.error = T.errPrefs; render(); }
}

// ---- Detailscherm ----------------------------------------------------------------------------

function levelColor(row: { open: boolean; y: number }): string {
  if (!row.open) return 'var(--muted)';
  return `var(--${waitLevel(row.y)})`;
}

/**
 * De server slaat het verloop maar elke 5 minuten op; het getal in de app is live. Wijkt de live-stand af van het
 * laatste opgeslagen punt, dan tekenen we die stand als laatste trede tot "nu", zodat getal en grafiek kloppen.
 * Alleen in de app, er wordt niets extra opgeslagen.
 */
function withLiveTail(data: HistoryResponse, live: LiveInfo | undefined): HistoryResponse {
  if (!live || live.status === 'unknown') return data;
  const last = data.rows[data.rows.length - 1];
  // Bron stil: grijs vanaf de laatste update van de bron (of de laatste opgeslagen regel, als die later is).
  const status = isSourceStale(live) ? 'stale' : live.status;
  if (last && last.wait === live.waitMinutes && last.status === status) return data;
  const lastAt = last ? Date.parse(last.at) : 0;
  if (status === 'stale') {
    const at = Math.max(lastAt + 1000, Date.parse(live.updatedAt as string));
    return { ...data, rows: [...data.rows, { at: new Date(Math.min(at, Date.now())).toISOString(), wait: live.waitMinutes, status: 'stale' }] };
  }
  const changed = live.changedAt ? Date.parse(live.changedAt) : NaN;
  const at = Number.isFinite(changed) && changed > lastAt ? changed : Date.now();
  return { ...data, rows: [...data.rows, { at: new Date(Math.min(at, Date.now())).toISOString(), wait: live.waitMinutes, status: live.status }] };
}

/** Openingstijden van vandaag (vroegste opening tot laatste sluiting), of null als onbekend. */
function todayHours(): { from: number; to: number } | null {
  const ops = state.schedule.filter((e) => e.type === 'OPERATING');
  const list = (ops.length ? ops : state.schedule).map((e) => ({ from: Date.parse(e.opens), to: Date.parse(e.closes) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to) && w.to > w.from);
  if (!list.length) return null;
  return { from: Math.min(...list.map((w) => w.from)), to: Math.max(...list.map((w) => w.to)) };
}

const HOUR_MARKS = [9, 12, 15, 18, 21];
/** Tijdstippen (ms) van de hele uren 9, 12, 15, 18 en 21 in de parktijdzone, strikt tussen `from` en `to`. */
function hourMarks(from: number, to: number): number[] {
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz() });
  const out: number[] = [];
  // Tijdzones van de parken wijken een heel aantal uren af van UTC, dus hele UTC-uren zijn ook hele lokale uren.
  for (let t = Math.ceil(from / 3600000) * 3600000; t < to && out.length < 48; t += 3600000) {
    if (t > from && HOUR_MARKS.includes(Number(fmt.format(t)))) out.push(t);
  }
  return out;
}

/**
 * Dagverloop van opening tot sluiting. De stippellijn (zelfde weekdag vorige weken) loopt door de hele grafiek;
 * het verloop van vandaag vult zich van links tot nu. Geen hulplijnen. Schaal op de stippellijn, hoger als vandaag
 * daarboven uitkomt. Openingstijden onbekend: van het eerste punt tot nu, zoals vroeger.
 */
function sparkline(data: HistoryResponse, now: number, ref?: WeekRefResponse): Node {
  const W = 300, H = 88, PAD = 6;
  const hours = todayHours();
  // 'stale' = bron gaf geen update: op de hoogte van de laatste waarde, maar grijs (sinds 0.19.0).
  const raw = data.rows.map((r) => ({ t: Date.parse(r.at), down: r.status === 'down', stale: r.status === 'stale' && r.wait !== null, open: r.status === 'open' && r.wait !== null, y: (r.status === 'open' || r.status === 'stale') && r.wait !== null ? r.wait : 0 }));
  const from = hours ? hours.from : Math.max(Date.parse(data.from), raw[0]?.t ?? now);
  const to = hours ? hours.to : now;
  const end = Math.min(now, to); // tot hier loopt het verloop van vandaag
  // Vandaag: alleen binnen opening..nu; de laatste stand van vóór de opening telt vanaf de opening.
  const rows: typeof raw = [];
  for (const r of raw) {
    if (r.t > end) break;
    if (r.t <= from) { rows.length = 0; rows.push({ ...r, t: from }); } else rows.push(r);
  }
  const refRows = (ref?.dates.length ? ref.rows : []).map((r) => ({ t: Date.parse(r.at), v: r.wait }));
  const refSeg: { t0: number; t1: number; v: number }[] = [];
  refRows.forEach((r, i) => {
    const t0 = Math.max(r.t, from), t1 = Math.min(i + 1 < refRows.length ? refRows[i + 1].t : to, to);
    if (r.v !== null && t1 > t0) refSeg.push({ t0, t1, v: r.v });
  });
  if (!refSeg.length && (rows.length < 2 && !(hours && rows.length))) return h('div', { class: 'chart-note' }, T.histBuilding);
  const peak = Math.max(10, ...refSeg.map((sg) => sg.v), ...rows.map((p) => p.y));
  const max = Math.ceil(peak / 10) * 10;
  const x = (t: number): number => PAD + ((t - from) / Math.max(1, to - from)) * (W - 2 * PAD);
  const y = (v: number): number => H - PAD - (v / max) * (H - 2 * PAD);
  const shapes: SVGElement[] = [];
  // Heel dunne verticale lijntjes op 9, 12, 15, 18 en 21 uur (parktijd), achter al het andere (sinds 0.23.3).
  for (const t of hourMarks(from, to)) {
    const xm = x(t).toFixed(1);
    shapes.push(svg('path', { class: 'hour-mark', d: `M${xm} 0V${H}`, stroke: 'var(--muted)', 'stroke-opacity': 0.3, 'stroke-width': 0.75, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  // Storingen: lichtrode zone over de hele hoogte en een gestippelde rode lijn onderin voor de duur.
  const outages: { from: number; to: number }[] = [];
  rows.forEach((r, i) => {
    if (!r.down) return;
    const t1 = i + 1 < rows.length ? rows[i + 1].t : end;
    const last = outages[outages.length - 1];
    if (last && last.to === r.t) last.to = t1; else outages.push({ from: r.t, to: t1 });
  });
  for (const o of outages) {
    const x0 = x(o.from), x1 = Math.max(x(o.to), x0 + 2);
    shapes.push(svg('rect', { x: x0.toFixed(1), y: 0, width: (x1 - x0).toFixed(1), height: H, fill: 'var(--high)', 'fill-opacity': 0.17 }));
  }
  if (refSeg.length) {
    let d = '';
    refSeg.forEach((sg, i) => {
      const joined = i > 0 && refSeg[i - 1].t1 === sg.t0;
      d += `${joined ? 'V' : `M${x(sg.t0).toFixed(1)} `}${y(sg.v).toFixed(1)}H${x(sg.t1).toFixed(1)}`;
    });
    shapes.push(svg('path', { class: 'ref-line', d, stroke: 'var(--text)', 'stroke-opacity': 0.55, 'stroke-width': 1.6, 'stroke-dasharray': '2 3', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  rows.forEach((r, i) => {
    const t1 = i + 1 < rows.length ? rows[i + 1].t : end;
    if (t1 <= r.t && i === rows.length - 1 && i > 0) return; // stand precies op het eindpunt: geen losse stip
    if (i > 0) shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(rows[i - 1].y).toFixed(1)}V${y(r.y).toFixed(1)}`, stroke: 'var(--muted)', 'stroke-opacity': 0.5, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
    shapes.push(svg('path', { d: `M${x(r.t).toFixed(1)} ${y(r.y).toFixed(1)}H${x(t1).toFixed(1)}`, stroke: r.stale ? 'var(--muted)' : levelColor(r), 'stroke-opacity': r.stale ? 0.75 : 1, 'stroke-width': 3.5, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  });
  for (const o of outages) {
    const x0 = x(o.from), x1 = Math.max(x(o.to), x0 + 2);
    shapes.push(svg('path', { d: `M${x0.toFixed(1)} ${y(0).toFixed(1)}H${x1.toFixed(1)}`, stroke: 'var(--high)', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 6', 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  const downMin = Math.round(outages.reduce((sum, o) => sum + (o.to - o.from), 0) / 60000);
  const open = rows.filter((r) => r.open).map((r) => r.y);
  const ticks = [0, 20, 45, max].filter((v, i, arr) => v <= max && arr.indexOf(v) === i && (v !== 45 || max - 45 >= 8) && (v !== 20 || (max >= 28 && max - 20 >= 8)));
  // "nu" onder de as op de plek waar het verloop van vandaag eindigt (alleen als het park open is en niet te dicht bij de randen).
  const nowPct = ((x(end) / W) * 100);
  const showNow = !!hours && now > from && now < to && nowPct > 14 && nowPct < 86;
  return h('div', {},
    h('div', { class: 'chartrow' },
      svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': T.chartAria }, ...shapes),
      h('div', { class: 'yaxis', 'aria-hidden': 'true' }, ...ticks.map((v) => h('span', { style: `top:${((y(v) / H) * 100).toFixed(1)}%` }, String(v))))),
    h('div', { class: 'chart-axis' },
      h('span', {}, clock(from, tz())),
      showNow ? h('span', { class: 'now-lbl', style: `left:${nowPct.toFixed(1)}%` }, T.now) : null,
      h('span', {}, hours ? clock(to, tz()) : T.now)),
    outages.length ? h('div', { class: 'chart-note outage' }, T.outage(outages.length, dur(downMin))) : null,
    refSeg.length && ref ? h('div', { class: 'chart-note ref-note' }, h('span', { class: 'ref-swatch', 'aria-hidden': 'true' }),
      T.refWeeks(ref.dates.length, new Intl.DateTimeFormat(T.locale, { weekday: 'long', timeZone: tz() }).format(new Date(now)))) : null,
    open.length ? null : h('div', { class: 'chart-note' }, T.noWaitSeen));
}

/** `day`: geopend vanuit het programma van een andere dag; dan de tijden van die dag (niets afgestreept). */
function openDetail(entity: EntityInfo, day?: { date: string; slots: ShowDayResponse['shows'][number]['slots'] }): void {
  const live = state.live.get(entity.id);
  const blurb = blurbFor(entity.name);
  const kind = kindOf(entity);
  const close = (): void => { scrim.remove(); drawer.remove(); };
  const scrim = h('div', { class: 'scrim', onclick: close });
  // Hele knop reageert (volle breedte, geen tekstselectie op iOS) en het label wisselt meteen; mislukt opslaan, dan terug.
  const favBtn = h('button', { class: 'btn secondary fav-btn', type: 'button' });
  const setFav = (): void => {
    const on = state.favorites.has(entity.id);
    favBtn.textContent = on ? T.followingBtn : T.followBtn;
    favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  setFav();
  favBtn.addEventListener('click', () => { const p = toggleFavorite(entity); setFav(); void p.then(setFav); });

  // Korte feiten onder het grote getal. Uitleg (wat veranderd/bevestigd betekent, grafiek) staat in Help.
  const facts = h('dl', { class: 'facts' });
  const addFact = (k: string, v: string | null): void => { if (v) facts.append(h('dt', {}, k), h('dd', {}, v)); };
  const bigNodes: Node[] = [];

  if (entity.type === 'attraction' && live) {
    if (live.status === 'open' && live.waitMinutes !== null) {
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, srcStale(live) && live.updatedAt ? T.staleSince(clock(Date.parse(live.updatedAt), tz())) : T.waitTime)));
    } else {
      const t = { open: T.stOpenNoWait, down: T.stDown, closed: T.stClosed, refurbishment: T.stRefurb, unknown: T.stUnknown }[live.status];
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, t)));
    }
    const cAt = changedAtMs(live);
    if (cAt !== null) {
      const cIso = new Date(cAt).toISOString();
      const unchanged = Math.floor((Date.now() - cAt) / 60000);
      addFact(T.fWaitChanged, live.changeObserved
        ? (live.prevWaitMinutes !== null ? T.wasPrev(agoLabel(cIso), live.prevWaitMinutes) : agoLabel(cIso))
        : unchanged >= 1 ? T.unchangedFor(dur(unchanged)) : null);
    }
    addFact(T.fSrcUpdated, live.updatedAt ? agoLabel(live.updatedAt) : null);
    if (live.singleRider) addFact(T.singleRider, typeof live.singleRiderWait === 'number' ? String(live.singleRiderWait) : T.srAvailNone);
  }
  if (entity.type === 'show' && live && !day) {
    const next = nextStartMs(live);
    if (next !== null) {
      bigNodes.push(h('div', { class: 'big' }, statusRing(entity, live), h('div', { class: 'label' }, T.nextShow(untilLabel(next)))));
      const dep = departure(entity, next);
      if (dep) addFact(T.fLeave, T.depFact(dep.text, dep.walk, state.prefs.arrivalMarginMin));
    }
  }
  if (entity.type === 'show' && canSetSpot(entity)) {
    addFact(T.fSpot, entity.location ? T.spotKnown(accText(entity.locationAccuracy), (entity.locationUpdatedAt ? `, ${agoLabel(entity.locationUpdatedAt)}` : '') + (entity.locationConfirmed === false ? T.spotUnconfirmed : '')) : T.spotUnknown);
  }
  const d = distanceOf(entity, state.pos);
  if (d !== null) addFact(T.fDistance, `${formatDistance(d)}, ${T.walkMin(walkMinutes(d, state.prefs.walkingSpeedKmh))}`);

  const myRides = entity.type === 'attraction' ? queueLog().filter((r) => r.id === entity.id && r.parkId === state.parkId) : [];
  const chartBox = h('div', {});
  if (entity.type === 'attraction') {
    // Meteen het bewaarde verloop (grijs als niet actueel), daarna bijwerken zodra het ophalen klaar is.
    const paint = (): void => { if (chartBox.isConnected || !chartBox.hasChildNodes()) chartBox.replaceChildren(historyNode(entity)); };
    const p = loadHistory(entity.id);
    paint();
    void p.then(paint);
  }

  let times: Node | null = null;
  if (entity.type === 'show' && day) {
    // Andere dag: alle tijden van die dag, niets afgestreept; verwachte tijden met streepjesrand.
    times = h('div', { class: 'times' }, ...day.slots.map((sl) => h('span', { class: `time${sl.source === 'verwacht' ? ' guess' : ''}` }, clock(sl.start, tz()))));
  } else if (entity.type === 'show' && live) {
    const next = nextStartMs(live);
    times = live.showtimes.length
      ? h('div', { class: 'times' }, ...live.showtimes.map((s) => {
          const t = Date.parse(s.start);
          return h('span', { class: `time${t === next ? ' next' : t < Date.now() ? ' past' : ''}` }, clock(t, tz()));
        }))
      : h('p', { class: 'caveat' }, T.noTimesToday);
  }

  const drawer = h('div', { class: 'drawer', role: 'dialog', 'aria-label': entity.name },
    h('div', { class: 'grab' }),
    h('div', { class: 'drawer-head' },
      h('div', {}, h('h2', {}, entity.name), kind ? h('div', { class: 'kind' }, icon(iconForKind(kind), 15), kindName(kind)) : null),
      h('button', { class: 'icon-btn', 'aria-label': T.close, onclick: close }, '✕')),
    kind ? kindArt(kind) : null,
    ...bigNodes,
    facts.childNodes.length ? facts : null,
    entity.type === 'attraction' ? chartBox : null,
    times ? h('div', { class: 'section-title' }, day ? dayLabel(day.date) : T.today) : null,
    times,
    myRides.length ? h('div', { class: 'section-title' }, T.qYouToday) : null,
    myRides.length ? h('div', { class: 'qlog' }, ...myRides.map((r) => h('div', { class: 'qlog-row' },
      h('b', {}, clock(r.start, tz())),
      h('span', {}, `${lineName(r.line)}: ${dur(minutesOf((r.turnAt ?? r.outAt) - r.start))}`),
      h('span', { class: 'qlog-exp' }, r.expected === null ? T.qExpUnknownShort : T.qExpShort(r.expected))))) : null,
    blurb ? h('div', { class: 'about' },
      h('p', {}, blurb.text),
      blurb.area || blurb.opened ? h('div', { class: 'tip' }, h('b', {}, T.area), [blurb.area, blurb.opened ? T.openedIn(blurb.opened) : null].filter(Boolean).join(', ')) : null,
      blurb.height ? h('div', { class: 'tip' }, h('b', {}, T.minHeight), blurb.height) : null,
      blurb.tip ? h('div', { class: 'tip' }, h('b', {}, T.tip), blurb.tip) : null) : null,
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
    state.error = T.errSave;
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
    state.live = liveMap(c.live);
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
    state.live = liveMap(live.live);
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
      state.error = err instanceof ApiError && err.code === 'park_not_found_upstream' ? T.errParkNotFound : T.errLoad;
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

const refreshButton = (): HTMLElement => h('button', { class: `icon-btn refresh${state.refreshing ? ' spin' : ''}`, 'aria-label': T.refreshNow, onclick: () => void forceRefresh() }, icon('refresh', 22));

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
    state.live = liveMap(live.live);
    state.generatedAt = live.generatedAt;
    state.sourceUpdatedAt = live.sourceUpdatedAt;
    if (schedule) { state.schedule = schedule.today; state.scheduleDays = schedule.days ?? []; }
    if (favs) state.favorites = new Set(favs.map((f) => f.entityId));
    state.error = null; state.fromCache = false;
    saveCache();
    applySimulation();
    // Weer bereik: open grafieken en eerder niet-actuele verlopen bijwerken.
    const retry = new Set([...state.expanded].filter((id) => state.entities.find((e) => e.id === id)?.type === 'attraction'));
    for (const [id, e] of state.hist) if (!e.ok) retry.add(id);
    for (const id of retry) void loadHistory(id);
  } catch { state.error = T.errRefresh; }
  await refreshPositionQuietly();
  render();
}

// ---- Update zoeken ----------------------------------------------------------------------------

/** Vraagt de server welke versie live staat. Is die anders dan deze app, dan laadt de app opnieuw met de nieuwe versie. */
async function checkForUpdate(btn: HTMLButtonElement, say: (t: string, kind?: 'good' | 'err' | '') => void): Promise<void> {
  if (!navigator.onLine) { say(T.updOffline, 'err'); return; }
  btn.disabled = true;
  say(T.updSearching);
  try {
    const res = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    const live = ((await res.json()) as { version?: string }).version ?? null;
    state.serverVersion = live;
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
    await reg?.update().catch(() => undefined);
    if (live && live !== APP_VERSION) {
      say(T.updFound(live), 'good');
      setTimeout(() => location.reload(), 800);
      return;
    }
    say(T.updLatest(APP_VERSION), 'good');
  } catch {
    say(T.updFailed, 'err');
  }
  btn.disabled = false;
}

// ---- Instellingen en koppelcode --------------------------------------------------------------

function openSettings(focus?: 'code'): void {
  const mkMsg = (): { el: HTMLElement; say: (t: string, kind?: 'good' | 'err' | '') => void } => {
    const el = h('div', { class: 'msg', role: 'status' });
    return { el, say: (t, kind = '') => { el.className = `msg ${kind}`.trim(); el.textContent = t; } };
  };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': T.settings });
  const close = (): void => sheet.remove();

  // Versie + update zoeken
  const update = mkMsg();
  const updateBtn = h('button', { class: 'btn secondary sm', onclick: () => void checkForUpdate(updateBtn as HTMLButtonElement, update.say) },
    T.checkUpdate) as HTMLButtonElement;

  // Thema
  const themeLabels: [ThemePref, string][] = [['auto', T.themeAuto], ['light', T.themeLight], ['dark', T.themeDark]];
  const themeBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.theme });
  const paintTheme = (): void => {
    themeBox.replaceChildren(...themeLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': getPref() === v, onclick: () => { setPref(v); paintTheme(); render(); } }, t)));
  };
  paintTheme();

  const densLabels: [Density, string][] = [['compact', T.densNormal], ['comfortable', T.densLarge]];
  const densBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.textSize });
  const paintDens = (): void => {
    densBox.replaceChildren(...densLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': state.density === v, onclick: () => { setDensity(v); paintDens(); } }, t)));
  };
  paintDens();

  // Taal: Auto volgt de telefoon; een vaste keuze wordt onthouden. Bij wisselen opent het scherm opnieuw in de nieuwe taal.
  const langBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.language },
    ...(['auto', ...LANGS] as LangPref[]).map((v) => h('button', { 'aria-pressed': getLangPref() === v, onclick: () => {
      if (getLangPref() === v) return;
      setLangPref(v);
      const scroll = sheet.scrollTop;
      close(); render(); openSettings();
      const again = [...document.querySelectorAll('.sheet')].pop();
      if (again) again.scrollTop = scroll;
    } }, v === 'auto' ? T.langAuto : v.toUpperCase())));

  // Geschiedenis bijhouden (server)
  const trackMsg = mkMsg();
  const trackBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.keepHistory });
  const trackLabels: [TrackingMode, string][] = [['off', T.off], ['park-hours', T.daytime], ['always', T.always]];
  let trackMode: TrackingMode | null = null;
  const paintTrack = (): void => {
    trackBox.replaceChildren(...trackLabels.map(([v, t]) =>
      h('button', { 'aria-pressed': trackMode === v, onclick: async () => {
        const before = trackMode;
        trackMode = v; paintTrack();
        try { const r = await saveTracking(v); trackMode = r.mode; trackMsg.say(v === 'off' ? T.trackOff : v === 'always' ? T.trackAlways : T.trackDay, 'good'); }
        catch { trackMode = before; trackMsg.say(T.errSaveShort, 'err'); }
        paintTrack();
      } }, t)));
  };
  paintTrack();
  fetchTracking().then((r) => { trackMode = r.mode; paintTrack(); }).catch(() => trackMsg.say(T.trackFetchErr, 'err'));

  // Simulatie
  const simSpots = state.entities.filter((e) => e.location);
  const simSelect = h('select', { class: 'select sm', 'aria-label': T.simLocation, onchange: (ev: Event) => void setSim(true, (ev.target as HTMLSelectElement).value) },
    h('option', { value: '' }, T.parkCentre),
    ...[...simSpots].sort((a, b) => a.name.localeCompare(b.name, lang)).map((e) => h('option', { value: e.id, selected: e.id === sim.spot }, e.name)));
  const simBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.simulation });
  const paintSim = (): void => {
    simBox.replaceChildren(
      h('button', { 'aria-pressed': !sim.on, onclick: () => { void setSim(false); paintSim(); } }, T.off),
      h('button', { 'aria-pressed': sim.on, onclick: () => { void setSim(true); paintSim(); } }, T.on));
  };
  paintSim();

  // Spelletje: na het inchecken vragen of niet (game.ts)
  const gameBox = h('div', { class: 'segments', role: 'group', 'aria-label': T.gameSetting });
  const paintGame = (): void => {
    gameBox.replaceChildren(
      h('button', { 'aria-pressed': gameAskOn(), onclick: () => { setGameAsk(true); paintGame(); } }, T.gameAskYes),
      h('button', { 'aria-pressed': !gameAskOn(), onclick: () => { setGameAsk(false); paintGame(); } }, T.gameAskNo));
  };
  paintGame();

  // Shows
  const marginOptions = [0, 5, 10, 15, 20, 30, 45, 60];
  const speeds: [number, string][] = [[3.5, T.paceRelaxed], [4.5, T.paceNormal], [5.5, T.paceBrisk]];
  const marginSelect = h('select', { class: 'select sm', 'aria-label': T.marginLabel, onchange: (ev: Event) => { state.prefs.arrivalMarginMin = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); render(); } },
    ...marginOptions.map((m) => h('option', { value: m, selected: m === state.prefs.arrivalMarginMin }, m === 0 ? T.exactlyOnTime : T.minEarly(m))));
  const speedSelect = h('select', { class: 'select sm', 'aria-label': T.walkPace, onchange: (ev: Event) => { state.prefs.walkingSpeedKmh = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); render(); } },
    ...speeds.map(([v, t]) => h('option', { value: v, selected: v === state.prefs.walkingSpeedKmh }, t)));

  // Eigen koppelcode
  const custom = mkMsg();
  const customInput = h('input', { class: 'input', type: 'text', placeholder: T.codePlaceholder, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': T.ownCodeAria, maxlength: 24 });
  const saveCustom = h('button', { class: 'btn sm' }, T.saveBtn);
  saveCustom.addEventListener('click', async () => {
    const value = customInput.value.trim();
    if (value.replace(/[^A-Za-z0-9]/g, '').length < 4) return custom.say(T.codeMin, 'err');
    saveCustom.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode(value);
      custom.say(T.codeSaved(code), 'good');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'code_taken') {
        custom.el.className = 'msg';
        custom.el.replaceChildren(codeTakenOffer(value, async (n) => { customInput.value = ''; await loadPark(); custom.say(T.restored(n), 'good'); }, () => { custom.say(''); customInput.focus(); }));
      } else if (err instanceof ApiError && err.code === 'invalid_code') custom.say(T.codeMin, 'err');
      else custom.say(T.errSave, 'err');
    }
    saveCustom.removeAttribute('disabled');
  });

  // Sterke code
  const strongBox = h('div');
  const strongBtn = h('button', { class: 'btn secondary sm' }, T.strongBtn);
  strongBtn.addEventListener('click', async () => {
    strongBtn.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode();
      const copy = h('button', { class: 'btn sm' }, T.copy);
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); copy.textContent = T.copied; } catch { copy.textContent = T.copyFailCode; }
      });
      strongBox.replaceChildren(h('div', { class: 'code-row' }, h('div', { class: 'code' }, code), copy), h('p', { class: 'code-warn' }, T.strongNote));
    } catch { strongBox.replaceChildren(h('p', {}, T.strongFail)); }
    strongBtn.removeAttribute('disabled');
  });

  // Terughalen
  const restore = mkMsg();
  const input = h('input', { class: 'input', type: 'text', placeholder: T.yourCode, autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': T.linkCode, maxlength: 24 });
  const restoreBtn = h('button', { class: 'btn secondary sm' }, T.retrieve);
  restoreBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return restore.say(T.enterCode, 'err');
    if (state.favorites.size > 0 && !confirm(T.confirmReplace)) return;
    restoreBtn.setAttribute('disabled', '');
    try {
      const result = await redeemRecoveryCode(code);
      setCreds({ deviceId: result.deviceId, token: result.token });
      input.value = '';
      await loadPark();
      restore.say(T.restored(result.favoriteCount), 'good');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) restore.say(T.tooMany, 'err');
      else if (err instanceof ApiError && err.code === 'invalid_code') restore.say(T.codeWrong, 'err');
      else restore.say(T.restoreFail, 'err');
    }
    restoreBtn.removeAttribute('disabled');
  });

  // Omschrijvingen die nog ontbreken
  const missing = state.entities.filter((e) => !blurbFor(e.name));
  const copyMissing = h('button', { class: 'btn secondary sm' }, T.copyN(missing.length));
  copyMissing.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`${currentPark()?.name}\n${missing.map((e) => `${e.type === 'show' ? T.showWord : T.attractionWord}: ${e.name}`).join('\n')}`); copyMissing.textContent = T.copied; }
    catch { copyMissing.textContent = T.copyFail; }
  });

  // Compacte opbouw: één regel per instelling, uitleg achter (i).
  const row = (label: string, control: Node | null, info?: string): HTMLElement => {
    const infoEl = info ? h('p', { class: 'set-info', hidden: true }, info) : null;
    const btn = info ? h('button', { class: 'info-btn', 'aria-label': T.infoAria(label), 'aria-expanded': false, onclick: () => {
      const open = infoEl!.hidden; infoEl!.hidden = !open; btn!.setAttribute('aria-expanded', String(open));
    } }, 'i') : null;
    return h('div', { class: 'set-item' },
      h('div', { class: 'set-row' }, h('span', { class: 'set-label' }, label, btn), control),
      infoEl);
  };
  const group = (title: string, ...items: (Node | null)[]): HTMLElement =>
    h('section', { class: 'set-sec' }, h('h3', {}, title), h('div', { class: 'set-group' }, ...items));
  const simRow = row(T.imAt, simSelect);
  const paintSimRow = (): void => { simRow.hidden = !sim.on; };
  paintSimRow();
  simBox.addEventListener('click', () => setTimeout(paintSimRow, 0));

  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, T.settings), h('button', { class: 'icon-btn', 'aria-label': T.close, onclick: close }, '✕')),
    group(T.gDisplay,
      row(T.theme, themeBox),
      row(T.text, densBox, T.densInfo),
      row(T.language, langBox, T.langInfo(LANG_NAMES[lang]))),
    group(T.gShows,
      row(T.marginLabel, marginSelect, T.marginInfo),
      row(T.walkPace, speedSelect),
      row(T.location, h('span', { class: 'set-value' }, T.oncePerLaunch), T.locInfo),
      row(T.gameSetting, gameBox, T.gameSettingInfo)),
    group(T.gServer,
      row(T.history, trackBox, T.histInfo),
      trackMsg.el,
      row(T.simulation, simBox, T.simInfo),
      simRow),
    group(T.gDevices,
      h('details', { class: 'set-more set-code', open: focus === 'code' },
        h('summary', {}, T.linkCode),
        row(T.ownCode, null, T.codeInfo),
        h('div', { class: 'code-line' }, customInput, saveCustom),
        h('p', { class: 'code-warn' }, T.ownCodeWarn),
        custom.el,
        h('div', { class: 'inline-actions' }, strongBtn),
        strongBox,
        h('div', { class: 'set-sub' }, T.haveCode),
        h('div', { class: 'code-line' }, input, restoreBtn),
        restore.el)),
    group(T.gAbout,
      row(T.descriptions, copyMissing, T.descInfo),
      row(T.version(APP_VERSION), updateBtn),
      update.el,
      h('details', { class: 'set-more' },
        h('summary', {}, T.whatsNew),
        ...CHANGELOG.map((c) => h('div', { class: 'cl-entry' },
          h('div', { class: 'cl-head' }, h('b', {}, c.version === 'Eerder' ? T.earlier : T.version(c.version)), c.date ? h('span', {}, changelogDate(c.date)) : null),
          h('ul', {}, ...changesFor(c).map((x) => h('li', {}, x))))))));
  document.body.append(sheet);
  if (focus === 'code') setTimeout(() => sheet.querySelector('.set-code')?.scrollIntoView({ block: 'start' }), 0);
}

// ---- Help en rondleiding ----------------------------------------------------------------------

/** Eerste start: begint bij welkom + koppelcode. Uit het menu of Help: meteen bij de eerste uitlegstap. */
function showTour(fromStart = false): void {
  openTour({ favoriteCount: () => state.favorites.size, reload: () => loadPark() }, fromStart ? 0 : 1);
}

function showHelp(): void {
  openHelp({ replayTour: () => showTour(), openCodeSettings: () => openSettings('code') });
}

/** Menu (☰) linksboven in de kop, op de EVailability-manier: ronde knop, het menu klapt direct eronder open
 *  (kaart met afgeronde hoeken, grote regels met een scheidingslijn, geen titel en geen Annuleren).
 *  Tik ernaast, Escape of scrollen sluit het. De open-stand staat in een variabele, zodat een automatische
 *  verversing (render) het menu niet dichtgooit. */
let menuOpen = false;
function setMenu(open: boolean): void {
  if (menuOpen === open) return;
  menuOpen = open;
  render();
}
function menuItem(label: string, run: () => void): HTMLElement {
  return h('button', { type: 'button', role: 'menuitem', onclick: () => { setMenu(false); run(); } }, label);
}
function menuButton(): HTMLElement {
  return h('div', { class: 'menu-wrap' },
    h('button', {
      type: 'button', class: 'menu-btn', 'aria-label': T.menu, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
      onclick: (e: Event) => { e.stopPropagation(); setMenu(!menuOpen); },
    }, icon('menu', 20)),
    menuOpen
      ? h('div', { class: 'menu', role: 'menu' },
          menuItem(T.settings, () => openSettings()),
          menuItem(T.help, showHelp),
          menuItem(T.tour, () => showTour()))
      : null);
}
document.addEventListener('click', (e) => {
  if (menuOpen && !(e.target as Element | null)?.closest?.('.menu-wrap')) setMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
window.addEventListener('scroll', () => setMenu(false), { passive: true });

// ---- Start -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  applyTheme();
  render();
  fetchHealth().then((r) => { state.serverVersion = r.version ?? null; render(); }).catch(() => undefined);
  // Nieuwe gebruiker (nog geen profiel en de rondleiding nooit gezien): rondleiding tonen. Bepalen vóór ensureProfile.
  if (tourWanted()) showTour(true);
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
  if (!state.parkId) { state.loading = false; state.error = T.errNoServer; render(); return; }
  await loadPark();
}

watchSystemTheme(render);
// Taal van de telefoon gewijzigd terwijl de app openstaat: bij 'Auto' meteen volgen.
window.addEventListener('languagechange', () => { const before = lang; if (applyLang() !== before) render(); });
let tick = 0;
// Zuinig verversen, alleen als de app zichtbaar is en er verbinding is: Mijn programma elke minuut, het Overzicht elke 2 minuten.
setInterval(() => {
  tick++;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  if (tick % (state.view === 'plan' ? 2 : 4) === 0) void refreshLive();
}, 30_000);
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);
// Lopende tijd in de rij: elke seconde alleen de balk bijwerken, niet het hele scherm.
setInterval(() => { if (queue && document.visibilityState === 'visible') paintQueue(); }, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive(); });
window.addEventListener('online', () => void refreshLive());
window.addEventListener('offline', render);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

void boot();
