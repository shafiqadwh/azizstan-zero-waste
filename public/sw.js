/*
 * AZIZSTAN ZERO WASTE service worker (11-jobs §3, T26): web push only.
 * No caching of pages or data — evaluations must never be served stale.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'AZIZSTAN ZERO WASTE', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'AZIZSTAN ZERO WASTE', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { link: data.link || '/inbox' },
      lang: 'th',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || '/inbox', self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === link.origin && 'focus' in w) {
          w.navigate(link.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(link.href);
    }),
  );
});
