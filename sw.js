// Service worker: rychlé spuštění z paměti telefonu, offline záloha a push upozornění na nové závady.

const CACHE = 'zavady-v28';
const PHOTO_CACHE = 'zavady-foto'; // fotky závad a obrázky katalogu (přežije novou verzi aplikace)
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/model.js', 'js/codes.js', 'js/ui.js', 'js/api/index.js', 'js/api/demo.js', 'js/api/supabase.js',
  'js/views/account.js', 'js/views/codes.js', 'js/views/defect.js', 'js/views/form.js', 'js/views/groups.js',
  'js/views/regulations.js', 'js/views/wagon.js', 'js/views/admin.js', 'js/views/overview.js',
  'js/outbox.js', 'js/history.js', 'js/xlsx.js', 'js/offline.js',
  'vendor/preact-htm.js', 'vendor/supabase.js', 'icons/icon.svg?v=2', 'icons/icon-192.png?v=2', 'icons/badge-96.png?v=2',
];

// Nová verze: stáhnout všechny soubory znovu ze sítě (ne z mezipaměti prohlížeče)
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

// Aplikace se ptá na číslo verze (Můj účet → „Verze aplikace“)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'version') e.ports[0]?.postMessage(CACHE);
});

// Po aktivaci smazat starou verzi a otevřeným oknům říct, že je k dispozici nová
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) => k !== CACHE && k !== PHOTO_CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (old.length) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated' });
    }
  })());
});

// Soubory aplikace hned z paměti telefonu (rychlé spuštění), na pozadí se ověří novější verze.
// Co v paměti není, stáhne se ze sítě; bez signálu se použije uložená verze.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Fotky závad a obrázky katalogu ze Supabase: z paměti telefonu (klíč = cesta bez podpisu, podepsaný
  // odkaz se každou hodinu mění, fotka ne), jinak ze sítě a uložit. Videa (stahují se po částech) ne.
  if (/\.supabase\.co$/.test(url.hostname) && /^\/storage\/v1\/object\/sign\/(attachments|katalog)\//.test(url.pathname)) {
    if (e.request.headers.has('range') || /\.(mp4|mov|webm|m4v|3gp)$/i.test(url.pathname)) return;
    e.respondWith((async () => {
      const cache = await caches.open(PHOTO_CACHE);
      const key = url.origin + url.pathname;
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
      if (res.ok && (res.headers.get('content-type') ?? '').startsWith('image/')) cache.put(key, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  // Návod k instalaci: vždy nejdřív ze sítě (ověří se i proti paměti prohlížeče), ať je hned vidět nová verze;
  // bez signálu z paměti telefonu. Otevírá se zřídka a skoro vždy se signálem, rychlý start tu nehraje roli.
  if (url.pathname.endsWith('/navod.html')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(url.href, { cache: 'no-cache' });
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request)) ?? Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    const fromNetwork = fetch(e.request).then((res) => {
      if (res.ok && res.status === 200 && res.type === 'basic') cache.put(e.request, res.clone());
      return res;
    });
    if (cached) {
      e.waitUntil(fromNetwork.catch(() => {}));
      return cached;
    }
    try {
      return await fromNetwork;
    } catch {
      return (await cache.match('index.html')) ?? Response.error();
    }
  })());
});

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil((async () => {
    // Je-li aplikace právě otevřená, upozorní uživatele sama (živé aktualizace). Zkušební upozornění se ukáže vždy.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const always = data.tag === 'test' || String(data.tag ?? '').startsWith('user-');
    if (!always && wins.some((w) => w.focused && w.visibilityState === 'visible')) return;
    await self.registration.showNotification(data.title || 'Nová závada', {
      body: data.body || '',
      icon: 'icons/icon-192.png?v=2',
      badge: 'icons/badge-96.png?v=2',
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
