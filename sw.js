/**
 * Service Worker - PWA 离线缓存
 */

const CACHE_NAME = 'mini-amap-v1';
const PRECACHE_URLS = [
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

// 安装：预缓存静态资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 请求策略：
// - 高德 API 相关请求 → 网络优先（地图数据必须实时）
// - 静态资源 → 缓存优先
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 高德地图 API 请求不走缓存
  if (
    url.hostname.includes('amap.com') ||
    url.hostname.includes('autonavi.com')
  ) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 静态资源：缓存优先
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // 后台更新缓存
        fetch(event.request).then((response) => {
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, response);
          });
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((response) => {
        // 缓存新请求
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      });
    })
  );
});
