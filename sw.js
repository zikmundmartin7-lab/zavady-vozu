// Service worker: rychlé spuštění z paměti telefonu, offline záloha a push upozornění na nové závady.

const CACHE = 'zavady-v57'; // zvýšit spolu s APP_VERSION v js/version.js
const PHOTO_CACHE = 'zavady-foto'; // fotky závad a obrázky katalogu (přežije novou verzi aplikace)
const SHARED_CACHE = 'zavady-sdilene'; // fotky sdílené do aplikace z galerie, než si je vyzvedne formulář (js/draft.js)
// Skener čísla vozu: neuronové sítě a ONNX runtime (asi 25 MB). V terénu nemusí být signál, proto se stáhnou
// hned s novou verzí aplikace (jen poprvé, pak zůstávají v paměti telefonu i přes další verze). Když se to
// nepovede, dotáhne je aplikace při dalším spuštění se signálem (prefetchOcr v js/offline.js), případně
// skener při otevření. Při změně sítí nebo runtime zvýšit; stejný název a seznam souborů je v js/offline.js.
const OCR_CACHE = 'zavady-ocr-v1';
const OCR_FILES = ['vendor/ort/ort.wasm.min.mjs', 'vendor/ort/ort-wasm-simd-threaded.mjs',
  'vendor/ort/ort-wasm-simd-threaded.wasm', 'models/det.onnx', 'models/rec_latin.onnx', 'models/rec_latin_dict.txt'];
const OCR_PATHS = new Set(OCR_FILES.map((u) => new URL(u, location.href).pathname));
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/config.js', 'js/model.js', 'js/codes.js', 'js/ui.js', 'js/api/index.js', 'js/api/demo.js', 'js/api/supabase.js',
  'js/views/account.js', 'js/views/codes.js', 'js/views/defect.js', 'js/views/form.js', 'js/views/groups.js',
  'js/views/regulations.js', 'js/views/wagon.js', 'js/views/admin.js', 'js/views/overview.js',
  'js/outbox.js', 'js/draft.js', 'js/history.js', 'js/xlsx.js', 'js/offline.js', 'js/version.js',
  'js/views/scanner.js', 'js/light.js', 'js/ocr.js', 'js/ort.js', 'js/dictation.js', 'js/series.js', 'data/rady.json',
  'vendor/preact-htm.js', 'vendor/supabase.js', 'icons/icon.svg?v=2', 'icons/icon-192.png?v=2', 'icons/badge-96.png?v=2',
];

// Soubor aplikace podle cesty → klíč v paměti; parametr v adrese se nebere v úvahu (razítko ?r=… z index.html)
const SHELL_KEYS = new Map(SHELL.map((u) => { const x = new URL(u, location.href); return [x.pathname, x.href]; }));

// Nová verze: stáhnout všechny soubory znovu přímo z webu. Jedinečný parametr v adrese obejde mezipaměť
// prohlížeče i serverů GitHubu – jinak se k nové verzi mohly uložit soubory ze staré (verze 36 / stažená 37).
// Soubory se uloží pod běžnou adresou; když se některý nestáhne, zůstane stará verze a zkusí se to příště.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const stamp = Date.now();
    const files = await Promise.all(SHELL.map(async (u) => {
      const res = await fetch(`${u}${u.includes('?') ? '&' : '?'}sw=${stamp}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${u}: ${res.status}`);
      return [u, new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })];
    }));
    const cache = await caches.open(CACHE);
    await Promise.all(files.map(([u, res]) => cache.put(u, res)));
    // skener čísla vozu: chybějící soubory (když se některý nestáhne, nová verze se přesto nainstaluje)
    const ocr = await caches.open(OCR_CACHE);
    await Promise.all(OCR_FILES.map(async (u) => {
      const key = new URL(u, location.href).href;
      if (!(await ocr.match(key))) await ocr.add(key).catch(() => {});
    }));
    await self.skipWaiting();
  })());
});

