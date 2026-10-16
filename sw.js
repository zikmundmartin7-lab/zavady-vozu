// Service worker: offline záloha aplikace a push upozornění na nové závady.

const CACHE = 'zavady-v5';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/model.js', 'js/ui.js', 'js/api/index.js', 'js/api/demo.js', 'js/api/supabase.js',
  'js/views/account.js', 'js/views/defect.js', 'js/views/form.js', 'js/views/groups.js', 'js/views/wagon.js',
  'vendor/preact-htm.js', 'vendor/supabase.js', 'icons/icon.svg', 'icons/icon-192.png', 'icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Nejdřív síť (vždy nejnovější verze), bez signálu ze zálohy.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil((async () => {
    // Je-li aplikace právě otevřená, upozorní uživatele sama (živé aktualizace). Zkušební upozornění se ukáže vždy.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (data.tag !== 'test' && wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Nová závada', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: data.tag,
      data: { url: data.url || '#/' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '#/';
  e.waitUntil((async () => {
    const scope = self.registration.scope;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => w.url.startsWith(scope));
    if (win) {
      await win.focus();
      win.postMessage({ type: 'open', url });
    } else {
      await self.clients.openWindow(scope + url);
    }
  })());
});
