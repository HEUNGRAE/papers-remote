/* Paper Studio Remote SW — 앱셸 precache + 데이터 runtime cache */
const SHELL_CACHE = 'psr-shell-v8';
const DATA_CACHE = 'psr-data-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'graph.js',
  'vendor/three.min.js', 'vendor/OrbitControls.js',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    // 데이터: cache-first (스냅샷은 불변; 새 배포는 URL 동일하나 SW 버전 갱신으로 캐시 교체)
    e.respondWith(
      caches.open(DATA_CACHE).then(async c => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }
  // 앱셸: network-first, 실패 시 캐시 (배포 갱신 즉시 반영 + 오프라인 지원)
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) caches.open(SHELL_CACHE).then(c => c.put(e.request, res.clone()));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
