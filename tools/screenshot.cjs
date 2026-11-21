// Screenshot van de app met nepdata (geen netwerk nodig). Gebruik: [PP_LANG=en-US] bash tools/screenshot.sh [dark|light] [settings|history|main|lang|queue|game]
// Opent nu het instellingenscherm; pas de stappen onderaan aan voor andere schermen.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ROOT = process.env.PP_SHOT_ROOT || '/tmp/ppshot';
const now = Date.now();
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
  '/api/parks/dlp-studios/schedule': { today: [], days: [] },
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
};
(async () => {
  const theme = process.argv[2] || 'dark';
  const scenario = process.argv[3] || 'settings';
  let offlineHistory = false;
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const locale = process.env.PP_LANG || 'nl-NL'; // taal van de 'telefoon', bijv. en-US of de-DE (valt terug op Engels)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, locale });
  const page = await ctx.newPage();
  await page.route('http://pp.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
      if (offlineHistory && u.pathname.includes('/history/')) return route.abort('internetdisconnected');
      const body = api[u.pathname];
      return route.fulfill({ status: body ? 200 : 404, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'nf' }) });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'index.html' : u.pathname);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ path: f });
    return route.fulfill({ status: 404, body: '' });
  });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://pp.test/');
  await page.waitForTimeout(1200);
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
    await page.click('.top-actions .icon-btn:last-child'); await page.waitForTimeout(300);
    await page.click('.set-sec:nth-of-type(1) .set-item:nth-of-type(3) .segments button:nth-of-type(3)'); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/lang-${locale}-picked-en.png` });
    await page.reload(); await page.waitForTimeout(1200);
    console.log('na herladen:', await page.evaluate(() => document.documentElement.lang + ' / ' + document.querySelector('.segments button').textContent));
    await page.click('.top-actions .icon-btn:last-child'); await page.waitForTimeout(300);
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
  await page.click('.top-actions .icon-btn:last-child');
  await page.waitForTimeout(300);
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
