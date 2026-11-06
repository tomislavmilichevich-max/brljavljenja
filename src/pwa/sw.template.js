/* Service worker — predložak. Build (vite-plugins/service-worker.ts) umeće popis
 * datoteka i ID builda umjesto rezerviranih oznaka u kodu ispod i zapisuje rezultat
 * kao dist/sw.js. Oznake se smiju pojaviti točno jednom (provjerava plugin).
 *
 * Opseg P0: samo predmemoriranje statičke ljuske aplikacije (app shell).
 * NE dira Firestore/Google API zahtjeve (druge domene i ne-GET zahtjevi prolaze
 * mrežom); podatke inventara u kasnijim fazama drži Firestore persistence + IndexedDB.
 */
const PRECACHE_URLS = __PRECACHE_URLS__;
// Poslužitelji šalju `Vary: Origin`, a <script type=module crossorigin> šalje Origin;
// bez ignoreVary predmemorirani odgovor se ne bi podudarao i offline bi pao.
const MATCH_OPTIONS = { ignoreVary: true };
const CACHE_NAME = 'inventory-shell-' + __BUILD_ID__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('inventory-shell-') && n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// Nova verzija čeka dok aplikacija ne zatraži aktivaciju (nema prisilnog osvježavanja usred rada).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // SPA: offline se uvijek vraća predmemorirani index.html.
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/index.html', MATCH_OPTIONS).then((r) => r || Response.error()),
      ),
    );
    return;
  }

  event.respondWith(caches.match(req, MATCH_OPTIONS).then((cached) => cached || fetch(req)));
});
