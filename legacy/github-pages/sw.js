// Replaces the old app's service worker at this address. Without it, phones that installed
// the app here would keep serving their cached copy forever, and never see the "moved" page.
// When the browser next checks for an update it installs this worker, which deletes the old
// caches, unregisters itself and reloads open pages, so they load the "moved" page instead.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      await Promise.all(clients.map((client) => client.navigate(client.url)));
    })(),
  );
});
