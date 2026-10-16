const CACHE_NAME = 'extrachef-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('extrachef-offline-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const offlinePage = await caches.match(OFFLINE_URL);
      return offlinePage || Response.error();
    }),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() || '' };
  }

  const reportReceived = async () => {
    if (!payload.notificationId || !payload.subscriptionId || !payload.receiptToken) return;
    try {
      await fetch(new URL('/api/push/receipt', self.location.origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationId: payload.notificationId,
          subscriptionId: payload.subscriptionId,
          receiptToken: payload.receiptToken,
        }),
      });
    } catch {
      // The provider delivery record remains available if the receipt cannot be posted.
    }
  };

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    const visibleWindow = windows.find((client) => client.visibilityState === 'visible');
    if (visibleWindow) {
      visibleWindow.postMessage({ type: 'PUSH_RECEIVED', payload });
      await reportReceived();
      return;
    }

    await self.registration.showNotification(payload.title || 'ExtraChef', {
      body: payload.body || 'Você tem uma nova atualização.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.notificationId || undefined,
      data: { url: payload.url || '/' },
    });
    await reportReceived();
  }));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const oldSubscription = event.oldSubscription;
    if (!event.newSubscription && oldSubscription?.options?.applicationServerKey) {
      try {
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: oldSubscription.options.applicationServerKey,
        });
      } catch {
        // The application synchronizes the current subscription when it next opens.
      }
    }

    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((client) => client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  if (target.origin !== self.location.origin) return;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existingWindow = windows.find((client) => client.url.startsWith(self.location.origin));
    if (existingWindow) {
      return existingWindow.navigate(target.toString()).then(() => existingWindow.focus());
    }
    return self.clients.openWindow(target.toString());
  }));
});