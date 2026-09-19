// SamDlight OS — service worker
// Purpose: make the app itself load with no internet, so a business owner
// can open SamDlight OS offline and keep recording sales/expenses (those
// writes queue in localStorage via queueOfflineWrite() and sync when the
// connection returns).
//
// Strategy:
//   - App shell (HTML/icons/CDN libs): cache-first, so the app opens
//     instantly and works with no network at all.
//   - Supabase API calls: never cached — always go to the network. Stale
//     business data would be worse than no data, and the app already has
//     its own offline queue for writes.

const CACHE = 'samdlight-os-v2';
const SHELL = [
  '/app.html',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually cached so one failed URL doesn't abort the whole install.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache Supabase (auth, database, storage, edge functions) — always
  // hit the network so business data is never silently stale.
  if (url.hostname.endsWith('.supabase.co')) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // Refresh the cached copy in the background for next time.
        fetch(req).then(res => {
          if (res && res.status === 200) {
            caches.open(CACHE).then(c => c.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(res => {
        if (res && res.status === 200 && (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline with nothing cached — fall back to the app shell for
        // page navigations so the user sees the app, not a browser error.
        if (req.mode === 'navigate') return caches.match('/app.html');
      });
    })
  );
});