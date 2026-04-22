/**
 * Service Worker - 禁用缓存
 */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 清理所有旧缓存
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
  self.clients.claim();
});

// 不缓存任何内容，全部走网络
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
