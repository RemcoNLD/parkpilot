import './style.css';
import {
  DEFAULT_PREFERENCES,
  type EntityInfo,
  type LatLng,
  type LiveInfo,
  type ParkInfo,
  type PreferencesDto,
  type SortMode,
} from '../../../packages/shared/src/index';
import {
  ApiError,
  createRecoveryCode,
  deleteFavorite,
  ensureProfile,
  fetchEntities,
  fetchFavorites,
  fetchLive,
  fetchParks,
  fetchPreferences,
  putFavorite,
  redeemRecoveryCode,
  savePreferences,
  setCreds,
} from './api';
import { GeoError, formatDistance, getPosition, haversineMeters, hasGeoPermission, walkMinutes } from './geo';
import { distanceOf, nextStartMs, sortEntities } from './logic';

// ---- Kleine DOM-helper (zet tekst altijd als tekst, nooit als HTML) --------------------------

type Child = Node | string | null | false | undefined;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

// ---- State -----------------------------------------------------------------------------------

type Tab = 'attractions' | 'shows' | 'favorites';
type LocStatus = 'idle' | 'asking' | 'ok' | 'denied' | 'error';

const POS_KEY = 'pp.pos';

function loadPos(): LatLng | null {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as { lat: number; lng: number; at: number } | null;
    // Een positie van meer dan 10 minuten oud tonen we niet als "huidige locatie".
    return p && Date.now() - p.at < 10 * 60_000 ? { lat: p.lat, lng: p.lng } : null;
  } catch {
    return null;
  }
}

const state = {
  parks: [] as ParkInfo[],
  parkId: localStorage.getItem('pp.park') ?? '',
  entities: [] as EntityInfo[],
  live: new Map<string, LiveInfo>(),
  generatedAt: null as string | null,
  favorites: new Set<string>(),
  prefs: { ...DEFAULT_PREFERENCES } as PreferencesDto,
  tab: 'attractions' as Tab,
  pos: loadPos(),
  loc: 'idle' as LocStatus,
  loading: true,
  error: null as string | null,
};

const root = document.getElementById('app') as HTMLElement;
const currentPark = (): ParkInfo | undefined => state.parks.find((p) => p.id === state.parkId);

// ---- Locatie (alleen op verzoek van de gebruiker, nooit bij het opstarten) --------------------

async function ensurePosition(): Promise<boolean> {
  state.loc = 'asking';
  render();
  try {
    state.pos = await getPosition();
    state.loc = 'ok';
    localStorage.setItem(POS_KEY, JSON.stringify({ ...state.pos, at: Date.now() }));
    render();
    return true;
  } catch (err) {
    state.loc = err instanceof GeoError && err.code === 'denied' ? 'denied' : 'error';
    render();
    return false;
  }
}

/** Ververst de positie stil, maar alleen als de gebruiker daar al toestemming voor gaf. */
async function refreshPositionQuietly(): Promise<void> {
  if (state.prefs.sort !== 'distance' || state.loc === 'denied' || state.loc === 'asking') return;
  if (state.loc !== 'ok' && !(await hasGeoPermission())) return;
  try {
    state.pos = await getPosition();
    state.loc = 'ok';
    localStorage.setItem(POS_KEY, JSON.stringify({ ...state.pos, at: Date.now() }));
  } catch {
    /* de vorige positie blijft staan */
  }
}

// ---- Weergave --------------------------------------------------------------------------------

function ageLabel(iso: string | null): string {
  if (!iso) return 'nog niet bijgewerkt';
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 1 ? 'zojuist bijgewerkt' : `bijgewerkt ${minutes} min geleden`;
}

function timeLabel(ms: number, timeZone: string): string {
  return new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone });
}

function upcomingStarts(live: LiveInfo | undefined): number[] {
  return (live?.showtimes ?? []).map((s) => Date.parse(s.start)).filter((t) => t > Date.now());
}

function waitCell(entity: EntityInfo, live: LiveInfo | undefined, timeZone: string): HTMLElement {
  if (!live) return h('div', { class: 'wait off' }, '–');
  if (entity.type === 'show') {
    const next = nextStartMs(live);
    return next !== null
      ? h('div', { class: 'wait' }, timeLabel(next, timeZone), h('small', {}, 'volgende'))
      : h('div', { class: 'wait off' }, 'geen meer');
  }
  switch (live.status) {
    case 'open':
      return live.waitMinutes !== null
        ? h('div', { class: 'wait' }, String(live.waitMinutes), h('small', {}, 'min'))
        : h('div', { class: 'wait off' }, 'open');
    case 'down':
      return h('div', { class: 'wait off bad' }, 'storing');
    case 'closed':
      return h('div', { class: 'wait off' }, 'dicht');
    case 'refurbishment':
      return h('div', { class: 'wait off' }, 'onderhoud');
    default:
      return h('div', { class: 'wait off' }, '–');
  }
}

