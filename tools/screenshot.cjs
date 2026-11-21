// Screenshot van de app met nepdata (geen netwerk nodig). Gebruik: bash tools/screenshot.sh [dark|light]
// Opent nu het instellingenscherm; pas de stappen onderaan aan voor andere schermen.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ROOT = process.env.PP_SHOT_ROOT || '/tmp/ppshot';
const now = Date.now();
const OUT = process.env.PP_SHOT_OUT || '/tmp/ppshot/shots';
fs.mkdirSync(OUT, { recursive: true });
const api = {
  '/api/parks': [{ id: 'dlp-studios', name: 'Disney Adventure World', shortName: 'Adventure World', timezone: 'Europe/Paris', center: { lat: 48.868, lng: 2.78 }, available: true }],
  '/api/parks/dlp-studios/entities': { parkId: 'dlp-studios', generatedAt: new Date().toISOString(), entities: [
    { id: 'A1', type: 'attraction', name: 'Crush\'s Coaster', location: { lat: 48.867, lng: 2.779 }, locationSource: 'source' },
    { id: 'S1', type: 'show', name: 'Disney Tales of Magic', location: null, locationSource: null } ] },
  '/api/parks/dlp-studios/live': { parkId: 'dlp-studios', generatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), live: [
    { id: 'A1', status: 'open', waitMinutes: 35, showtimes: [], updatedAt: new Date().toISOString(), singleRider: false, changedAt: null, changeObserved: false, prevWaitMinutes: null },
    { id: 'S1', status: 'open', waitMinutes: null, showtimes: [{ start: new Date(now + 3600e3).toISOString(), end: null }], updatedAt: null, singleRider: false, changedAt: null, changeObserved: false, prevWaitMinutes: null } ] },
  '/api/favorites': [],
  '/api/preferences/dlp-studios': { sort: 'wait', arrivalMarginMin: 15, walkingSpeedKmh: 4.5 },
  '/api/parks/dlp-studios/schedule': { today: [], days: [] },
  '/api/profile': { deviceId: '00000000-0000-0000-0000-000000000000', token: 'a'.repeat(64) },
  '/api/settings/tracking': { mode: 'park-hours', active: { 'dlp-studios': true } },
  '/api/health': { ok: true, version: 'x' },
};
(async () => {
  const theme = process.argv[2] || 'dark';
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  await page.route('http://pp.test/**', (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api/')) {
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
  await page.click('button[aria-label="Instellingen"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/settings-${theme}.png` });
  await page.click('button[aria-label="Uitleg Geschiedenis"]');
  await page.click('.set-sec:nth-of-type(4) summary').catch(()=>{});
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/settings-${theme}-full.png`, fullPage: false });
  const h = await page.evaluate(() => document.querySelector('.sheet').scrollHeight);
  console.log('sheet height', h);
  await page.evaluate(() => document.querySelector('.sheet').scrollTo(0, 99999));
  await page.screenshot({ path: `${OUT}/settings-${theme}-bottom.png` });
  await browser.close();
})();
