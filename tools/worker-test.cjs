// Testharnas voor de ParkPilot-Worker, zonder Cloudflare en zonder netwerk.
// - D1 wordt nagebootst met node:sqlite (in-memory), met de echte migraties.
// - fetch naar ThemeParks.wiki wordt nagebootst met vaste nepdata (Parijse datum van vandaag).
// Gebruik: bash tools/test-worker.sh (compileert eerst naar .test-build/).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, '.test-build');

// ---- Nep-D1 ----------------------------------------------------------------------------------

function makeD1() {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(ROOT, 'worker/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...values) { return new Stmt(this.sql, values.map(norm)); }
    async first() { const r = db.prepare(this.sql).get(...this.params); return r ? { ...r } : null; }
    async all() { return { results: db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })), success: true, meta: {} }; }
    async run() { db.prepare(this.sql).run(...this.params); return { results: [], success: true, meta: {} }; }
    runSync() { db.prepare(this.sql).run(...this.params); }
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { for (const s of stmts) s.runSync(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
      return stmts.map(() => ({ results: [], success: true, meta: {} }));
    },
    async exec(sql) { db.exec(sql); },
  };
}

// ---- Nep-ThemeParks.wiki ---------------------------------------------------------------------

const { zonedEpochMs, localDateStr, addDays } = require(path.join(BUILD, 'worker/src/util.js'));
const TZ = 'Europe/Paris';
const today = localDateStr(TZ, Date.now());
const iso = (ms) => new Date(ms).toISOString();

const fake = {
  calls: [],
  wait: 25,
  parkOpen: true,
  showtimes: () => ['12:00', '23:00'].map((t) => ({ startTime: iso(zonedEpochMs(today, t, TZ)), endTime: null })),
};

function respond(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', age: '60' } });
}

globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  fake.calls.push(url);
  const p = url.replace('https://api.themeparks.wiki/v1', '');
  if (p === '/destinations') {
    return respond({ destinations: [{ name: 'Disneyland Paris', parks: [
      { id: 'P-DLP', name: 'Disneyland Park' },
      { id: 'P-WDS', name: 'Disney Adventure World' },
    ] }] });
  }
  const m = /^\/entity\/([^/]+)\/(children|live|schedule)$/.exec(p);
  if (!m) return new Response('nope', { status: 404 });
  const [, , kind] = m;
  if (kind === 'children') {
    return respond({ children: [
      { id: 'A2', name: 'Zebra Ride', entityType: 'ATTRACTION', location: { latitude: 48.868, longitude: 2.78 } },
      { id: 'L1', name: 'Land', entityType: 'AREA', children: [
        { id: 'A1', name: 'Alpha Coaster', entityType: 'ATTRACTION', location: null },
        { id: 'S1', name: 'Grote Show', entityType: 'SHOW' },
      ] },
      { id: 'R1', name: 'Restaurant', entityType: 'RESTAURANT' },
    ] });
  }
  if (kind === 'live') {
    return respond({ liveData: [
      { id: 'A1', entityType: 'ATTRACTION', status: 'OPERATING', lastUpdated: iso(Date.now() - 120000), queue: { STANDBY: { waitTime: fake.wait }, SINGLE_RIDER: { waitTime: 10 } } },
      { id: 'A2', entityType: 'ATTRACTION', status: 'DOWN', queue: { STANDBY: { waitTime: null } } },
      { id: 'S1', entityType: 'SHOW', status: 'OPERATING', showtimes: fake.showtimes() },
      { id: 'R1', entityType: 'RESTAURANT', status: 'OPERATING' },
    ] });
  }
  const now = Date.now();
  const opens = fake.parkOpen ? now - 3 * 3600e3 : now - 12 * 3600e3;
  const closes = fake.parkOpen ? now + 5 * 3600e3 : now - 10 * 3600e3;
  return respond({ schedule: [
    { date: today, type: 'OPERATING', openingTime: iso(opens), closingTime: iso(closes) },
    { date: addDays(today, 1), type: 'OPERATING', openingTime: iso(opens + 86400e3), closingTime: iso(closes + 86400e3) },
  ] });
};

