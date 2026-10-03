// 问史 Service Worker：核心资源缓存优先，离线可开
const CACHE = 'wenshi-20261002-113000';
const CORE = [
  './', './index.html', './app.js', './style.css',
  './manifest.webmanifest', './version.json',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;          // 云端 API 不缓存
  if (ev.request.method !== 'GET') return;
  if (url.pathname.endsWith('/version.json')) return;   // 版本文件永远走网络

  ev.respondWith((async () => {
    const cached = await caches.match(ev.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(ev.request);
      if (res.ok) {
        const c = await caches.open(CACHE);
        c.put(ev.request, res.clone());
      }
      return res;
    } catch (e) {
      if (ev.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
