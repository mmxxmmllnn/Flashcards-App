/*
Purpose: Cache core assets for offline use.
Strategy: "Cache, falling back to network" for GET; versioned cache for updates.
*/
const CACHE = 'Flashcards-App.v0.1.1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './scheduler.js',
  './manifest.webmanifest',
  'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE ? caches.delete(k) : null)))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      // Optionally cache new GETs (runtime)
      return res;
    }).catch(() => cached))
  );
});


