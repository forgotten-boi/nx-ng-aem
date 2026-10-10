/**
 * Service worker: keeps the app usable without signal on the hill.
 * - App files: network first (so updates arrive), falling back to the cache when offline or slow.
 * - Map tiles: cache first; every tile you have viewed stays available offline (oldest dropped past a cap).
 * Bump VERSION whenever an app file changes.
 */
const VERSION = '2';
const APP_CACHE = `edale-kinder-app-v${VERSION}`;
const TILE_CACHE = 'edale-kinder-tiles-v1';
const MAX_TILES = 2500;
const NETWORK_TIMEOUT_MS = 2500;
const TILE_HOST = /(^|\.)tile\.(opentopomap|openstreetmap)\.org$/;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'data/route.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/main.js',
  'js/geo.js',
  'js/route.js',
  'js/tracker.js',
  'js/simulator.js',
  'js/map.js',
  'js/profile.js',
  'js/gpx.js',
  'js/sun.js',
  'js/format.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('edale-kinder-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (TILE_HOST.test(url.hostname)) event.respondWith(tile(request));
  else if (url.origin === self.location.origin) event.respondWith(appFile(request));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function appFile(request) {
  const cache = await caches.open(APP_CACHE);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  try {
    return await withTimeout(network, NETWORK_TIMEOUT_MS);
  } catch {
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ?? (request.mode === 'navigate' ? await cache.match('index.html') : null);
    if (cached) return cached;
    return network; // nothing cached: keep waiting for the network after all
  }
}

let tilesSinceTrim = 0;

async function tile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request.url);
  if (cached) return cached;
  try {
    let response;
    try {
      // CORS responses can be stored without the large quota padding of opaque ones.
      response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    } catch {
      return await fetch(request);
    }
    if (response.ok) {
      await cache.put(request.url, response.clone());
      if (++tilesSinceTrim >= 50) {
        tilesSinceTrim = 0;
        trimTiles(cache);
      }
    }
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}
