/* 墨记 Service Worker — 已安装外壳立即启动,后台更新下一次启动版本 */
const CACHE = 'moji-v5-20261026-icon';
const SHELL_URL = new URL('./index.html', self.registration.scope).href;
const STATIC_URLS = [
  new URL('./manifest.webmanifest', self.registration.scope).href,
  new URL('./apple-touch-icon.png', self.registration.scope).href,
  new URL('./icon-192.png', self.registration.scope).href,
  new URL('./icon-512.png', self.registration.scope).href,
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js'
];

async function cleanNavigationResponse(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(await response.blob(), {
    status: 200,
    statusText: 'OK',
    headers
  });
}

async function refreshShell(request) {
  const response = await fetch(request, {cache: 'no-store', redirect: 'follow'});
  if (!response || !response.ok) throw new Error('shell fetch failed');
  const clean = await cleanNavigationResponse(response);
  const cache = await caches.open(CACHE);
  await cache.put(SHELL_URL, clean.clone());
  return clean;
}

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await refreshShell(new Request(SHELL_URL, {cache: 'reload'}));
    await Promise.allSettled(STATIC_URLS.map(url => cache.add(url)));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppShell(request, url) {
  return request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.hostname === 'openrouter.ai' || url.pathname.startsWith('/api/')) return;

  if (isAppShell(event.request, url)) {
    const cached = caches.open(CACHE).then(cache => cache.match(SHELL_URL));
    const refreshed = refreshShell(event.request);
    event.waitUntil(refreshed.catch(() => {}));
    event.respondWith((async () => {
      const shell = await cached;
      if (shell) return cleanNavigationResponse(shell);
      try {
        return await refreshed;
      } catch (error) {
        const fallback = await caches.match(SHELL_URL);
        if (fallback) return cleanNavigationResponse(fallback);
        throw error;
      }
    })());
    return;
  }

  const cached = caches.match(event.request);
  const network = fetch(event.request).then(async response => {
    if (response && response.status === 200 &&
        (url.origin === self.location.origin || url.hostname === 'cdn.jsdelivr.net')) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith(cached.then(response => response || network));
});
