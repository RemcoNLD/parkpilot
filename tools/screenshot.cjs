// Screenshot van de app met nepdata (geen netwerk nodig). Gebruik: [PP_LANG=en-US] bash tools/screenshot.sh [dark|light] [settings|history|main|lang|queue|game|tour|help]
// Opent nu het instellingenscherm; pas de stappen onderaan aan voor andere schermen.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ROOT = process.env.PP_SHOT_ROOT || '/tmp/ppshot';
// Rijke nepdata (meer attracties, favorieten, klok op 14:10 Parijse tijd) voor de schermafbeeldingen in de rondleiding.
const RICH = process.env.PP_RICH === '1' || process.argv[3] === 'tourshots';
function parisAt(hhmm) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName').value; // "GMT+1"
  const m = /GMT([+-]\d+)?/.exec(off); const h = m && m[1] ? Number(m[1]) : 0;
  const [Y, M, D] = d.split('-').map(Number); const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(Y, M - 1, D, hh - h, mm);
}
const now = RICH ? parisAt('14:10') : Date.now();
const OUT = process.env.PP_SHOT_OUT || '/tmp/ppshot/shots';
fs.mkdirSync(OUT, { recursive: true });
const api = {
  '/api/parks': [{ id: 'dlp-disneyland', name: 'Disneyland Park', shortName: 'Disneyland Park', timezone: 'Europe/Paris', center: { lat: 48.872, lng: 2.776 }, available: true }, { id: 'dlp-studios', name: 'Disney Adventure World', shortName: 'Adventure World', timezone: 'Europe/Paris', center: { lat: 48.868, lng: 2.78 }, available: true }],
  '/api/parks/dlp-studios/entities': { parkId: 'dlp-studios', generatedAt: new Date().toISOString(), entities: [
    { id: 'A1', type: 'attraction', name: 'Crush\'s Coaster', location: { lat: 48.867, lng: 2.779 }, locationSource: 'source' },
    { id: 'S1', type: 'show', name: 'Disney Tales of Magic', location: null, locationSource: null } ] },
  '/api/parks/dlp-studios/live': { parkId: 'dlp-studios', generatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), live: [
    { id: 'A1', status: 'open', waitMinutes: 35, showtimes: [], updatedAt: new Date().toISOString(), singleRider: true, singleRiderWait: 15, changedAt: null, changeObserved: false, prevWaitMinutes: null },
    { id: 'S1', status: 'open', waitMinutes: null, showtimes: [{ start: new Date(now + 3600e3).toISOString(), end: null }], updatedAt: null, singleRider: false, changedAt: null, changeObserved: false, prevWaitMinutes: null } ] },
  '/api/favorites': [],
  '/api/preferences/dlp-studios': { sort: 'wait', arrivalMarginMin: 15, walkingSpeedKmh: 4.5 },
  // PP_HOURS=none: openingstijden onbekend; closed: park al dicht (sluiting 1 uur geleden); anders open (nu-5u tot nu+4u).
  '/api/parks/dlp-studios/schedule': process.env.PP_HOURS === 'none' ? { today: [], days: [] } : { today: [process.env.PP_HOURS === 'closed'
    ? { type: 'OPERATING', opens: new Date(now - 9 * 3600e3).toISOString(), closes: new Date(now - 3600e3).toISOString() }
    : { type: 'OPERATING', opens: new Date(now - 5 * 3600e3).toISOString(), closes: new Date(now + 4 * 3600e3).toISOString() }], days: [] },
  '/api/profile': { deviceId: '00000000-0000-0000-0000-000000000000', token: 'a'.repeat(64) },
  '/api/settings/tracking': { mode: 'park-hours', active: { 'dlp-studios': true } },
  '/api/health': { ok: true, version: 'x' },
  '/api/game/balloon/scores': { game: 'balloon', rank: 3, best: 4, top: [
    { name: 'Ana', score: 23, at: new Date(now - 3600e3).toISOString() }, { name: 'Pieter-Jan van den Berg', score: 11, at: new Date(now - 7200e3).toISOString() },
    { name: 'Remco', score: 4, at: new Date(now).toISOString() } ] },
  '/api/parks/dlp-studios/history/A1': { entityId: 'A1', from: new Date(now - 4 * 3600e3).toISOString(), rows: [
    { at: new Date(now - 4 * 3600e3).toISOString(), wait: 15, status: 'open' }, { at: new Date(now - 3 * 3600e3).toISOString(), wait: 30, status: 'open' },
    { at: new Date(now - 2 * 3600e3).toISOString(), wait: 50, status: 'open' }, { at: new Date(now - 3600e3).toISOString(), wait: 40, status: 'open' },
    { at: new Date(now - 20 * 60e3).toISOString(), wait: 35, status: 'open' } ] },
  // Stippellijn: zelfde weekdag in de vorige weken (tijden al op vandaag gezet).
  '/api/parks/dlp-studios/history/A1?ref': { entityId: 'A1', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()), dates: ['x', 'y', 'z'], rows: [
    { at: new Date(now - 5 * 3600e3).toISOString(), wait: null }, { at: new Date(now - 4 * 3600e3).toISOString(), wait: 25 },
    { at: new Date(now - 170 * 60e3).toISOString(), wait: 45 }, { at: new Date(now - 100 * 60e3).toISOString(), wait: 60 },
    { at: new Date(now - 40 * 60e3).toISOString(), wait: 40 }, { at: new Date(now + 3600e3).toISOString(), wait: 30 },
    { at: new Date(now + 2 * 3600e3).toISOString(), wait: 20 }, { at: new Date(now + 3.5 * 3600e3).toISOString(), wait: 10 }, { at: new Date(now + 4 * 3600e3).toISOString(), wait: null } ] },
  '/api/profile/recovery-code': { code: 'K7QX-M4TR-2HWN' },
  '/api/profile/redeem': { deviceId: '00000000-0000-0000-0000-000000000000', token: 'b'.repeat(64), favoriteCount: 2 },
};
if (RICH) {
  const t = (hhmm) => new Date(parisAt(hhmm)).toISOString();
  const ago = (min) => new Date(now - min * 60e3).toISOString();
  const E = (id, name, lat, lng, type = 'attraction') => ({ id, type, name, location: lat ? { lat, lng } : null, locationSource: lat ? 'source' : null });
  const L = (id, status, wait, extra = {}) => ({ id, status, waitMinutes: wait, showtimes: [], updatedAt: ago(2), singleRider: false, changedAt: ago(25), changeObserved: true, prevWaitMinutes: wait, ...extra });
  Object.assign(api, {
    '/api/parks/dlp-studios/entities': { parkId: 'dlp-studios', generatedAt: new Date(now).toISOString(), entities: [
      E('A1', "Crush's Coaster", 48.8669, 2.7787), E('A2', 'Avengers Assemble: Flight Force', 48.8688, 2.7805), E('A3', 'Spider-Man W.E.B. Adventure', 48.8690, 2.7810),
      E('A4', "Ratatouille : L'Aventure Totalement Toquée de Rémy", 48.8672, 2.7770), E('A5', 'The Twilight Zone Tower of Terror', 48.8665, 2.7800),
      E('A6', 'Frozen Ever After', 48.8680, 2.7760), E('A7', 'Cars ROAD TRIP', 48.8662, 2.7782), E('A8', 'Toy Soldiers Parachute Drop', 48.8660, 2.7790),
      E('A9', 'RC Racer', 48.8658, 2.7795), E('S2', 'TOGETHER: a Pixar Musical Adventure', 48.8683, 2.7790, 'show') ] },
    '/api/parks/dlp-studios/live': { parkId: 'dlp-studios', generatedAt: new Date(now).toISOString(), sourceUpdatedAt: ago(2), live: [
      L('A1', 'open', 35, { singleRider: true, singleRiderWait: 15, prevWaitMinutes: 50 }), L('A2', 'open', 50, { singleRider: true, singleRiderWait: 30, prevWaitMinutes: 40 }),
      L('A3', 'open', 25), L('A4', 'open', 45, { singleRider: true, singleRiderWait: 20 }), L('A5', 'open', 20, { prevWaitMinutes: 30 }), L('A6', 'open', 70),
      L('A7', 'open', 5, { updatedAt: ago(180), changedAt: ago(210) }), L('A8', 'down', null, { changedAt: ago(40) }), L('A9', 'closed', null, { updatedAt: ago(76 * 1440) }), // langdurig dicht: hoort onder Onderhoud (0.21.0)
      { id: 'S2', status: 'open', waitMinutes: null, showtimes: [{ start: t('15:00'), end: null }, { start: t('17:30'), end: null }], updatedAt: ago(2), singleRider: false, changedAt: null, changeObserved: false, prevWaitMinutes: null } ] },
    '/api/favorites': [['A1', 'attraction'], ['A2', 'attraction'], ['A5', 'attraction'], ['A7', 'attraction'], ['S2', 'show']].map(([entityId, type]) => ({ parkId: 'dlp-studios', entityId, type })),
    '/api/parks/dlp-studios/schedule': { today: [{ type: 'OPERATING', opens: t('09:30'), closes: t('21:00') }], days: [] },
    '/api/parks/dlp-studios/history/A1': { entityId: 'A1', from: t('00:00'), rows: [
      ['09:00', null, 'closed'], ['09:35', 10], ['10:05', 20], ['10:50', 35], ['11:40', 55], ['12:30', 45], ['13:05', 50], ['13:45', 35]].map(([h, w, st]) => ({ at: t(h), wait: w, status: st || 'open' })) },
    '/api/parks/dlp-studios/history/A1?ref': { entityId: 'A1', date: '', dates: ['a', 'b', 'c'], rows: [
      ['00:00', null], ['09:35', 15], ['10:30', 30], ['11:30', 50], ['12:30', 60], ['14:00', 55], ['15:30', 45], ['17:00', 40], ['18:30', 30], ['19:45', 20], ['20:45', 10], ['21:00', null]].map(([h, w]) => ({ at: t(h), wait: w })) },
    '/api/parks/dlp-studios/history/A7': { entityId: 'A7', from: t('00:00'), rows: [
      ['09:00', null, 'closed'], ['09:35', 5], ['10:00', 10], ['10:40', 5], ['11:10', 5, 'stale']].map(([h, w, st]) => ({ at: t(h), wait: w, status: st || 'open' })) },
    '/api/parks/dlp-studios/history/A7?ref': { entityId: 'A7', date: '', dates: ['a', 'b'], rows: [
      ['00:00', null], ['09:35', 5], ['10:30', 15], ['12:00', 20], ['15:00', 15], ['18:00', 10], ['20:30', 5], ['21:00', null]].map(([h, w]) => ({ at: t(h), wait: w })) },
  });
  // Storingen van vandaag (storingspagina, 0.20.0); A8 loopt nog (zie live), Z9 bestaat niet (wordt overgeslagen).
  const inc = (id, a, b, known = true) => ({ entityId: id, start: t(a), end: b ? t(b) : null, startKnown: known });
  api['/api/parks/dlp-studios/incidents'] = { date: '', from: t('00:00'), incidents: [
    inc('A3', '00:00', '09:50', false), inc('A1', '10:12', '10:31'), inc('A6', '11:15', '12:05'), inc('A1', '12:02', '12:20'),
    inc('Z9', '12:30', '12:40'), inc('A8', '13:30', null), inc('A5', '13:41', '13:52') ] };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(now));
  api['/api/parks/dlp-studios/history/A1?ref'].date = today; api['/api/parks/dlp-studios/history/A7?ref'].date = today;
}
(async () => {
  const theme = process.argv[2] || 'dark';
  const scenario = process.argv[3] || 'settings';
  let offlineHistory = false;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const locale = process.env.PP_LANG || 'nl-NL'; // taal van de 'telefoon', bijv. en-US of de-DE (valt terug op Engels)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, locale,
    ...(RICH ? { geolocation: { latitude: 48.8674, longitude: 2.7792 }, permissions: ['geolocation'] } : {}) });
  const page = await ctx.newPage();
  await page.route('http://pp.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      if (offlineHistory && u.pathname.includes('/history/')) return route.abort('internetdisconnected');
      const body = api[u.pathname + (u.searchParams.get('ref') ? '?ref' : '')];
      return route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'nf' }) });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f });
    // Bestanden uit apps/web/public (o.a. de afbeeldingen van de rondleiding)
    const pub = path.join(__dirname, '..', 'apps/web/public', u.pathname);
    if (fs.existsSync(pub) && fs.statSync(pub).isFile()) return route.fulfill({ path: pub });
    return route.fulfill({ status: 404, body: '' });
  });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  // Alle scenario's behalve de rondleiding: rondleiding al gezien, anders staat hij over alles heen.
  if (scenario !== 'tour') await page.addInitScript(() => { try { localStorage.setItem('pp.tour', 'done'); } catch {} });
  if (RICH) {
    await page.addInitScript((t) => { try { localStorage.setItem('pp.gameAsk', 'never'); localStorage.setItem('pp.pos', JSON.stringify({ lat: 48.8674, lng: 2.7792, at: t })); } catch {} }, now);
    await page.clock.install({ time: now });
  }
  // Tandwiel = menu; eerste knop is Instellingen.
  const openSettingsUi = async () => { await page.click('.top-actions .icon-btn:last-child'); await page.waitForTimeout(250); await page.click('.asheet-btn.primary'); await page.waitForTimeout(300); };
  await page.goto('http://pp.test/');
  await page.waitForTimeout(1200);
  if (scenario === 'tourshots') {
    // Uitsneden voor de rondleiding: per stap één PNG; tools/tour-shots.sh zet ze om naar WebP in apps/web/public/tour/.
    const lang = locale.slice(0, 2);
    const shot = async (name, clip) => {
      const c = { x: 0, width: 390, y: Math.max(0, Math.floor(clip.y)), height: Math.min(844 - Math.max(0, Math.floor(clip.y)), Math.ceil(clip.height)) };
      await page.screenshot({ path: `${OUT}/${lang}-${theme}-${name}.png`, clip: c });
    };
    const box = async (sel, pad = 8) => { const b = await page.locator(sel).first().boundingBox(); return { y: b.y - pad, height: b.height + 2 * pad }; };
    const row = (name) => `.rowwrap:has-text("${name}")`;
    const fresh = async (plan) => { await page.reload(); await page.waitForTimeout(1300); if (plan !== null) { await page.click(`.vswitch button:nth-of-type(${plan ? 2 : 1})`); await page.waitForTimeout(500); } };
    await fresh(false);
    await shot('welcome', { y: 0, height: 600 });
    await fresh(true);
    await shot('views', { y: 0, height: 560 });
    await fresh(false);
    await page.locator(row("Crush's Coaster")).locator('.ring-btn').first().click(); await page.waitForTimeout(900);
    await page.locator(row("Crush's Coaster")).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await shot('tap', await box(row("Crush's Coaster"), 6));
    await fresh(true);
    await page.locator(row('Cars ROAD TRIP')).locator('.ptoggle').first().click(); await page.waitForTimeout(900);
    await page.locator(row('Cars ROAD TRIP')).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await shot('stale', await box(row('Cars ROAD TRIP'), 6));
    await fresh(true);
    { const b = await page.locator(row('Avengers')).locator('.prow').first().boundingBox();
      await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2); await page.mouse.down();
      for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + b.width * 0.7 - i * 16, b.y + b.height / 2); await page.waitForTimeout(16); }
      await page.mouse.up(); await page.waitForTimeout(500);
      const sh = await page.locator('.asheet').first().boundingBox();
      const top = Math.min(b.y, sh.y) - 12;
      await shot('swipe', { y: top, height: 844 - top }); }
    await fresh(true);
    { const b = await page.locator(row('Tower of Terror')).locator('.pmain').first().boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(400);
      await page.click('.asheet-btn.primary'); await page.waitForTimeout(2300);
      const q = await page.locator('.qbar').boundingBox();
      await shot('hold', { y: q.y - 300, height: 844 - (q.y - 300) }); }
    await page.evaluate(() => localStorage.removeItem('pp.queue'));
    await fresh(false);
    await shot('tiles', await box('.stats', 10));
    await page.click('.top-actions .icon-btn:last-child'); await page.waitForTimeout(400);
    { const s = await page.locator('.asheet').first().boundingBox(); await shot('menu', { y: s.y - 20, height: 844 - s.y + 20 }); }
    await browser.close();
    return;
  }
  if (scenario === 'history') {
    // 1) verloop ophalen (wordt bewaard), 2) herladen zonder bereik voor de historie: grijs uit de cache.
    await page.click('.ring-btn'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/history-${theme}-online.png` });
    offlineHistory = true;
    await page.reload(); await page.waitForTimeout(1200);
    await page.click('.ring-btn'); await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/history-${theme}-offline.png` });
    offlineHistory = false; // 3) weer bereik: bij de volgende verversing wordt het verloop weer actueel
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT}/history-${theme}-back.png` });
    await browser.close();
    return;
  }
  if (scenario === 'lang') {
    // Taalschakelaar: kies EN in instellingen, herlaad (keuze onthouden), zet terug op Auto.
    await openSettingsUi();
    await page.click('.set-sec:nth-of-type(1) .set-item:nth-of-type(3) .segments button:nth-of-type(3)'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/lang-${locale}-picked-en.png` });
    await page.reload(); await page.waitForTimeout(1200);
    console.log('na herladen:', await page.evaluate(() => document.documentElement.lang + ' / ' + document.querySelector('.segments button').textContent));
    await openSettingsUi();
    await page.click('.set-sec:nth-of-type(1) .set-item:nth-of-type(3) .segments button:nth-of-type(1)'); await page.waitForTimeout(300);
    console.log('na Auto:', await page.evaluate(() => document.documentElement.lang + ' / ' + localStorage.getItem('pp.lang')));
    await browser.close();
    return;
  }
  if (scenario === 'game') {
    // Inchecken → vraag om te spelen → naam → potje → einde met hiscores.
    const longPress = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(300); };
    await longPress('.row .row-name');
    await page.click('.asheet-btn.primary'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/game-${theme}-${locale}-1-ask.png` });
    await page.click('.asheet-btn.primary'); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/game-${theme}-${locale}-2-name.png` });
    await page.fill('.game-input', 'Remco'); await page.click('.game-btn.small'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/game-${theme}-${locale}-3-menu.png` });
    await page.click('.game-card .game-btn'); 
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(330); await page.mouse.click(195, 400); }
    await page.screenshot({ path: `${OUT}/game-${theme}-${locale}-4-play.png` });
    await page.waitForSelector('.game-card', { timeout: 15000 }); await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/game-${theme}-${locale}-5-over.png` });
    console.log('localStorage', await page.evaluate(() => JSON.stringify({ name: localStorage.getItem('pp.gameName'), best: localStorage.getItem('pp.gameBest'), pending: localStorage.getItem('pp.gamePending') })));
    await browser.close();
    return;
  }
  if (scenario === 'queue') {
    // Inchecken: lang drukken op de attractie, rij kiezen, tijd loopt, over de verwachting, aan de beurt, eruit, detailvenster.
    const longPress = async (sel) => { const b = await page.locator(sel).first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up(); await page.waitForTimeout(300); };
    await longPress('.row .row-name');
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-1-choose.png` });
    await page.click('.asheet-btn.primary'); await page.waitForTimeout(2300);
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-2-running.png` });
    await page.evaluate(() => { const q = JSON.parse(localStorage.getItem('pp.queue')); q.start = Date.now() - 41 * 60e3 - 12e3; localStorage.setItem('pp.queue', JSON.stringify(q)); });
    await page.reload(); await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-3-over.png` });
    await page.click('.qbar-btn'); await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-4-turn.png` });
    await page.evaluate(() => { const q = JSON.parse(localStorage.getItem('pp.queue')); q.turnAt = Date.now() - 4 * 60e3; localStorage.setItem('pp.queue', JSON.stringify(q)); });
    await page.reload(); await page.waitForTimeout(1500);
    await page.click('.qbar-btn'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-5-result.png` });
    await page.click('.asheet-btn.cancel'); await page.waitForTimeout(300);
    await page.click('.row-open'); await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.drawer').scrollTo(0, 99999)); await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/queue-${theme}-${locale}-6-detail.png` });
    await browser.close();
    return;
  }
  if (scenario === 'tour') {
    // Nieuwe gebruiker: alle stappen; bij de koppelcode elke keuze; afsluiten en herladen (moet wegblijven).
    const n = await page.locator('.tour-dots span').count();
    console.log('rondleiding zichtbaar:', await page.locator('.tour').count() === 1, 'stappen:', n);
    for (let i = 1; i <= n; i++) {
      await page.screenshot({ path: `${OUT}/tour-${theme}-${locale}-${i}.png` });
      if (await page.locator('.tour-choice').count()) {
        for (const [k, label] of [[1, 'have'], [2, 'strong'], [3, 'own'], [4, 'later']]) {
          await page.click(`.tour-choice:nth-of-type(${k})`); await page.waitForTimeout(300);
          if (label === 'have') { await page.fill('.tour-code-panel .input', 'abcd1234'); await page.click('.tour-code-panel .btn'); await page.waitForTimeout(400); }
          if (label === 'own') { await page.fill('.tour-code-panel .input', 'ab'); await page.click('.tour-code-panel .btn'); await page.waitForTimeout(200); }
          await page.screenshot({ path: `${OUT}/tour-${theme}-${locale}-${i}-${label}.png` });
        }
      }
      if (i < n) { await page.click('.tour-nav .btn:last-child'); await page.waitForTimeout(250); }
    }
    await page.click('.tour-nav .btn:last-child'); await page.waitForTimeout(300);
    await page.reload(); await page.waitForTimeout(1200);
    console.log('na herladen nog rondleiding:', await page.locator('.tour').count(), 'pp.tour =', await page.evaluate(() => localStorage.getItem('pp.tour')));
    await browser.close();
    return;
  }
  if (scenario === 'help') {
    await page.click('.top-actions .icon-btn:last-child'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/help-${theme}-${locale}-1-menu.png` });
    await page.click('.asheet-btn.primary:nth-of-type(2)'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/help-${theme}-${locale}-2-help.png` });
    await page.click('.help-topic:nth-of-type(3) summary'); await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/help-${theme}-${locale}-3-topic.png` });
    await page.click('.help-topic:last-of-type summary'); await page.waitForTimeout(200);
    await page.click('.help-topic:last-of-type .btn'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/help-${theme}-${locale}-4-code.png` });
    await page.mouse.click(30, 30).catch(() => {});
    await page.evaluate(() => document.querySelector('.sheet')?.remove());
    await page.click('.vswitch button:nth-of-type(2)'); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/help-${theme}-${locale}-5-plan-head.png` });
    await browser.close();
    return;
  }
  if (scenario === 'issues') {
    if (await page.$('.stat.issues') === null) { await page.click('.vswitch button:nth-of-type(1)'); await page.waitForTimeout(500); }
    await page.click('.stat.issues'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/issues-${theme}-${locale}.png` });
    await page.evaluate(() => document.querySelector('.sheet').scrollTo(0, 420));
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/issues-${theme}-${locale}-2.png` });
    await browser.close();
    return;
  }
  if (scenario === 'main') {
    await page.screenshot({ path: `${OUT}/main-${theme}-${locale}.png` });
    await page.click('.ring-btn'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/main-${theme}-${locale}-open.png` });
    await page.click('.row-open'); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/detail-${theme}-${locale}.png` });
    await page.mouse.click(195, 40); await page.waitForTimeout(300);
    await page.click('.vswitch button:nth-of-type(2)'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/plan-${theme}-${locale}.png` });
    await browser.close();
    return;
  }
  await openSettingsUi();
  await page.screenshot({ path: `${OUT}/settings-${theme}-${locale}.png` });
  await page.click('.set-sec:nth-of-type(3) .info-btn');
  await page.click('.set-sec:nth-of-type(4) summary').catch(()=>{});
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/settings-${theme}-${locale}-full.png`, fullPage: false });
  const h = await page.evaluate(() => document.querySelector('.sheet').scrollHeight);
  console.log('sheet height', h);
  await page.evaluate(() => document.querySelector('.sheet').scrollTo(0, 99999));
  await page.screenshot({ path: `${OUT}/settings-${theme}-${locale}-bottom.png` });
  await browser.close();
})();
