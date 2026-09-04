// Service Worker — DeclaraFY PWA + Push Notifications
const CACHE_NAME = 'declarafy-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/icon.svg',
  '/icon-64.png',
  '/icon-180.png',
  '/favicon.ico',
  '/site.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: network-first with no cache
  if (url.pathname.includes('/cloudfunctions/') || url.hostname.includes('anthropic.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response(JSON.stringify({ error: 'Network error' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Firebase SDK: network-first
  if (url.hostname.includes('gstatic.com') || url.hostname.includes('firebaseio.com')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // JS files: network-first (never cache stale JS)
  if (url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache-first (HTML, CSS, images, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      });
    })
  );
});

// ════════════════════════════════════════
// PUSH NOTIFICATIONS
// ════════════════════════════════════════
self.addEventListener('push', e => {
  let data = { title: 'DeclaraFY', body: 'Tienes una notificación' };
  if (e.data) {
    try { data = e.data.json(); } catch { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-180.png',
      badge: '/icon-64.png',
      tag: data.tag || 'declarafy-notification',
      data: data.url || '/',
      actions: [
        { action: 'open', title: 'Abrir' },
        { action: 'dismiss', title: 'Cerrar' }
      ]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return clients.openWindow(e.notification.data || '/');
    })
  );
});
