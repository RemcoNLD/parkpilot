// Service worker van de beheer-app (admin.html) van ParkPilot: toont de pushberichten van de Worker.
// Geregistreerd met scope "/admin", dus hij raakt de gewone app (sw.js, scope "/") niet.
// Geen fetch-afhandeling: niets wordt bewaard of onderschept. Zelfde opzet als EVailability (repo RemcoNLD/apps).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { body: event.data ? event.data.text() : "" }; }
  const title = d.title || "ParkPilot";
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || "",
      tag: d.tag || undefined,
      icon: "/admin-icon-192.png",
      badge: "/admin-icon-192.png",
      data: { url: d.url || "admin.html", at: d.at || null },
    });
    if (typeof d.badge === "number") { try { await self.navigator.setAppBadge?.(d.badge); } catch (_) {} }
    // Een open beheer-app ververst meteen.
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    open.forEach((c) => c.postMessage({ type: "push", title, body: d.body || "" }));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "admin.html", self.location.origin + "/").href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = open.find((c) => new URL(c.url).pathname.startsWith("/admin"));
    if (page) { await page.focus(); page.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});
