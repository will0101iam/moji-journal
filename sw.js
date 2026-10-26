/* 墨记 Service Worker — 应用外壳 network-first(永远拿最新),静态资源 cache-first */
const CACHE = 'moji-v3';
const PRECACHE = ['./', './index.html', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppShell(req, u) {
  // HTML 文档 / 根路径 / index.html —— 应用外壳,必须拿最新
  return req.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;          // 不缓存 API POST
  if (u.hostname === 'openrouter.ai') return;      // AI 请求始终直连
  if (u.pathname.startsWith('/api/')) return;      // 后端接口直连,不缓存

  // 应用外壳:network-first,拿到新版就更新缓存;离线才回退缓存
  if (isAppShell(e.request, u)) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
        }
        return res;
      }).catch(() => caches.match('./index.html') || caches.match('./'))
    );
    return;
  }

  // 静态资源(Chart.js 等):cache-first,后台更新
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && (u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
