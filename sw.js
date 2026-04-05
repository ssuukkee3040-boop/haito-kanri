// Service Worker for 高配当株管理ツール
const CACHE_NAME = 'haito-kanri-v1';
const CACHE_URLS = [
  './',
  './index.html',
  './manifest.json'
];

// インストール時にキャッシュ
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CACHE_URLS);
    })
  );
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// リクエスト処理：ネット優先、失敗時はキャッシュ
self.addEventListener('fetch', event => {
  // Yahoo Finance API などの外部リクエストはキャッシュしない
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 成功したらキャッシュも更新
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // オフライン時はキャッシュから返す
        return caches.match(event.request).then(cached => {
          return cached || new Response('<h2>オフラインです。接続を確認してください。</h2>', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        });
      })
  );
});
