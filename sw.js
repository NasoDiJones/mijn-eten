// Mijn Eten service worker
// - Netwerk eerst (max ~3 s) voor pagina en app-bestanden: updates direct zichtbaar als je online bent.
// - Cache eerst voor iconen en de (grote) barcode-bibliotheek.
// - Offline: alles komt uit de cache. Externe verzoeken (Supabase, Open Food Facts) worden nooit gecachet.
const CACHE = 'mijn-eten-v3';
const PREFIX = 'mijn-eten-';
const NETWORK_TIMEOUT_MS = 3000;
const CORE = ['./', './app.js', './sync.js', './styles.css', './manifest.webmanifest', './vendor/supabase.js'];
const STATIC = ['./vendor/zxing.min.js', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll([...CORE, ...STATIC].map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Alleen eigen oude caches opruimen (Mijn Geld draait op hetzelfde domein!)
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

// Safari weigert 'redirected' responses voor navigaties; maak er een schone kopie van.
async function clean(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  const network = fetch(request.mode === 'navigate' ? request.url : request, { cache: 'no-cache', credentials: 'same-origin' })
    .then(async res => {
      if (res && res.ok) { const copy = await clean(res.clone()); await cache.put(cacheKey, copy.clone()); return copy; }
      return res;
    });
  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    return cached || await network;
  } catch (e) {
    const cached = await cache.match(cacheKey, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // supabase.co, openfoodfacts.org: nooit cachen
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  if (req.mode === 'navigate' || path === '' || path === 'index.html') {
    event.respondWith(networkFirst(req, new URL('./', scope).href));
  } else if (path.startsWith('icons/') || path === 'vendor/zxing.min.js') {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(req, url.origin + url.pathname));
  }
});
