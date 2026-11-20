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
import {
  ApiError, createRecoveryCode, deleteFavorite, ensureProfile, fetchEntities, fetchFavorites, fetchHistory,
  fetchLive, fetchParks, fetchPreferences, fetchSchedule, putFavorite, redeemRecoveryCode, savePreferences, setCreds,
} from './api';
import { h, svg } from './dom';
import { agoLabel, clock, waitLevel } from './format';
import { GeoError, formatDistance, getPosition, haversineMeters, hasGeoPermission, walkMinutes } from './geo';
import { blurbFor } from './info';
import { distanceOf, nextStartMs, sortEntities } from './logic';

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
  favorites: new Set<string>(),
  prefs: { ...DEFAULT_PREFERENCES } as PreferencesDto,
  tab: 'attractions' as Tab,
  onlyOpen: false,
  pos: loadPos(),
  loc: 'idle' as LocStatus,
  loading: true,
  error: null as string | null,
  fromCache: false,
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
  if (state.prefs.sort !== 'distance' || state.loc === 'denied' || state.loc === 'asking') return;
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

function parkStats(): { openCount: number; avg: number | null; short: { name: string; min: number } | null; long: { name: string; min: number } | null } {
  let openCount = 0, sum = 0, n = 0;
  let short: { name: string; min: number } | null = null;
  let long: { name: string; min: number } | null = null;
  for (const e of state.entities) {
    if (e.type !== 'attraction') continue;
    const l = state.live.get(e.id);
    if (l?.status !== 'open') continue;
    openCount++;
    if (l.waitMinutes === null) continue;
    sum += l.waitMinutes; n++;
    if (!short || l.waitMinutes < short.min) short = { name: e.name, min: l.waitMinutes };
    if (!long || l.waitMinutes > long.min) long = { name: e.name, min: l.waitMinutes };
  }
  return { openCount, avg: n ? Math.round(sum / n) : null, short, long };
}

function changedText(live: LiveInfo | undefined): string {
  if (!live?.changedAt) return '';
  const ago = agoLabel(live.changedAt);
  if (live.changeObserved) return `gewijzigd ${ago}`;
  return ago === 'zojuist' ? '' : `ongewijzigd sinds ${ago.replace(' geleden', '')}`;
}

function trendNode(live: LiveInfo | undefined): Node | null {
  if (!live?.changeObserved || live.waitMinutes === null || live.prevWaitMinutes === null) return null;
  if (live.waitMinutes === live.prevWaitMinutes) return null;
  const up = live.waitMinutes > live.prevWaitMinutes;
  return h('span', { class: `trend ${up ? 'up' : 'down'}`, 'aria-label': up ? 'gestegen' : 'gedaald' },
    `${up ? '▲' : '▼'} was ${live.prevWaitMinutes} · `);
}

// ---- Rijen -----------------------------------------------------------------------------------

function badge(entity: EntityInfo, live: LiveInfo | undefined): HTMLElement {
  if (!live) return h('div', { class: 'badge text' }, '–');
  if (entity.type === 'show') {
    const next = nextStartMs(live);
    return next !== null
      ? h('div', { class: 'badge time' }, clock(next, tz()), h('small', {}, 'volgende'))
      : h('div', { class: 'badge text' }, 'geen meer');
  }
  switch (live.status) {
    case 'open':
      return live.waitMinutes !== null
        ? h('div', { class: `badge ${waitLevel(live.waitMinutes)}` }, String(live.waitMinutes), h('small', {}, 'min'))
        : h('div', { class: 'badge text' }, 'open');
    case 'down': return h('div', { class: 'badge text bad' }, 'storing');
    case 'closed': return h('div', { class: 'badge text' }, 'dicht');
    case 'refurbishment': return h('div', { class: 'badge text' }, 'onderhoud');
    default: return h('div', { class: 'badge text' }, '–');
  }
}

