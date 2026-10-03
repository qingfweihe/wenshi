// 问史 Service Worker：缓存名跟随 version.json 自动变化；核心资源 stale-while-revalidate
let CACHE = 'wenshi-boot';           // install 时用联网读到的版本号替换
const CORE_PATHS = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest'];
const CORE_ICONS = ['./icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    try {
      // 版本号驱动缓存名：即使 sw.js 字节未变，只要发版就会换缓存
      const r = await fetch('./version.json', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.v) CACHE = 'wenshi-' + j.v;
    } catch (e) { /* 离线安装：用 boot 名兜底 */ }
    const c = await caches.open(CACHE);
    await Promise.allSettled(CORE_PATHS.concat(CORE_ICONS).map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wenshi-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const SWR = /(\/|\.html|app\.js|style\.css)$/;   // 核心资源：先给缓存、后台刷新

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (url.origin !== location.origin) return;          // 云端 API 不缓存
  if (ev.request.method !== 'GET') return;
  if (url.pathname.endsWith('/version.json')) return;   // 版本文件永远走网络

  ev.respondWith((async () => {
    const cached = await caches.match(ev.request, { ignoreSearch: true });
    const isCore = SWR.test(url.pathname) && !url.pathname.endsWith('.json');
    if (cached) {
      if (isCore) {
        ev.waitUntil((async () => {
          try {
            const res = await fetch(ev.request);
            if (res && res.ok) (await caches.open(CACHE)).put(ev.request, res.clone());
          } catch (e) { /* 离线忽略 */ }
        })());
      }
      return cached;
    }
    try {
      const res = await fetch(ev.request);
      if (res && res.ok) (await caches.open(CACHE)).put(ev.request, res.clone());
      return res;
    } catch (e) {
      if (ev.request.mode === 'navigate') {
        return (await caches.match('./index.html')) || Response.error();
      }
      return Response.error();
    }
  })());
});
