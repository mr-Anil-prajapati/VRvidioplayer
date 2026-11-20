const CACHE_NAME = 'vr-player-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './network-panel.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://vjs.zencdn.net/8.10.0/video-js.css',
  'https://unpkg.com/videojs-vr/dist/videojs-vr.css',
  'https://vjs.zencdn.net/8.10.0/video.min.js',
  'https://unpkg.com/videojs-vr/dist/videojs-vr.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass through streaming and API calls directly to network
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/stream/') || url.pathname.startsWith('/video/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Fallback for document requests
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