function subLine(entity: EntityInfo, timeZone: string): string {
  const parts: string[] = [];
  if (entity.type === 'show') {
    const later = upcomingStarts(state.live.get(entity.id)).slice(1, 4);
    parts.push(later.length ? `Daarna ${later.map((t) => timeLabel(t, timeZone)).join(', ')}` : 'Show');
  }
  const d = distanceOf(entity, state.pos);
  if (d !== null) parts.push(`${formatDistance(d)} · ${walkMinutes(d, state.prefs.walkingSpeedKmh)} min lopen`);
  return parts.join(' · ');
}

function renderRow(entity: EntityInfo, timeZone: string): HTMLElement {
  const isFav = state.favorites.has(entity.id);
  const sub = subLine(entity, timeZone);
  const label = entity.type === 'show' ? 'show' : 'attractie';
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, entity.name),
      sub ? h('div', { class: 'row-sub' }, sub) : null),
    waitCell(entity, state.live.get(entity.id), timeZone),
    h('button', {
      class: 'heart',
      'aria-pressed': isFav,
      'aria-label': isFav ? `${entity.name} niet meer volgen` : `${entity.name} volgen (${label})`,
      onclick: () => void toggleFavorite(entity),
    }, isFav ? '♥' : '♡'),
  );
}

function visibleEntities(): EntityInfo[] {
  const base = state.entities.filter((e) => {
    if (state.tab === 'attractions') return e.type === 'attraction';
    if (state.tab === 'shows') return e.type === 'show';
    return state.favorites.has(e.id);
  });
  return sortEntities(base, {
    sort: state.prefs.sort,
    live: state.live,
    pos: state.pos,
    pinned: state.tab === 'shows' ? state.favorites : undefined,
  });
}

