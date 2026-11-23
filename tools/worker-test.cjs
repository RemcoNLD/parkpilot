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
  push: [],
  pushGone: false,
  wait: 25,
  srcAge: 120000, // ouderdom van lastUpdated in de bron (ms)
  parkOpen: true,
  showtimes: () => ['12:00', '23:00'].map((t) => ({ startTime: iso(zonedEpochMs(today, t, TZ)), endTime: null })),
};

function respond(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', age: '60' } });
}

globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('https://push.test/')) {
    fake.push.push({ url, auth: init.headers.Authorization, enc: init.headers['Content-Encoding'], size: init.body.length });
    return new Response('', { status: fake.pushGone ? 410 : 201 });
  }
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
      { id: 'A1', entityType: 'ATTRACTION', status: 'OPERATING', lastUpdated: iso(Date.now() - fake.srcAge), queue: { STANDBY: { waitTime: fake.wait }, SINGLE_RIDER: { waitTime: 10 } } },
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
  await test('bron valt stil (>30 min geen update): één stale-regel, terug actief: één open-regel', async () => {
    const rows = () => env.DB.raw.prepare("SELECT status, wait FROM wait_log WHERE park_id = 'dlp-studios' AND entity_id = 'A1' ORDER BY at, rowid").all().map((r) => `${r.status}:${r.wait}`);
    fake.srcAge = 3 * 3600e3;
    await cron();
    eq(rows(), ['open:25', 'open:40', 'stale:40'], 'stil');
    await cron();
    eq(rows().length, 3, 'geen extra regel zolang het stil blijft');
    fake.srcAge = 120000;
    await cron();
    eq(rows(), ['open:25', 'open:40', 'stale:40', 'open:40'], 'weer actief');
    const a1 = (await call('GET', 'parks/dlp-studios/live')).data.live.find((l) => l.id === 'A1');
    eq([a1.prevWaitMinutes, a1.changeObserved], [25, true], 'wijzigingsgegevens blijven kloppen');
  });
  await test('vorige weken: gemiddelde zelfde weekdag, alleen open tijden, tijden naar vandaag', async () => {
    const leeg = await call('GET', 'parks/dlp-studios/history/A2?ref=weeks');
    eq([leeg.status, leeg.data.dates, leeg.data.rows], [200, [], []], 'zonder gegevens leeg');
    const ins = env.DB.raw.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)');
    const at = (d, t) => Math.floor(zonedEpochMs(d, t, TZ) / 1000);
    const w1 = addDays(today, -7), w2 = addDays(today, -14), w5 = addDays(today, -35);
    ins.run('dlp-studios', 'R9', at(w1, '10:00'), 20, 'open');
    ins.run('dlp-studios', 'R9', at(w1, '11:00'), 40, 'open');
    ins.run('dlp-studios', 'R9', at(w1, '12:00'), null, 'down');
    ins.run('dlp-studios', 'R9', at(w2, '10:00'), 30, 'open');
    ins.run('dlp-studios', 'R9', at(w2, '13:00'), null, 'closed');
    ins.run('dlp-studios', 'R9', at(w5, '10:00'), 90, 'open'); // te oud: telt niet mee
    const r = await call('GET', 'parks/dlp-studios/history/R9?ref=weeks');
    eq(r.data.dates, [w1, w2], 'gebruikte dagen');
    const byTime = Object.fromEntries(r.data.rows.map((x) => [new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x.at)), x.wait]));
    eq(byTime, { '00:00': null, '10:00': 25, '11:00': 35, '12:00': 30, '13:00': null }, 'gemiddelde per tijd');
    if (!r.data.rows.every((x) => localDateStr(TZ, Date.parse(x.at)) === today)) throw new Error('tijden niet op vandaag');
  });
  await test('storingen vandaag: periodes per attractie, lopend, al bezig vóór middernacht', async () => {
    const ins = env.DB.raw.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)');
    const at = (d, t) => Math.floor(zonedEpochMs(d, t, TZ) / 1000);
    const y = addDays(today, -1);
    ins.run('dlp-studios', 'X1', at(today, '00:01'), 20, 'open');
    ins.run('dlp-studios', 'X1', at(today, '00:05'), null, 'down');
    ins.run('dlp-studios', 'X1', at(today, '00:10'), null, 'down'); // dubbele regel: zelfde storing
    ins.run('dlp-studios', 'X1', at(today, '00:30'), 15, 'open');
    ins.run('dlp-studios', 'X1', at(today, '00:40'), null, 'down'); // loopt nog
    ins.run('dlp-studios', 'X2', at(y, '22:00'), null, 'down');      // al bezig gisteren
    ins.run('dlp-studios', 'X2', at(today, '00:20'), null, 'closed');
    ins.run('dlp-studios', 'X3', at(y, '21:00'), null, 'down');
    ins.run('dlp-studios', 'X3', at(y, '22:00'), 10, 'open');        // gisteren al voorbij: telt niet
    const r = await call('GET', 'parks/dlp-studios/incidents');
    eq(r.status, 200, 'status');
    const mine = r.data.incidents.filter((i) => i.entityId.startsWith('X'))
      .map((i) => [i.entityId, i.start === r.data.from ? 'begin' : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(i.start)), i.end && new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(i.end)), i.startKnown]);
    eq(mine, [['X2', 'begin', '00:20', false], ['X1', '00:05', '00:30', true], ['X1', '00:40', null, true]], 'periodes');
    env.DB.raw.exec("DELETE FROM wait_log WHERE entity_id IN ('X1', 'X2', 'X3')");
  });
  await test('langdurig dicht: dicht of onderhoud zonder update van de bron in meer dan een dag', async () => {
    const { isLongClosed } = require(path.join(BUILD, 'packages/shared/src/index.js'));
    const n = Date.now(), ago = (h) => new Date(n - h * 3600e3).toISOString();
    eq([
      isLongClosed({ status: 'closed', updatedAt: ago(76 * 24) }, n),
      isLongClosed({ status: 'refurbishment', updatedAt: ago(25) }, n),
      isLongClosed({ status: 'closed', updatedAt: ago(20) }, n),
      isLongClosed({ status: 'open', updatedAt: ago(48) }, n),
      isLongClosed({ status: 'down', updatedAt: ago(48) }, n),
      isLongClosed({ status: 'closed', updatedAt: null }, n),
    ], [true, true, false, false, false, false], 'regels');
  });
  await test('cron bewaart verloop 29 dagen (voor de vergelijking met vorige weken)', async () => {
    const ins = env.DB.raw.prepare('INSERT INTO wait_log (park_id, entity_id, at, wait, status) VALUES (?, ?, ?, ?, ?)');
    const n = Math.floor(Date.now() / 1000);
    ins.run('dlp-studios', 'R8', n - 28 * 86400, 10, 'open');
    ins.run('dlp-studios', 'R8', n - 30 * 86400, 10, 'open');
    await cron();
    eq(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM wait_log WHERE entity_id = 'R8'").get().n, 1, 'alleen de oude weg');
    env.DB.raw.exec("DELETE FROM wait_log WHERE entity_id IN ('R8', 'R9')");
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

  const adm = 'test-wachtwoord';
  const subRows = () => env.DB.raw.prepare('SELECT kind, status, profile_id FROM location_submissions ORDER BY id').all().map((r) => ({ ...r }));
  await test('kijkplek: nieuwe plek meteen in gebruik, onbevestigd, en naar de beheerder', async () => {
    eq((await call('PUT', 'locations/dlp-studios/S1', { body: { lat: 48.8685, lng: 2.7801, accuracy: 10 } })).status, 401, 'zonder profiel');
    const r = await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 48.8685, lng: 2.7801, accuracy: 12.4 } });
    eq([r.status, r.data.pending, r.data.locationConfirmed], [200, false, false], 'opslaan');
    const s1 = (await call('GET', 'parks/dlp-studios/entities')).data.entities.find((e) => e.id === 'S1');
    eq([s1.location, s1.locationSource, s1.locationAccuracy, s1.locationConfirmed], [{ lat: 48.8685, lng: 2.7801 }, 'user', 12, false], 'zichtbaar zonder profiel, onbevestigd');
    eq(subRows().map((x) => [x.kind, x.status]), [['new', 'pending']], 'inzending klaar voor de beheerder');
  });
  await test('kijkplek: eigen onbevestigde plek zelf aanpassen, die van een ander pas na akkoord', async () => {
    let r = await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 48.8686, lng: 2.7802, accuracy: 9, replace: true } });
    eq([r.status, r.data.pending], [200, false], 'eigen plek meteen aangepast');
    eq(subRows().map((x) => x.status), ['superseded', 'pending'], 'oude inzending vervallen');
    r = await call('PUT', 'locations/dlp-studios/S1', { token: tokB, body: { lat: 48.869, lng: 2.781, accuracy: 8 } });
    eq([r.status, r.data.error, r.data.current.locationAccuracy], [409, 'location_exists', 9], 'zonder bevestiging geweigerd');
    r = await call('PUT', 'locations/dlp-studios/S1', { token: tokB, body: { lat: 48.869, lng: 2.781, accuracy: 8, replace: true } });
    eq([r.status, r.data.pending], [200, true], 'voorstel van een ander wacht');
    eq(env.DB.raw.prepare('SELECT lat, accuracy_m FROM user_locations').get(), { lat: 48.8686, accuracy_m: 9 }, 'huidige plek blijft');
    eq((await call('DELETE', 'locations/dlp-studios/S1', { token: tokB })).data.pending, true, 'verwijderen van een ander wacht ook');
    eq(count('user_locations'), 1, 'plek staat er nog');
    eq(subRows().map((x) => [x.kind, x.status]), [['new', 'superseded'], ['new', 'pending'], ['replace', 'superseded'], ['delete', 'pending']], 'eigen vorige voorstel vervalt');
  });
  await test('kijkplek: geweigerd voor attractie, bronlocatie, buiten het park, onnauwkeurig, onzin', async () => {
    eq((await call('PUT', 'locations/dlp-studios/A1', { token: tokA, body: { lat: 48.8685, lng: 2.7801, accuracy: 5 } })).status, 409, 'attractie');
    eq((await call('PUT', 'locations/dlp-studios/A2', { token: tokA, body: { lat: 48.8685, lng: 2.7801, accuracy: 5 } })).status, 409, 'bronlocatie');
    eq((await call('PUT', 'locations/dlp-disneyland/S1', { token: tokA, body: { lat: 52.37, lng: 4.89, accuracy: 5 } })).data.error, 'outside_park', 'Amsterdam');
    eq((await call('PUT', 'locations/dlp-disneyland/S1', { token: tokA, body: { lat: 48.8722, lng: 2.7758, accuracy: 51 } })).data.error, 'low_accuracy', 'te onnauwkeurig');
    eq((await call('PUT', 'locations/dlp-disneyland/S1', { token: tokA, body: { lat: 48.8722, lng: 2.7758 } })).data.error, 'low_accuracy', 'zonder nauwkeurigheid');
    eq((await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 'x', replace: true } })).status, 400, 'onzin');
    eq((await call('PUT', 'locations/dlp-studios/ZZ', { token: tokA, body: { lat: 48.8685, lng: 2.7801, accuracy: 5 } })).status, 404, 'onbekend');
    eq(count('user_locations'), 1, 'niets bij opgeslagen');
  });
  await test('park-omhulling: echte bronlocaties Adventure World', async () => {
    const { outsideParkM } = require(path.join(BUILD, 'worker/src/locations.js'));
    const { findPark } = require(path.join(BUILD, 'worker/src/parks.js'));
    // Bronlocaties zoals de live-API ze op 23 nov 2026 gaf (een deel).
    const pts = [[48.86872, 2.781826], [48.86742740189942, 2.7783317864486885], [48.86544789048844, 2.7794149518013], [48.867726, 2.777854],
      [48.86651889190989, 2.775024175643921], [48.868041, 2.778142], [48.865138230945824, 2.7749919891357426], [48.864108, 2.773508],
      [48.86530644137726, 2.7792593836784363], [48.868288, 2.778352], [48.86815769739524, 2.7791735529899597], [48.866153, 2.77663],
      [48.86757046243673, 2.7762224525213237], [48.866903, 2.776651], [48.86611484299536, 2.779369354248047]];
    const ents = pts.map(([lat, lng], i) => ({ id: `E${i}`, type: 'attraction', name: `E${i}`, location: { lat, lng }, locationSource: 'source' }));
    const park = findPark('dlp-studios');
    eq(outsideParkM(park, ents, { lat: 48.866, lng: 2.777 }), 0, 'midden in het park');
    eq(outsideParkM(park, ents, { lat: 48.865415078285494, lng: 2.7748876438272627 }) <= 150, true, 'bestaande kijkplek Goofy');
    eq(outsideParkM(park, ents, { lat: 48.86453818673863, lng: 2.774071739944437 }) <= 150, true, 'bestaande kijkplek Elsa en Anna');
    eq(outsideParkM(park, ents, { lat: 48.8730, lng: 2.7763 }) > 150, true, 'kasteel Disneyland Park telt niet');
    eq(outsideParkM(park, ents, { lat: 48.8697, lng: 2.7860 }) > 150, true, 'Disney Village telt niet');
  });
  await test('beheer: zonder of met verkeerd wachtwoord geweigerd, daarna begrensd', async () => {
    eq((await call('GET', 'admin/review')).status, 401, 'zonder');
    eq((await call('GET', 'admin/review', { token: 'fout' })).status, 401, 'fout (ingebouwde hash)');
    for (let i = 0; i < 10; i++) await call('GET', 'admin/review', { token: 'fout', ip: '10.9.9.9' });
    eq((await call('GET', 'admin/review', { token: 'fout', ip: '10.9.9.9' })).status, 429, 'na 10 pogingen begrensd');
    env.ADMIN_PASSWORD = adm;
    eq((await call('GET', 'admin/review', { token: adm, ip: '10.9.9.9' })).status, 429, 'ook met goed wachtwoord even dicht');
    eq((await call('GET', 'admin/review', { token: adm.toUpperCase() })).status, 200, 'goed wachtwoord, hoofdletters maken niet uit');
  });
  await test('beheer: lijst te controleren, akkoord en afwijzen', async () => {
    const d = (await call('GET', 'admin/review', { token: adm })).data;
    eq(d.pending.map((x) => [x.kind, x.name]), [['delete', 'Grote Show'], ['new', 'Grote Show']], 'nieuwste eerst, met naam');
    const nw = d.pending.find((x) => x.kind === 'new'), del = d.pending.find((x) => x.kind === 'delete');
    eq([nw.current.confirmed, nw.who.submissions, nw.nearby[0].name], [false, 2, 'Zebra Ride'], 'met huidige plek, wie en omgeving');
    eq((await call('POST', `admin/review/${del.id}`, { token: adm, body: { action: 'reject' } })).status, 200, 'verwijderen afgewezen');
    eq(count('user_locations'), 1, 'plek blijft');
    eq((await call('POST', `admin/review/${nw.id}`, { token: adm, body: { action: 'approve' } })).status, 200, 'nieuw akkoord');
    eq(env.DB.raw.prepare('SELECT confirmed FROM user_locations').get().confirmed, 1, 'bevestigd');
    eq((await call('POST', `admin/review/${nw.id}`, { token: adm, body: { action: 'approve' } })).status, 409, 'niet twee keer');
    // Vervangen na akkoord, ook door de oorspronkelijke inzender (de plek is nu bevestigd).
    eq((await call('PUT', 'locations/dlp-studios/S1', { token: tokA, body: { lat: 48.8687, lng: 2.7803, accuracy: 6, replace: true } })).data.pending, true, 'bevestigde plek: ook eigen voorstel wacht');
    const rep = (await call('GET', 'admin/review', { token: adm })).data.pending[0];
    eq([rep.kind, rep.dist > 0, rep.prev.lat], ['replace', true, 48.8686], 'voorstel met afstand en vorige plek');
    await call('POST', `admin/review/${rep.id}`, { token: adm, body: { action: 'approve' } });
    eq(env.DB.raw.prepare('SELECT lat, confirmed FROM user_locations').get(), { lat: 48.8687, confirmed: 1 }, 'vervangen en bevestigd');
    const s1 = (await call('GET', 'parks/dlp-studios/entities')).data.entities.find((e) => e.id === 'S1');
    eq(s1.locationConfirmed, true, 'app ziet bevestigd');
    // Nieuwe plek afwijzen = weer weg.
    await call('PUT', 'locations/dlp-disneyland/S1', { token: tokB, body: { lat: 48.8722, lng: 2.7758, accuracy: 7 } });
    const nw2 = (await call('GET', 'admin/review', { token: adm })).data.pending.find((x) => x.parkId === 'dlp-disneyland');
    await call('POST', `admin/review/${nw2.id}`, { token: adm, body: { action: 'reject' } });
    eq(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM user_locations WHERE park_id = 'dlp-disneyland'").get().n, 0, 'afgewezen nieuwe plek weg');
    eq((await call('GET', 'admin/review', { token: adm })).data.recent.length, 4, 'laatst beslist');
  });
  await test('beheer: pushberichten aanmelden, test, nieuwe inzending en nieuwe versie', async () => {
    let d = (await call('GET', 'admin/push', { token: adm })).data;
    eq([typeof d.publicKey, d.publicKey.length > 80, d.subs.length], ['string', true, 0], 'sleutel gemaakt, nog geen toestel');
    // Een echt P-256-sleutelpaar voor het "toestel", zodat het versleutelen echt draait.
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const raw = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
    const sub = { endpoint: 'https://push.test/abc', keys: { p256dh: raw, auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') } };
    eq((await call('POST', 'admin/push', { token: adm, body: { action: 'subscribe', label: 'iPhone · beginscherm-app', sub } })).data.subs.length, 1, 'aangemeld');
    fake.push = [];
    d = (await call('POST', 'admin/push', { token: adm, body: { action: 'test' } })).data;
    eq([d.ok, fake.push.length, /^vapid t=.+, k=/.test(fake.push[0].auth), fake.push[0].enc], [true, 1, true, 'aes128gcm'], 'test verstuurd');
    await call('PUT', 'locations/dlp-disneyland/S1', { token: tokB, body: { lat: 48.8722, lng: 2.7758, accuracy: 7 } });
    eq(fake.push.length, 2, 'bericht bij nieuwe inzending');
    env.DB.raw.prepare("INSERT INTO app_settings (key, value) VALUES ('notified_version', '0.0.1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
    await cron();
    eq(fake.push.length, 3, 'bericht bij nieuwe versie');
    await cron();
    eq(fake.push.length, 3, 'maar één keer');
    fake.pushGone = true;
    await call('POST', 'admin/push', { token: adm, body: { action: 'test' } });
    eq(count('admin_push_subs'), 0, 'verdwenen abonnement opgeruimd');
    fake.pushGone = false;
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
