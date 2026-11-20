import './style.css';
import type { EntityInfo, LiveInfo, ParkInfo } from '../../../packages/shared/src/index';
import {
  ApiError,
  createRecoveryCode,
  deleteFavorite,
  ensureProfile,
  fetchEntities,
  fetchFavorites,
  fetchLive,
  fetchParks,
  putFavorite,
  redeemRecoveryCode,
  setCreds,
} from './api';

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

type Tab = 'all' | 'favorites';

const state = {
  parks: [] as ParkInfo[],
  parkId: localStorage.getItem('pp.park') ?? '',
  entities: [] as EntityInfo[],
  live: new Map<string, LiveInfo>(),
  generatedAt: null as string | null,
  favorites: new Set<string>(),
  tab: 'all' as Tab,
  loading: true,
  error: null as string | null,
};

const root = document.getElementById('app') as HTMLElement;
const currentPark = (): ParkInfo | undefined => state.parks.find((p) => p.id === state.parkId);

// ---- Weergave --------------------------------------------------------------------------------

function ageLabel(iso: string | null): string {
  if (!iso) return 'nog niet bijgewerkt';
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'zojuist bijgewerkt';
  return `bijgewerkt ${minutes} min geleden`;
}

function timeLabel(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone });
}

function waitCell(entity: EntityInfo, live: LiveInfo | undefined, timeZone: string): HTMLElement {
  if (!live) return h('div', { class: 'wait off' }, '–');
  if (entity.type === 'show') {
    const next = live.showtimes.find((s) => Date.parse(s.start) > Date.now());
    return next
      ? h('div', { class: 'wait' }, timeLabel(next.start, timeZone), h('small', {}, 'volgende'))
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

function renderRow(entity: EntityInfo, timeZone: string): HTMLElement {
  const isFav = state.favorites.has(entity.id);
  return h(
    'div',
    { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-name' }, entity.name),
      entity.type === 'show' ? h('div', { class: 'row-sub' }, 'Show') : null),
    waitCell(entity, state.live.get(entity.id), timeZone),
    h('button', {
      class: 'heart',
      'aria-pressed': isFav,
      'aria-label': isFav ? `${entity.name} uit favorieten halen` : `${entity.name} als favoriet markeren`,
      onclick: () => void toggleFavorite(entity),
    }, isFav ? '♥' : '♡'),
  );
}

function render(): void {
  const park = currentPark();
  const timeZone = park?.timezone ?? 'Europe/Paris';
  const offline = !navigator.onLine;

  const visible = state.entities.filter((e) => state.tab === 'all' || state.favorites.has(e.id));

  let body: Node;
  if (state.loading && state.entities.length === 0) {
    body = h('div', { class: 'empty' }, 'Gegevens laden…');
  } else if (state.entities.length === 0) {
    body = h('div', { class: 'empty' }, state.error ?? 'Geen attracties gevonden voor dit park.');
  } else if (visible.length === 0) {
    body = h('div', { class: 'empty' }, 'Nog geen favorieten. Tik op het hartje bij een attractie of show om hem te volgen.');
  } else {
    body = h('div', {}, ...visible.map((e) => renderRow(e, timeZone)));
  }

  const freshText = offline
    ? `Geen verbinding, ${ageLabel(state.generatedAt)}`
    : state.error && state.entities.length > 0
      ? `Verversen mislukt, ${ageLabel(state.generatedAt)}`
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

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('div', { class: 'topbar-row' },
        h('h1', { class: 'title' }, 'ParkPilot'),
        h('button', { class: 'icon-btn', 'aria-label': 'Instellingen', onclick: openSettings }, '⚙︎')),
      state.parks.length > 1 ? select : null,
      h('div', { class: 'segments', role: 'group', 'aria-label': 'Weergave' },
        h('button', { 'aria-pressed': state.tab === 'all', onclick: () => setTab('all') }, 'Alles'),
        h('button', { 'aria-pressed': state.tab === 'favorites', onclick: () => setTab('favorites') },
          `Favorieten${state.favorites.size ? ` (${state.favorites.size})` : ''}`)),
      h('div', { class: `fresh${offline || state.error ? ' stale' : ''}`, 'aria-live': 'polite' }, freshText)),
    h('main', {}, body),
  );
}

function setTab(tab: Tab): void {
  state.tab = tab;
  render();
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
    state.error = 'Favoriet opslaan mislukt. Probeer het opnieuw.';
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
    const [entities, live, favs] = await Promise.all([fetchEntities(parkId), fetchLive(parkId), fetchFavorites(parkId)]);
    if (parkId !== state.parkId) return; // gebruiker is intussen van park gewisseld
    state.entities = entities.entities;
    state.live = new Map(live.live.map((l) => [l.id, l]));
    state.generatedAt = live.generatedAt;
    state.favorites = new Set(favs.map((f) => f.entityId));
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
    state.error = 'Verversen mislukt.';
  }
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
      else if (err instanceof ApiError && (err.code === 'invalid_code')) say('Deze koppelcode klopt niet.', 'err');
      else say('Terughalen mislukt. Controleer je verbinding.', 'err');
    }
    restoreBtn.removeAttribute('disabled');
  });

  sheet.append(
    h('div', { class: 'topbar-row' },
      h('h2', {}, 'Instellingen'),
      h('button', { class: 'icon-btn', 'aria-label': 'Sluiten', onclick: close }, '✕')),
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