function locationNotice(): HTMLElement | null {
  const park = currentPark();
  if (state.prefs.sort === 'distance') {
    if (state.loc === 'asking') return h('div', { class: 'notice' }, 'Locatie bepalen…');
    if (state.loc === 'denied') {
      return h('div', { class: 'notice' },
        'ParkPilot mag je locatie niet gebruiken. Zet dat aan via Instellingen op je iPhone, bij Privacy en beveiliging, ' +
        'Locatievoorzieningen. Open daarna de app opnieuw.');
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

function render(): void {
  const park = currentPark();
  const timeZone = park?.timezone ?? 'Europe/Paris';
  const offline = !navigator.onLine;
  const list = visibleEntities();

  let body: Node;
  if (state.loading && state.entities.length === 0) {
    body = h('div', { class: 'empty' }, 'Gegevens laden…');
  } else if (state.entities.length === 0) {
    body = h('div', { class: 'empty' }, state.error ?? 'Geen attracties gevonden voor dit park.');
  } else if (list.length === 0) {
    body = h('div', { class: 'empty' },
      state.tab === 'favorites'
        ? 'Nog niets om te volgen. Tik op het hartje bij een attractie of show.'
        : 'Niets gevonden.');
  } else {
    body = h('div', {}, ...list.map((e) => renderRow(e, timeZone)));
  }

  const freshText = offline
    ? `Geen verbinding, ${ageLabel(state.generatedAt)}`
    : state.error && state.entities.length > 0
      ? `${state.error.replace(/[.,]$/, '')} (${ageLabel(state.generatedAt)})`
      : ageLabel(state.generatedAt);

  const select = h(
    'select',
    {
      class: 'park-select',
      'aria-label': 'Park',
      onchange: (ev: Event) => {
        state.parkId = (ev.target as HTMLSelectElement).value;
        localStorage.setItem('pp.park', state.parkId);
        void loadPark();
      },
    },
    ...state.parks.map((p) => h('option', { value: p.id, selected: p.id === state.parkId }, p.name)),
  );

  const sortLabels: [SortMode, string][] = [
    ['wait', state.tab === 'shows' ? 'Starttijd' : 'Wachttijd'],
    ['distance', 'Afstand'],
    ['name', 'Naam'],
  ];

  const scrollTop = window.scrollY;
  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('h1', { class: 'title' }, 'ParkPilot'),
        h('button', { class: 'icon-btn', 'aria-label': 'Instellingen', onclick: openSettings }, '⚙︎')),
      state.parks.length > 1 ? select : null,
      h('div', { class: 'segments three', role: 'group', 'aria-label': 'Weergave' },
        h('button', { 'aria-pressed': state.tab === 'attractions', onclick: () => setTab('attractions') }, 'Attracties'),
        h('button', { 'aria-pressed': state.tab === 'shows', onclick: () => setTab('shows') }, 'Shows'),
        h('button', { 'aria-pressed': state.tab === 'favorites', onclick: () => setTab('favorites') },
          `Volgend${state.favorites.size ? ` (${state.favorites.size})` : ''}`)),
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Sorteren' },
        ...sortLabels.map(([mode, text]) =>
          h('button', { class: 'chip', 'aria-pressed': state.prefs.sort === mode, onclick: () => void setSort(mode) }, text))),
      h('div', { class: `fresh${offline || state.error ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    locationNotice(),
    h('main', {}, body),
  );
  window.scrollTo(0, scrollTop);
}

function setTab(tab: Tab): void {
  state.tab = tab;
  render();
}

async function setSort(sort: SortMode): Promise<void> {
  if (sort === 'distance' && !state.pos) {
    state.prefs.sort = 'distance';
    if (!(await ensurePosition())) return; // melding en knop staan dan in beeld
  }
  state.prefs.sort = sort;
  render();
  void persistPrefs();
}

async function persistPrefs(): Promise<void> {
  try {
    await savePreferences(state.parkId, state.prefs);
  } catch {
    state.error = 'Voorkeuren opslaan mislukt.';
    render();
  }
}

// ---- Gegevens --------------------------------------------------------------------------------

async function toggleFavorite(entity: EntityInfo): Promise<void> {
  const wasFav = state.favorites.has(entity.id);
  if (wasFav) state.favorites.delete(entity.id);
  else state.favorites.add(entity.id);
  render();
  try {
    if (wasFav) await deleteFavorite(state.parkId, entity.id);
    else await putFavorite(state.parkId, entity.id, entity.type);
  } catch {
    // Terugdraaien zodat het scherm niet liegt over wat er opgeslagen is.
    if (wasFav) state.favorites.add(entity.id);
    else state.favorites.delete(entity.id);
    state.error = 'Opslaan mislukt. Probeer het opnieuw.';
    render();
  }
}

async function loadPark(): Promise<void> {
  if (!state.parkId) return;
  const parkId = state.parkId;
  state.loading = true;
  state.entities = [];
  state.live = new Map();
  state.generatedAt = null;
  state.error = null;
  render();
  try {
    const [entities, live, favs, prefs] = await Promise.all([
      fetchEntities(parkId),
      fetchLive(parkId),
      fetchFavorites(parkId),
      fetchPreferences(parkId).catch(() => ({ ...DEFAULT_PREFERENCES })),
    ]);
    if (parkId !== state.parkId) return; // gebruiker is intussen van park gewisseld
    state.entities = entities.entities;
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.favorites = new Set(favs.map((f) => f.entityId));
    state.prefs = prefs;
    await refreshPositionQuietly();
  } catch (err) {
    state.error = err instanceof ApiError && err.code === 'park_not_found_upstream'
      ? 'Dit park is niet gevonden bij ThemeParks.wiki.'
      : 'Gegevens laden mislukt.';
  }
  state.loading = false;
  render();
}

async function refreshLive(): Promise<void> {
  if (!state.parkId || state.entities.length === 0) return;
  try {
    const live = await fetchLive(state.parkId);
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.error = null;
  } catch {
    state.error = 'Verversen mislukt,';
  }
  await refreshPositionQuietly();
  render();
}

// ---- Instellingen en koppelcode --------------------------------------------------------------

function openSettings(): void {
  const message = h('div', { class: 'msg', role: 'status' });
  const codeBox = h('div');
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'XXXX-XXXX-XXXX',
    autocomplete: 'off',
    autocapitalize: 'characters',
    autocorrect: 'off',
    spellcheck: false,
    'aria-label': 'Koppelcode',
    maxlength: 20,
  });

  const say = (text: string, kind: 'good' | 'err' | '' = ''): void => {
    message.className = `msg ${kind}`.trim();
    message.textContent = text;
  };

  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Instellingen' });
  const close = (): void => sheet.remove();

  // Voorkeuren
  const marginOptions = [0, 5, 10, 15, 20, 30, 45, 60];
  const speeds: [number, string][] = [[3.5, 'Rustig (3,5 km/u)'], [4.5, 'Normaal (4,5 km/u)'], [5.5, 'Vlot (5,5 km/u)']];
  const marginSelect = h('select', { class: 'select', onchange: (ev: Event) => {
    state.prefs.arrivalMarginMin = Number((ev.target as HTMLSelectElement).value);
    void persistPrefs();
  } }, ...marginOptions.map((m) =>
    h('option', { value: m, selected: m === state.prefs.arrivalMarginMin }, m === 0 ? 'Op het moment zelf' : `${m} minuten`)));
  const speedSelect = h('select', { class: 'select', onchange: (ev: Event) => {
    state.prefs.walkingSpeedKmh = Number((ev.target as HTMLSelectElement).value);
    void persistPrefs();
    render();
  } }, ...speeds.map(([v, t]) => h('option', { value: v, selected: v === state.prefs.walkingSpeedKmh }, t)));

  const makeBtn = h('button', { class: 'btn' }, 'Maak koppelcode');
  makeBtn.addEventListener('click', async () => {
    makeBtn.setAttribute('disabled', '');
    try {
      const { code } = await createRecoveryCode();
      const copy = h('button', { class: 'btn secondary' }, 'Kopieer');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code);
          copy.textContent = 'Gekopieerd';
        } catch {
          copy.textContent = 'Kopiëren lukt niet, noteer de code';
        }
      });
      codeBox.replaceChildren(
        h('div', { class: 'code' }, code),
        h('p', {}, 'Bewaar deze code ergens veilig, bijvoorbeeld in je notities. Hij wordt maar één keer getoond. ' +
          'Een nieuwe code maakt deze ongeldig. Wie de code heeft, kan jouw lijstje openen en wijzigen.'),
        copy,
      );
      say('');
    } catch {
      say('Koppelcode maken mislukt. Probeer het opnieuw.', 'err');
    }
    makeBtn.removeAttribute('disabled');
  });

  const restoreBtn = h('button', { class: 'btn secondary' }, 'Lijst terughalen');
  restoreBtn.addEventListener('click', async () => {
    const code = input.value.trim();
    if (!code) return say('Vul eerst je koppelcode in.', 'err');
    if (state.favorites.size > 0 &&
        !confirm('De favorieten op dit toestel worden vervangen door de lijst van de koppelcode. Doorgaan?')) return;
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
    h('div', { class: 'topbar-row' },
      h('h2', {}, 'Instellingen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
    h('h3', {}, 'Shows'),
    h('label', { class: 'field' },
      h('span', {}, 'Ik wil zo ver van tevoren bij een show zijn'),
      marginSelect,
      h('div', { class: 'hint' }, 'Hiermee berekent ParkPilot straks wanneer je moet vertrekken. De melding zelf komt in een volgende versie.')),
    h('label', { class: 'field' }, h('span', {}, 'Looptempo'), speedSelect),
    h('h3', {}, 'Locatie'),
    h('p', {}, 'ParkPilot gebruikt je locatie alleen als je sorteert op afstand. Je locatie wordt niet naar de server gestuurd.'),
    h('h3', {}, 'Koppelcode'),
    h('p', {}, 'Je favorieten hangen aan een anoniem profiel op dit toestel. Met een koppelcode haal je ze terug na een herinstallatie ' +
      'of open je ze op een ander toestel. Let op: de app op je beginscherm heeft op iPhone een eigen opslag, los van Safari. ' +
      'Maak de code dus aan in de app die je echt gebruikt.'),
    makeBtn,
    codeBox,
    h('h3', {}, 'Heb je al een koppelcode?'),
    input,
    h('div', { class: 'inline-actions', style: 'margin-top:10px' }, restoreBtn),
    message,
  );
  document.body.append(sheet);
}

// ---- Start -----------------------------------------------------------------------------------

async function boot(): Promise<void> {
  render();
  try {
    await ensureProfile();
    state.parks = await fetchParks();
    const usable = state.parks.filter((p) => p.available);
    if (!state.parks.some((p) => p.id === state.parkId && p.available)) {
      state.parkId = usable[0]?.id ?? state.parks[0]?.id ?? '';
    }
    state.parks = usable.length > 0 ? usable : state.parks;
    await loadPark();
  } catch {
    state.loading = false;
    state.error = 'Kan de server niet bereiken.';
    render();
  }
}

setInterval(() => { if (document.visibilityState === 'visible') void refreshLive(); }, 60_000);
setInterval(() => { if (document.visibilityState === 'visible') render(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void refreshLive(); });
window.addEventListener('online', () => void refreshLive());
window.addEventListener('offline', render);

void boot();
