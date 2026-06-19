/*
 * Service worker — Hypotekárna kalkulačka (Legal Engineering, s. r. o.)
 * Stratégia: cache-first. Všetky assety sa cachujú pri inštalácii,
 * aplikácia funguje plne offline.
 *
 * Pri zmene ktoréhokoľvek assetu zvýš CACHE_VERSION — staré cache sa
 * vymažú v 'activate' fáze.
 */
'use strict';

const CACHE_VERSION = 'hypokalkulacka-v2';

// Všetky assety potrebné na offline beh. Relatívne cesty voči scope ('./').
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './fonts/fonts.css',
  './fonts/fraunces-normal-latin.woff2',
  './fonts/fraunces-normal-latinext.woff2',
  './fonts/fraunces-italic-latin.woff2',
  './fonts/fraunces-italic-latinext.woff2',
  './fonts/jetbrainsmono-latin.woff2',
  './fonts/jetbrainsmono-latinext.woff2',
  './fonts/sora-latin.woff2',
  './fonts/sora-latinext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

// ——— INSTALL: prednačítaj všetky assety ———
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ——— ACTIVATE: vyčisti staré verzie cache ———
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ——— FETCH: cache-first ———
self.addEventListener('fetch', (event) => {
  // Spracúvaj len GET požiadavky.
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          // Cachuj iba úspešné odpovede z vlastného originu.
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
