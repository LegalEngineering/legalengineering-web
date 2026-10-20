// sw.js — service worker pre PWA kalkulačky trov.
// Stratégia: cache-first pre statiku, network-first pre version.json.
// Update: žiadny automatický skipWaiting — nová verzia čaká, kým ju používateľ potvrdí
//   (toast „Nová verzia dostupná → Obnoviť") cez postMessage('skipWaiting').
//
// ⚠️ ROČNÁ AKTUALIZÁCIA: pri zmene tariff.js (nový rok VZ, nové opatrenie MPSVaR, novela
//   vyhlášky) bumpni CACHE verziu nižšie aj `version` v version.json a TARIFF.meta.version,
//   inak používatelia s nainštalovanou PWA dostanú toast a po obnovení novú verziu.

const CACHE = 'trovy-2026.06.01b-p6';

// Produkčné statické súbory. NEZAHŔŇAŤ _review.html, server.py, *.cmd, tests/ (dev nástroje).
// POZOR: './index.html' sa NEPRECACHUJE — hosting (Cloudflare assets) ho 307-presmeruje
// na './' a presmerovaná odpoveď v cache zlomí navigáciu (net::ERR_FAILED). Stránka = './'.
const ASSETS = [
  './',
  './app.js',
  './engine.js',
  './tariff.js',
  './phm.js',
  './style.css',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  // Bez skipWaiting — nová verzia sa aktivuje až po potvrdení používateľom.
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Dev súbory — nikdy neslúžiť z cache (necháme default sieť).
  if (url.pathname.includes('_review') || url.pathname.includes('/tests/')) return;

  // Navigácia na stránku aplikácie ('./', './index.html', aj s query) → vždy čistá
  // (nepresmerovaná) kópia './' z cache; bez cache sieť. Rieši aj staré inštalácie,
  // ktoré ešte štartujú na './index.html'.
  if (e.request.mode === 'navigate') {
    const scopePath = new URL(self.registration.scope).pathname;
    if (url.pathname === scopePath || url.pathname === scopePath + 'index.html') {
      e.respondWith(
        caches.match(scopePath, { ignoreSearch: true })
          .then((cached) => (cached && !cached.redirected) ? cached : fetch(e.request))
          .catch(() => caches.match(scopePath, { ignoreSearch: true }))
      );
      return;
    }
  }

  // version.json — network-first (na detekciu novej verzie), fallback na cache.
  if (url.pathname.endsWith('version.json')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Statika — cache-first, fallback sieť (a doplnenie cache).
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((resp) => {
      if (resp && resp.ok && resp.type === 'basic' && !resp.redirected) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return resp;
    }))
  );
});
