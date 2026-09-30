// Service worker: primero la red (así siempre se ve la última versión) y, si no hay conexión, lo último guardado.
const CACHE = 'fmon-shell';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(r, c)); }
      return res;
    }).catch(() => caches.match(r).then(m => m || caches.match('./')))
  );
});
