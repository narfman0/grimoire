/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `grimoire-${version}`;

// Static assets to pre-cache: SvelteKit build output + static files
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      for (const key of keys) {
        if (key !== CACHE) await caches.delete(key);
      }
    })
  );
  self.clients.claim();
});

// Pre-cached build output is content-hashed (or versioned by CACHE) — safe
// to serve cache-first forever.
const PRECACHED = new Set(ASSETS.map((p) => new URL(p, self.location.origin).pathname));

self.addEventListener('fetch', (event) => {
  // Only handle GET requests; skip cross-origin and API/auth routes
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Don't cache API calls — always go to network for fresh data
  if (url.pathname.startsWith('/api/')) return;

  // Page documents and SvelteKit data requests must be network-first: an
  // encounter page served stale renders old participants/reveals until the
  // poll corrects part of it, and load-function data (__data.json) is as
  // dynamic as the API. Cache is an offline fallback only.
  const isDocument = event.request.mode === 'navigate';
  const isDataRequest = url.pathname.endsWith('__data.json');
  if (isDocument || isDataRequest) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw new Error('offline and not cached');
        })
    );
    return;
  }

  // Hashed build assets: cache-first (immutable within a CACHE version).
  if (PRECACHED.has(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached ?? fetch(event.request))
    );
    return;
  }

  // Everything else static-ish (portraits, uploads): stale-while-revalidate.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
      // Serve cache immediately; update in background (stale-while-revalidate)
      return cached ?? network;
    })
  );
});
