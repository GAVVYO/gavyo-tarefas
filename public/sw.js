/* Avisos do GAVYO Tarefas que chegam com a aba fechada. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'GAVYO Tarefas', {
    body: data.body || '', tag: data.tag, renotify: Boolean(data.tag), icon: '/aguia-dourada.svg', badge: '/aguia-dourada.svg',
    data: { url: data.url || '/' }, actions: [{ action: 'reply', title: 'Responder' }]
  }));
});

// Clique no aviso ou em "Responder": abre (ou traz para frente) o site já na conversa certa.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  url.searchParams.set('responder', '1');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      open.postMessage({ type: 'gavyo-open', url: url.href });
      return;
    }
    await self.clients.openWindow(url.href);
  })());
});
