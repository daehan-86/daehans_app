const CACHE_PREFIX = 'pr-plus-';
const LEGACY_AUTO_UPDATE_CACHE = 'pr-plus-v0.1.0';
const RELEASE_ID = '0.2.0-r1';
const CACHE = `pr-plus-${RELEASE_ID}`;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './data.mjs', './progression.mjs', './version.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(async () => {
    const keys = await caches.keys();
    if (keys.includes(LEGACY_AUTO_UPDATE_CACHE)) await self.skipWaiting();
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => new Response(null, { status: 503, statusText: 'Offline' })));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match('./index.html')))
  );
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
