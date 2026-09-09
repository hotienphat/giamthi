/* =========================================================
   TRỢ LÝ GIÁM THỊ - SERVICE WORKER (OFFLINE-FIRST PWA)
   Version: 5.0 - Zero Cost Local Caching
   ========================================================= */

const CACHE_NAME = 'giamthi-app-v5.5';
const RUNTIME_CACHE = 'giamthi-runtime-v5.5';

const PRECACHE_URLS = [
    './',
    './index.html',
    './style.css',
    './style.css?v=5.5',
    './script.js',
    './script.js?v=5.5',
    './app-config.js',
    './manifest.json',
    './element/logo.png',
    './assets/html2canvas.min.js',
    './assets/xlsx.full.min.js',
    './assets/logo-data.js'
];

// Install: Cache essential app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return Promise.allSettled(
                    PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn('[SW Precache]', url, err)))
                );
            })
            .then(() => self.skipWaiting())
    );
});

// Activate: Clean up older caches
self.addEventListener('activate', event => {
    const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!currentCaches.includes(cacheName)) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: Offline-first strategy
self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET requests and WebSocket / MQTT streams
    if (request.method !== 'GET') return;
    if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) return;

    // For same-origin resources: Cache-first, fallback to network
    if (request.url.startsWith(self.location.origin)) {
        event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) {
                    // Update cache in background
                    fetch(request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200) {
                            caches.open(CACHE_NAME).then(cache => cache.put(request, networkResponse));
                        }
                    }).catch(() => {/* Offline, ignore */});
                    return cachedResponse;
                }

                return fetch(request).then(networkResponse => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // For external CDN resources (fonts, cdnjs, unpkg, googleapis):
    // Stale-While-Revalidate with runtime cache
    event.respondWith(
        caches.match(request).then(cachedResponse => {
            const fetchPromise = fetch(request).then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, responseClone));
                }
                return networkResponse;
            }).catch(() => {
                // If network fails, return cached response if available
                return cachedResponse;
            });

            return cachedResponse || fetchPromise;
        })
    );
});

// Listen for messages from client (e.g. skipWaiting)
self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