function upcomingStarts(live: LiveInfo | undefined): number[] {
  return (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter((t) => t > Date.now());
}

function renderRow(entity: EntityInfo): HTMLElement {
  const live = state.live.get(entity.id);
  const isFav = state.favorites.has(entity.id);
  const blurb = blurbFor(entity.name);
  const sub: string[] = [];
  if (entity.type === 'show') {
    const later = upcomingStarts(live).slice(1, 4);
    sub.push(later.length ? `Daarna ${later.map((t) => clock(t, tz())).join(', ')}` : 'Show');
  } else if (blurb) sub.push(blurb.kind);
  if (live?.singleRider && entity.type === 'attraction') sub.push('single rider');
  const d = distanceOf(entity, state.pos);
  if (d !== null) sub.push(`${formatDistance(d)}, ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`);
  const changed = entity.type === 'attraction' ? changedText(live) : '';
  return h('div', { class: 'row' },
    h('button', { class: 'row-open', 'aria-label': `${entity.name}, details`, onclick: () => openDetail(entity) },
      badge(entity, live),
      h('div', { class: 'row-main' },
        h('div', { class: 'row-name' }, entity.name),
        sub.length ? h('div', { class: 'row-sub' }, sub.join(' · ')) : null,
        changed ? h('div', { class: 'row-meta' }, trendNode(live), changed) : null)),
    h('button', {
      class: 'heart', 'aria-pressed': isFav,
      'aria-label': isFav ? `${entity.name} niet meer volgen` : `${entity.name} volgen`,
      onclick: () => void toggleFavorite(entity),
    }, isFav ? '♥' : '♡'));
}

function visibleEntities(): EntityInfo[] {
  const base = state.entities.filter((e) => {
    const typeOk = state.tab === 'attractions' ? e.type === 'attraction' : state.tab === 'shows' ? e.type === 'show' : state.favorites.has(e.id);
    if (!typeOk) return false;
    if (state.onlyOpen && e.type === 'attraction') return state.live.get(e.id)?.status === 'open';
    return true;
  });
  return sortEntities(base, { sort: state.prefs.sort, live: state.live, pos: state.pos, pinned: state.tab === 'shows' ? state.favorites : undefined });
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
  const offline = !navigator.onLine;
  const list = visibleEntities();
  const status = parkStatus();
  const stats = parkStats();

  let body: Node;
  if (state.loading && state.entities.length === 0) body = h('div', { class: 'empty' }, 'Gegevens laden…');
  else if (state.entities.length === 0) body = h('div', { class: 'empty' }, state.error ?? 'Geen attracties gevonden voor dit park.');
  else if (list.length === 0) {
    body = h('div', { class: 'empty' }, state.tab === 'favorites' ? 'Nog niets om te volgen. Tik op het hartje bij een attractie of show.' : 'Niets gevonden met dit filter.');
  } else body = h('div', {}, ...list.map(renderRow));

  const age = agoLabel(state.generatedAt);
  const freshText = state.fromCache
    ? `Opgeslagen gegevens, ${age}`
    : offline ? `Geen verbinding, gegevens van ${age}`
    : state.error && state.entities.length > 0 ? `${state.error.replace(/[.,]$/, '')} (gegevens van ${age})`
    : `Bijgewerkt ${age}`;

  const sortLabels: [SortMode, string][] = [['wait', state.tab === 'shows' ? 'Starttijd' : 'Wachttijd'], ['distance', 'Afstand'], ['name', 'Naam']];
  const scrollTop = window.scrollY;
  root.replaceChildren(
    h('header', { class: 'hero' },
      h('div', { class: 'hero-top' },
        h('div', { class: 'brand' }, 'ParkPilot'),
        h('button', { class: 'icon-btn', 'aria-label': 'Instellingen', onclick: openSettings }, '⚙︎')),
      state.parks.length > 1
        ? h('div', { class: 'parks', role: 'group', 'aria-label': 'Park' },
            ...state.parks.map((p) => h('button', { class: 'park-pill', 'aria-pressed': p.id === state.parkId, onclick: () => switchPark(p.id) }, p.shortName)))
        : null,
      h('h1', { class: 'park-name' }, park?.name ?? 'ParkPilot'),
      h('div', { class: 'park-status' },
        h('span', { class: `dot${status.open === true ? ' open' : status.open === false ? ' closed' : ''}` }), status.text),
      state.entities.length
        ? h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, String(stats.openCount)), h('span', {}, 'attracties open')),
            h('div', { class: 'stat' }, h('b', {}, stats.avg === null ? '–' : `${stats.avg} min`), h('span', {}, 'gemiddeld')),
            h('div', { class: 'stat' }, h('b', {}, stats.short ? `${stats.short.min} min` : '–'), h('span', {}, stats.short ? `korst: ${stats.short.name}` : 'korst')))
        : null),
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
      h('div', { class: `fresh${offline || state.error || state.fromCache ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    locationNotice(),
    h('main', {}, body));
  window.scrollTo(0, scrollTop);
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

function sparkline(data: HistoryResponse, now: number): Node {
  const W = 300, H = 80, PAD = 4;
  const from = Date.parse(data.from);
  const pts = data.rows.map((r) => ({ t: Math.max(from, Date.parse(r.at)), y: r.status === 'open' && r.wait !== null ? r.wait : 0 }));
  if (pts.length < 2) return h('div', { class: 'chart-note' }, 'Het verloop wordt opgebouwd zodra ParkPilot wijzigingen ziet. Kom later terug.');
  const max = Math.max(30, ...pts.map((p) => p.y));
  const x = (t: number): number => PAD + ((t - from) / (now - from)) * (W - 2 * PAD);
  const y = (v: number): number => H - PAD - (v / max) * (H - 2 * PAD);
  let line = `M ${x(pts[0].t).toFixed(1)} ${y(pts[0].y).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) line += ` H ${x(pts[i].t).toFixed(1)} V ${y(pts[i].y).toFixed(1)}`;
  line += ` H ${x(now).toFixed(1)}`;
  const area = `${line} V ${H - PAD} H ${x(pts[0].t).toFixed(1)} Z`;
  return h('div', {},
    svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Verloop van de wachttijd' },
      svg('path', { d: area, fill: 'var(--accent)', 'fill-opacity': 0.18 }),
      svg('path', { d: line, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' })),
    h('div', { class: 'chart-note' }, `Hoogste ${Math.max(...pts.map((p) => p.y))} min in de afgelopen 12 uur. Alleen wijzigingen die ParkPilot zag.`));
}

function openDetail(entity: EntityInfo): void {
  const live = state.live.get(entity.id);
  const blurb = blurbFor(entity.name);
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
      bigNodes.push(h('div', { class: `big ${waitLevel(live.waitMinutes)}` }, h('b', {}, String(live.waitMinutes)), h('span', {}, 'minuten wachttijd')));
    } else {
      const t = { open: 'Open, geen wachttijd bekend', down: 'Storing', closed: 'Dicht', refurbishment: 'In onderhoud', unknown: 'Status onbekend' }[live.status];
      bigNodes.push(h('div', { class: 'big' }, h('span', {}, t)));
    }
    addFact('Wachttijd gewijzigd', live.changeObserved ? agoLabel(live.changedAt) : null);
    if (live.changeObserved && live.prevWaitMinutes !== null) addFact('Daarvoor', `${live.prevWaitMinutes} min`);
    addFact('Bron bijgewerkt', live.updatedAt ? agoLabel(live.updatedAt) : null);
    if (live.singleRider) addFact('Single rider', 'beschikbaar');
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
    fetchHistory(state.parkId, entity.id, 12)
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
      h('div', {}, h('h2', {}, entity.name), blurb ? h('div', { class: 'kind' }, blurb.kind) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    blurb ? h('p', { class: 'blurb' }, blurb.text) : null,
    ...bigNodes,
    facts.childNodes.length ? facts : null,
    caveat,
    entity.type === 'attraction' ? h('div', { class: 'section-title' }, 'Verloop, laatste 12 uur') : null,
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
      entities: state.entities, live: [...state.live.values()], schedule: state.schedule, generatedAt: state.generatedAt,
    }));
  } catch { /* opslag vol: geen ramp */ }
}