// Aplikace se ptá na číslo verze (Můj účet → „Verze aplikace“)
self.addEventListener('message', (e) => {
  if (e.data?.type === 'version') e.ports[0]?.postMessage(CACHE);
});

// Po aktivaci smazat starou verzi a otevřeným oknům říct, že je k dispozici nová. Jen vlastní zásoby
// (zavady-…): na stejné adrese zikmundmartin7-lab.github.io běží i Výkaz vozů se svými (vykaz-…).
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = [CACHE, PHOTO_CACHE, SHARED_CACHE, OCR_CACHE];
    const old = (await caches.keys()).filter((k) => k.startsWith('zavady-') && !keep.includes(k));
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    if (old.length) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'updated' });
    }
  })());
});

// Soubory aplikace jen z paměti telefonu (rychlé spuštění): patří k této verzi a mění se jen s novou verzí
// (install výše), na pozadí se nepřepisují – starší kopie z mezipaměti by jinak novou verzi pokazila.
// Ostatní soubory z paměti a na pozadí se ověří novější; co v paměti není, stáhne se ze sítě.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.searchParams.has('sdileni')) {
    e.respondWith(receiveShared(e.request));
    return;
  }
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
  // Skener čísla vozu (sítě, ONNX runtime): jednou stáhnout a pak jen z paměti telefonu
  if (OCR_PATHS.has(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const key = url.origin + url.pathname;
      const hit = await cache.match(key);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) cache.put(key, res.clone());
      return res;
    })());
    return;
  }
  // Videonávod: přehrává se po částech (Range), iPhone jinak video z paměti nespustí – vždy rovnou ze sítě
  if (e.request.headers.has('range') || /\/video\/[^/]+\.mp4$/.test(url.pathname)) return;
  // Návod k instalaci a stránka s fotkami závady (fotky.html): vždy nejdřív ze sítě (ověří se i proti paměti
  // prohlížeče), ať je hned vidět nová verze; bez signálu z paměti telefonu. Otevírají se zřídka a skoro vždy
  // se signálem, rychlý start tu nehraje roli.
  if (url.pathname.endsWith('/navod.html') || url.pathname.endsWith('/fotky.html')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const key = url.origin + url.pathname; // bez ?z=… – stránka s fotkami je pro všechny závady stejná
      try {
        const res = await fetch(url.href, { cache: 'no-cache' });
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return (await cache.match(key)) ?? Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const own = SHELL_KEYS.has(url.pathname) && await cache.match(SHELL_KEYS.get(url.pathname));
    if (own) return own;
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

// Sdílení do aplikace (Android: Galerie → Sdílet → Závady vozů, share_target v manifestu): fotky a videa
// uložit do paměti a otevřít novou závadu, která si je vyzvedne. Starší nevyzvednuté se zahodí.
async function receiveShared(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('media').filter((f) => typeof f !== 'string' && f.size);
    const cache = await caches.open(SHARED_CACHE);
    for (const k of await cache.keys()) await cache.delete(k);
    const stamp = Date.now();
    await Promise.all(files.map((f, i) => cache.put(`sdilene/${stamp}-${String(i).padStart(2, '0')}`, new Response(f, {
      headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || '') },
    }))));
  } catch { /* nic se neuložilo – otevře se prázdná závada */ }
  return Response.redirect(new URL('./#/nova?sdilene=1', self.registration.scope).href, 303);
}

// Safari (iPhone, iPad, Mac) chce na každé push upozornění opravdu ukázat – po několika „tichých“ odběr
// upozornění zruší. iPhone navíc aplikaci v pozadí někdy hlásí jako otevřenou. Proto se tam ukáže vždy.
const SAFARI = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Android|Edg/.test(navigator.userAgent);

self.addEventListener('push', (e) => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil((async () => {
    // Je-li aplikace právě otevřená, upozorní uživatele sama (živé aktualizace). Zkušební upozornění se ukáže vždy.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const always = SAFARI || data.tag === 'test' || String(data.tag ?? '').startsWith('user-');
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
