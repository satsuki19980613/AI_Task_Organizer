/* ═══════════════════════════════════════════════════════════
   Service Worker — Task Organizer
   - App shell: cache-first
   - /api/tasks GET: network-first with cache fallback
   - Other API GET: network-first with cache fallback
   - Cross-origin (CDN): network only, fail silently
═══════════════════════════════════════════════════════════ */

const CACHE = 'task-organizer-v29';

const PRECACHE = [
  '/',
  '/static/css/style.css',
  '/static/js/main.js',
  '/static/manifest.json',
  '/static/icons/icon.svg',
];

// ── Install ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Cross-origin (CDN fonts / Chart.js): network only
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(request).catch(() => new Response('', { status: 408 }))
    );
    return;
  }

  // /api/tasks GET: network-first, cache on success
  if (url.pathname === '/api/tasks' && request.method === 'GET') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(c =>
            c || new Response('[]', {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
    );
    return;
  }

  // Other API calls: network only, offline = 503 JSON
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // App shell (same-origin): cache-first, update in background
  e.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
        return res;
      });
      return cached || networkFetch.catch(() => caches.match('/'));
    })
  );
});
