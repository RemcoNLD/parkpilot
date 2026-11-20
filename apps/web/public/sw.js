/* ParkPilot service worker: houdt de app zelf (HTML, scripts, stijl, iconen) beschikbaar zonder verbinding.
 * Gegevens uit de API (/api/*) worden hier bewust NIET bewaard; die staan in de app zelf met een duidelijke leeftijd. */
const CACHE = 'parkpilot-shell';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok) { cache.put('/', response.clone()); }
    return response;
  } catch {
    return (await cache.match('/')) || (await cache.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => null);
  return cached || (await fresh) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : staleWhileRevalidate(request));
});
