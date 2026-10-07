// 问史 Service Worker v3 —— 应用外壳改为「网络优先」
//
// 为什么改（2026-10-07）：
//   旧版是 stale-while-revalidate：命中缓存就直接返回，再靠 ev.waitUntil() 在后台刷新。
//   两个致命点叠加，导致 iOS 上界面**永久停在旧版本**：
//     1) sw.js 自身字节不变 → 浏览器不安装新 SW → install 不再执行 → 缓存名一直停在老版本，
//        activate 里"清掉旧缓存"的逻辑也永远不会跑；
//     2) iOS 会在 PWA 切后台/关闭时提前终止 ev.waitUntil() 的后台任务 → 后台刷新完不成，
//        缓存里永远是最初那份内容。
//   （旧代码注释写着"即使 sw.js 字节未变，只要发版就会换缓存"——这个前提是错的：
//     install 只在 SW 脚本本身变化时触发。）
//   改为网络优先后：只要在线就必然是最新代码，离线才回退缓存（离线能力不丢）。
//
// 维护约定：改缓存策略时递增 SW_VER，这会强制换缓存并清掉旧的 wenshi-* 缓存。
//          日常改前端**不需要**动这里。
const SW_VER = 'v3-network-first';
const CACHE = 'wenshi-' + SW_VER;
const CORE = ['./', './index.html', './app.js', './style.css', './manifest.webmanifest'];
const ICONS = [
  './icons/icon-180.png', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-512-maskable.png',
];
/* 应用外壳（HTML / 核心 JS / CSS）：必须最新，走网络优先 */
const SHELL = /(\/|\.html|app\.js|style\.css|manifest\.webmanifest)$/;

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // cache:'reload' 绕开 HTTP 缓存，确保预热的是真正最新的字节
    await Promise.allSettled(CORE.concat(ICONS).map(u => c.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();   // 立即接管，不等所有页面关闭
  })());
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('wenshi-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* 页面可主动要求跳过等待并接管 */
self.addEventListener('message', (ev) => {
  if (ev.data && ev.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== location.origin) return;            // 云端 API 不缓存
  if (url.pathname.endsWith('/version.json')) return;    // 版本文件永远走网络

  /* 应用外壳：网络优先 —— 在线必然最新；失败回退缓存，保证离线可开 */
  if (req.mode === 'navigate' || SHELL.test(url.pathname)) {
    ev.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());   // 不 await：写缓存失败不应影响本次响应
        }
        return res;
      } catch (e) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const idx = await caches.match('./index.html');
          if (idx) return idx;
        }
        return Response.error();
      }
    })());
    return;
  }

  /* 图标等静态资源：缓存优先（很少变），未命中再联网 */
  ev.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
      }
      return res;
    } catch (e) { return Response.error(); }
  })());
});