function loadCache(parkId: string): boolean {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey(parkId)) ?? 'null') as
      { entities: EntityInfo[]; live: LiveInfo[]; schedule: ScheduleEntry[]; generatedAt: string } | null;
    if (!c) return false;
    state.entities = c.entities;
    state.live = new Map(c.live.map((l) => [l.id, l]));
    state.schedule = c.schedule;
    state.generatedAt = c.generatedAt;
    state.fromCache = true;
    return true;
  } catch { return false; }
}

async function loadPark(): Promise<void> {
  if (!state.parkId) return;
  const parkId = state.parkId;
  state.loading = true; state.entities = []; state.live = new Map(); state.schedule = [];
  state.generatedAt = null; state.error = null; state.fromCache = false;
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
    const [live, schedule] = await Promise.all([fetchLive(state.parkId), fetchSchedule(state.parkId).catch(() => null)]);
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    if (schedule) state.schedule = schedule.today;
    state.error = null; state.fromCache = false;
    saveCache();
  } catch { state.error = 'Verversen mislukt,'; }
  await refreshPositionQuietly();
  render();
}

// ---- Instellingen en koppelcode --------------------------------------------------------------

function openSettings(): void {
  const message = h('div', { class: 'msg', role: 'status' });
  const codeBox = h('div');
  const input = h('input', { class: 'input', type: 'text', placeholder: 'XXXX-XXXX-XXXX', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: false, 'aria-label': 'Koppelcode', maxlength: 20 });
  const say = (text: string, kind: 'good' | 'err' | '' = ''): void => { message.className = `msg ${kind}`.trim(); message.textContent = text; };
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Instellingen' });
  const close = (): void => sheet.remove();

  const marginOptions = [0, 5, 10, 15, 20, 30, 45, 60];
  const speeds: [number, string][] = [[3.5, 'Rustig (3,5 km/u)'], [4.5, 'Normaal (4,5 km/u)'], [5.5, 'Vlot (5,5 km/u)']];
  const marginSelect = h('select', { class: 'select', onchange: (ev: Event) => { state.prefs.arrivalMarginMin = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); } },
    ...marginOptions.map((m) => h('option', { value: m, selected: m === state.prefs.arrivalMarginMin }, m === 0 ? 'Op het moment zelf' : `${m} minuten`)));
  const speedSelect = h('select', { class: 'select', onchange: (ev: Event) => { state.prefs.walkingSpeedKmh = Number((ev.target as HTMLSelectElement).value); void persistPrefs(); render(); } },
    ...speeds.map(([v, t]) => h('option', { value: v, selected: v === state.prefs.walkingSpeedKmh }, t)));

  const makeBtn = h('button', { class: 'btn' }, 'Maak koppelcode');
  makeBtn.addEventListener('click', async () => {
    makeBtn.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode();
      const copy = h('button', { class: 'btn secondary' }, 'Kopieer');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code); copy.textContent = 'Gekopieerd'; } catch { copy.textContent = 'Kopiëren lukt niet, noteer de code'; }
      });
      codeBox.replaceChildren(
        h('div', { class: 'code' }, code),
        h('p', {}, 'Bewaar deze code ergens veilig, bijvoorbeeld in je notities. Hij wordt maar één keer getoond. Een nieuwe code maakt deze ongeldig. Wie de code heeft, kan jouw lijstje openen en wijzigen.'),
        copy);
      say('');
    } catch { say('Koppelcode maken mislukt. Probeer het opnieuw.', 'err'); }
    makeBtn.removeAttribute('disabled');
  });

  const restoreBtn = h('button', { class: 'btn secondary' }, 'Lijst terughalen');
  restoreBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return say('Vul eerst je koppelcode in.', 'err');
    if (state.favorites.size > 0 && !confirm('De favorieten op dit toestel worden vervangen door de lijst van de koppelcode. Doorgaan?')) return;
    restoreBtn.setAttribute('disabled', '');
    try {
      const result = await redeemRecoveryCode(code);
      setCreds({ deviceId: result.deviceId, token: result.token });
      input.value = '';
      await loadPark();
      say(result.favoriteCount === 1 ? '1 favoriet teruggezet.' : `${result.favoriteCount} favorieten teruggezet.`, 'good');
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) say('Te veel pogingen. Probeer het over een uur opnieuw.', 'err');
      else if (err instanceof ApiError && err.code === 'invalid_code') say('Deze koppelcode klopt niet.', 'err');
      else say('Terughalen mislukt. Controleer je verbinding.', 'err');
    }
    restoreBtn.removeAttribute('disabled');
  });

  sheet.append(
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Instellingen'), h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    h('h3', {}, 'Shows'),
    h('label', { class: 'field' }, h('span', {}, 'Ik wil zo ver van tevoren bij een show zijn'), marginSelect,
      h('div', { class: 'hint' }, 'Hiermee berekent ParkPilot straks wanneer je moet vertrekken. De melding zelf komt in een volgende versie.')),
    h('label', { class: 'field' }, h('span', {}, 'Looptempo'), speedSelect),
    h('h3', {}, 'Locatie'),
    h('p', {}, 'ParkPilot gebruikt je locatie alleen als je sorteert op afstand. Je locatie wordt niet naar de server gestuurd.'),
    h('h3', {}, 'Koppelcode'),
    h('p', {}, 'Je favorieten hangen aan een anoniem profiel op dit toestel. Met een koppelcode haal je ze terug na een herinstallatie of open je ze op een ander toestel. Let op: de app op je beginscherm heeft op iPhone een eigen opslag, los van Safari. Maak de code dus aan in de app die je echt gebruikt.'),
    makeBtn, codeBox,
    h('h3', {}, 'Heb je al een koppelcode?'),
    input,
    h('div', { class: 'inline-actions', style: 'margin-top:10px' }, restoreBtn),
    message);
  document.body.append(sheet);
}

// ---- Start -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  render();
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

setInterval(() => { if (document.visibilityState === 'visible') void refreshLive(); }, 60_000);
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive(); });
window.addEventListener('online', () => void refreshLive());
window.addEventListener('offline', render);

void boot();