// ---- Testjes ---------------------------------------------------------------------------------

const worker = require(path.join(BUILD, 'worker/src/index.js')).default;
const env = { DB: makeD1(), ASSETS: { fetch: async () => new Response('') } };
const count = (table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

let ipSeq = 0;
async function call(method, pathname, { body, token, ip } = {}) {
  const headers = { 'cf-connecting-ip': ip ?? `10.0.0.${++ipSeq}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new Request(`https://pp.test/api/${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const waits = [];
  const res = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
  await Promise.all(waits);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}
async function cron() {
  const waits = [];
  await worker.scheduled({ scheduledTime: Date.now(), cron: '*/5 * * * *', noRetry() {} }, env, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
  await Promise.all(waits);
}

let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n     ${e && e.message}`); }
}
function eq(actual, expected, what) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: verwacht ${b}, kreeg ${a}`);
}
const tokenOf = (d) => `${d.deviceId}.${d.token}`;

(async () => {
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  let tokA, tokB, code;

  await test('health geeft versie gelijk aan package.json', async () => {
    const r = await call('GET', 'health');
    eq(r.status, 200, 'status'); eq(r.data.version, pkgVersion, 'versie');
  });
  await test('parken: twee parken, beide gevonden bij de bron', async () => {
    const r = await call('GET', 'parks');
    eq(r.data.map((p) => [p.id, p.available]), [['dlp-disneyland', true], ['dlp-studios', true]], 'parken');
  });
  await test('onbekend park geeft 404', async () => {
    eq((await call('GET', 'parks/bestaat-niet/live')).status, 404, 'status');
  });
  await test('entiteiten: alleen attracties en shows, ook genest, gesorteerd', async () => {
    const r = await call('GET', 'parks/dlp-studios/entities');
    eq(r.data.entities.map((e) => [e.id, e.type]), [['A1', 'attraction'], ['S1', 'show'], ['A2', 'attraction']], 'entiteiten');
    eq(r.data.entities[2].location, { lat: 48.868, lng: 2.78 }, 'locatie');
  });
  await test('live: statussen, wachttijd, restaurant genegeerd', async () => {
    const r = await call('GET', 'parks/dlp-studios/live');
    eq(r.data.live.map((l) => [l.id, l.status, l.waitMinutes]), [['A1', 'open', 25], ['A2', 'down', null], ['S1', 'open', null]], 'live');
    eq([r.data.live[0].singleRider, r.data.live[0].singleRiderWait, r.data.live[1].singleRiderWait], [true, 10, null], 'single rider');
    eq(r.data.live[2].showtimes.length, 2, 'showtijden');
  });
  await test('live-route schrijft niets naar D1', async () => {
    eq([count('wait_state'), count('wait_log')], [0, 0], 'rijen');
  });
  await test('schema: vandaag en morgen', async () => {
    const r = await call('GET', 'parks/dlp-studios/schedule');
    eq(r.data.today.length, 1, 'vandaag'); eq(r.data.days.map((d) => d.date), [today, addDays(today, 1)], 'dagen');
  });
  await test('profiel aanmaken geeft apparaat en token', async () => {
    const r = await call('POST', 'profile');
    eq(r.status, 201, 'status');
    if (!/^[0-9a-f-]{36}$/.test(r.data.deviceId) || !/^[0-9a-f]{64}$/.test(r.data.token)) throw new Error('vorm van token klopt niet');
    tokA = tokenOf(r.data);
  });
  await test('zonder token geen favorieten (401)', async () => {
    eq((await call('GET', 'favorites')).status, 401, 'status');
    eq((await call('GET', 'favorites', { token: '00000000-0000-0000-0000-000000000000.' + '0'.repeat(64) })).status, 401, 'nep-token');
  });
  await test('favoriet toevoegen en ophalen', async () => {
    eq((await call('PUT', 'favorites/dlp-studios/A1', { token: tokA, body: { type: 'attraction' } })).status, 200, 'put');
    await call('PUT', 'favorites/dlp-studios/S1', { token: tokA, body: { type: 'show' } });
    const r = await call('GET', 'favorites?parkId=dlp-studios', { token: tokA });
    eq(r.data.map((f) => f.entityId).sort(), ['A1', 'S1'], 'favorieten');
  });
  await test('favoriet met fout type geeft 400', async () => {
    eq((await call('PUT', 'favorites/dlp-studios/A2', { token: tokA, body: { type: 'eten' } })).status, 400, 'status');
  });
  await test('favoriet verwijderen', async () => {
    await call('DELETE', 'favorites/dlp-studios/S1', { token: tokA });
    eq((await call('GET', 'favorites', { token: tokA })).data.map((f) => f.entityId), ['A1'], 'over');
  });
  await test('voorkeuren: standaard, opslaan, terugkrijgen', async () => {
    const d = await call('GET', 'preferences/dlp-studios', { token: tokA });
    if (!d.data.sort) throw new Error('geen standaardvoorkeur');
    eq((await call('PUT', 'preferences/dlp-studios', { token: tokA, body: { sort: 'name', arrivalMarginMin: 15, walkingSpeedKmh: 4.5 } })).status, 200, 'put');
    eq((await call('GET', 'preferences/dlp-studios', { token: tokA })).data, { sort: 'name', arrivalMarginMin: 15, walkingSpeedKmh: 4.5 }, 'terug');
  });
  await test('ongeldige voorkeuren geven 400', async () => {
    eq((await call('PUT', 'preferences/dlp-studios', { token: tokA, body: { sort: 'name', arrivalMarginMin: 15, walkingSpeedKmh: 20 } })).status, 400, 'status');
  });
  await test('sterke koppelcode heeft vorm XXXX-XXXX-XXXX', async () => {
    const r = await call('POST', 'profile/recovery-code', { token: tokA, body: {} });
    if (!/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(r.data.code)) throw new Error(`code ${r.data.code}`);
    code = r.data.code;
  });
  await test('koppelcode inwisselen geeft nieuw apparaat op hetzelfde profiel', async () => {
    const r = await call('POST', 'profile/redeem', { body: { code: code.toLowerCase() } });
    eq(r.data.favoriteCount, 1, 'aantal favorieten');
    eq((await call('GET', 'favorites', { token: tokenOf(r.data) })).data.map((f) => f.entityId), ['A1'], 'zelfde lijst');
  });
  await test('eigen code "1234" mag, tweede profiel krijgt 409', async () => {
    eq((await call('POST', 'profile/recovery-code', { token: tokA, body: { code: '1234' } })).data.code, '1234', 'eigen code');
    tokB = tokenOf((await call('POST', 'profile')).data);
    eq((await call('POST', 'profile/recovery-code', { token: tokB, body: { code: '12-34' } })).status, 409, 'bezet');
  });
  await test('verkeerde koppelcode geeft 404, te korte 400', async () => {
    eq((await call('POST', 'profile/redeem', { body: { code: 'ZZZZ' } })).status, 404, 'onbekend');
    eq((await call('POST', 'profile/redeem', { body: { code: 'AB' } })).status, 400, 'te kort');
  });
  await test('koppelcode raden wordt begrensd (429 na 10 pogingen)', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await call('POST', 'profile/redeem', { ip: '10.9.9.9', body: { code: 'QQQQ' } })).status);
    eq(statuses.slice(-2), [404, 429], 'laatste twee');
  });
  await test('tracking: standaard alleen overdag, park open = actief', async () => {
    const r = await call('GET', 'settings/tracking', { token: tokA });
    eq(r.data.mode, 'park-hours', 'modus'); eq(r.data.active['dlp-studios'], true, 'actief');
    eq((await call('PUT', 'settings/tracking', { token: tokA, body: { mode: 'soms' } })).status, 400, 'ongeldig');
  });
  await test('tracking uit: cron schrijft niets', async () => {
    await call('PUT', 'settings/tracking', { token: tokA, body: { mode: 'off' } });
    await cron();
    eq([count('wait_state'), count('wait_log'), count('show_seen')], [0, 0, 0], 'rijen');
  });
  await test('alleen overdag + park dicht: cron schrijft niets', async () => {
    await call('PUT', 'settings/tracking', { token: tokA, body: { mode: 'park-hours' } });
    fake.parkOpen = false;
    const r = await call('GET', 'settings/tracking', { token: tokA });
    eq(r.data.active['dlp-studios'], false, 'niet actief');
    await cron();
    fake.parkOpen = true;
    eq(count('wait_state'), 0, 'wait_state');
  });
  await test('cron bij open park: staat, log en showtijden bewaard', async () => {
    await cron();
    eq(count('wait_state'), 6, 'wait_state (3 per park)');
    eq(count('wait_log'), 6, 'wait_log');
    eq(count('show_seen'), 4, 'show_seen (2 per park)');
  });
  await test('cron zonder wijziging schrijft geen nieuwe logregels', async () => {
    await cron();
    eq(count('wait_log'), 6, 'wait_log');
  });
  await test('wachttijd verandert: gelogd, live toont vorige waarde', async () => {
    // In het echt zit er minstens 5 minuten tussen twee cron-rondes; hier gebeurt alles in één seconde.
    env.DB.raw.exec('UPDATE wait_state SET first_seen_at = first_seen_at - 600, changed_at = changed_at - 600');
    env.DB.raw.exec('UPDATE wait_log SET at = at - 600');
    fake.wait = 40;
    await cron();
    eq(count('wait_log'), 8, 'wait_log');
    const a1 = (await call('GET', 'parks/dlp-studios/live')).data.live.find((l) => l.id === 'A1');
    eq([a1.waitMinutes, a1.prevWaitMinutes, a1.changeObserved], [40, 25, true], 'A1');
  });
  await test('historie vandaag geeft het verloop', async () => {
    const r = await call('GET', 'parks/dlp-studios/history/A1?since=today');
    eq(r.data.rows.map((x) => x.wait), [25, 40], 'verloop');
  });
  await test('shows vandaag uit de bron, morgen verwacht', async () => {
    const t = await call('GET', `parks/dlp-studios/shows?date=${today}`);
    eq(t.data.shows.map((s) => [s.entityId, s.slots.map((x) => x.source)]), [['S1', ['bron', 'bron']]], 'vandaag');
    const m = await call('GET', `parks/dlp-studios/shows?date=${addDays(today, 1)}`);
    eq(m.data.shows.map((s) => [s.entityId, s.slots.map((x) => x.source)]), [['S1', ['verwacht', 'verwacht']]], 'morgen');
    if (!m.data.expectedBasis) throw new Error('geen uitleg bij verwachting');
    if (!m.data.basis || !['lastWeek', 'lastSeen', 'mixed'].includes(m.data.basis.kind)) throw new Error('geen taalloze uitleg (basis) bij verwachting');
    eq(m.data.opening.length, 1, 'openingstijd morgen');
  });
  await test('shows: datum buiten bereik geeft 400', async () => {
    eq((await call('GET', `parks/dlp-studios/shows?date=${addDays(today, 14)}`)).status, 400, 'te ver');
    eq((await call('GET', 'parks/dlp-studios/shows?date=gisteren')).status, 400, 'onzin');
  });

  await test('kijkplek: show zonder locatie opslaan, iedereen ziet hem', async () => {
    eq((await call('PUT', 'locations/dlp-studios/S1', { body: { lat: 48.8685, lng: 2.7801 } })).status, 401, 'zonder profiel');
    const r = await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 48.8685, lng: 2.7801, accuracy: 12.4 } });
    eq(r.status, 200, 'opslaan');
    const s1 = (await call('GET', 'parks/dlp-studios/entities')).data.entities.find((e) => e.id === 'S1');
    eq([s1.location, s1.locationSource, s1.locationAccuracy], [{ lat: 48.8685, lng: 2.7801 }, 'user', 12], 'zichtbaar zonder profiel, met nauwkeurigheid');
  });
  await test('kijkplek: ander profiel mag bijwerken en verwijderen', async () => {
    const r = await call('PUT', 'locations/dlp-studios/S1', { token: tokB, body: { lat: 48.869, lng: 2.781 } });
    eq([r.status, r.data.error, r.data.current.locationAccuracy], [409, 'location_exists', 12], 'zonder bevestiging geweigerd');
    eq((await call('PUT', 'locations/dlp-studios/S1', { token: tokB, body: { lat: 48.869, lng: 2.781, accuracy: 8, replace: true } })).status, 200, 'met bevestiging vervangen');
    eq(env.DB.raw.prepare('SELECT lat, accuracy_m FROM user_locations').get(), { lat: 48.869, accuracy_m: 8 }, 'nieuwe plek');
    eq(count('user_locations'), 1, 'één plek per show');
    eq((await call('DELETE', 'locations/dlp-studios/S1', { token: tokB })).status, 200, 'verwijderen');
    const s1 = (await call('GET', 'parks/dlp-studios/entities')).data.entities.find((e) => e.id === 'S1');
    eq([s1.location, s1.locationSource], [null, null], 'weer zonder locatie');
  });
  await test('kijkplek: geweigerd voor attractie, bronlocatie, ver weg, onzin', async () => {
    eq((await call('PUT', 'locations/dlp-studios/A1', { token: tokA, body: { lat: 48.8685, lng: 2.7801 } })).status, 409, 'attractie');
    eq((await call('PUT', 'locations/dlp-studios/A2', { token: tokA, body: { lat: 48.8685, lng: 2.7801 } })).status, 409, 'bronlocatie');
    eq((await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 52.37, lng: 4.89 } })).status, 400, 'Amsterdam');
    eq((await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 'x' } })).status, 400, 'onzin');
    eq((await call('PUT', 'locations/dlp-studios/ZZ', { token: tokA, body: { lat: 48.8685, lng: 2.7801 } })).status, 404, 'onbekend');
    eq(count('user_locations'), 0, 'niets opgeslagen');
  });

  await test('spel: score insturen, alleen de beste per naam, lijst voor iedereen', async () => {
    eq((await call('GET', 'game/balloon/scores')).data.top, [], 'leeg');
    eq((await call('POST', 'game/balloon/scores', { body: { name: 'Remco', score: 5 } })).status, 401, 'zonder profiel');
    let r = await call('POST', 'game/balloon/scores', { token: tokA, body: { name: '  Remco ', score: 5 } });
    eq([r.status, r.data.rank, r.data.best], [200, 1, 5], 'eerste score');
    r = await call('POST', 'game/balloon/scores', { token: tokA, body: { name: 'Remco', score: 3 } });
    eq([r.data.rank, r.data.best], [1, 5], 'lagere score verandert niets');
    await call('POST', 'game/balloon/scores', { token: tokB, body: { name: 'Ana', score: 9 } });
    r = await call('POST', 'game/balloon/scores', { token: tokA, body: { name: 'Remco', score: 7 } });
    eq([r.data.rank, r.data.best], [2, 7], 'hogere score telt, plek 2');
    eq(count('game_scores'), 2, 'één regel per profiel en naam');
    const top = (await call('GET', 'game/balloon/scores')).data.top.map((x) => [x.name, x.score]);
    eq(top, [['Ana', 9], ['Remco', 7]], 'lijst zonder profiel, hoogste eerst');
  });
  await test('spel: onzin geweigerd', async () => {
    eq((await call('POST', 'game/balloon/scores', { token: tokA, body: { name: '', score: 4 } })).status, 400, 'lege naam');
    eq((await call('POST', 'game/balloon/scores', { token: tokA, body: { name: 'x'.repeat(17), score: 4 } })).status, 400, 'te lange naam');
    eq((await call('POST', 'game/balloon/scores', { token: tokA, body: { name: 'Remco', score: 2.5 } })).status, 400, 'geen geheel getal');
    eq((await call('POST', 'game/balloon/scores', { token: tokA, body: { name: 'Remco', score: 100000 } })).status, 400, 'te hoog');
    eq((await call('GET', 'game/tetris/scores')).status, 404, 'onbekend spel');
  });

  console.log(failed ? `\n${failed} test(s) mislukt` : '\nalles ok');
  process.exit(failed ? 1 : 0);
})();
