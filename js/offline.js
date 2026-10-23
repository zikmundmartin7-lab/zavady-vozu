// Stahování na pozadí: když je signál, aplikace si uloží všechny skupiny, vozy, závady, komentáře
// k neopraveným závadám a fotky neopravených závad. Obrazovky pak naskočí hned z paměti telefonu
// (i se slabým nebo žádným signálem) a ze sítě se jen obnoví.

import { PHOTO_CACHE, writeCached } from './ui.js';

let running = null;
let lastAt = 0;

export const lastPrefetchAt = () => lastAt;

// Klíč fotky v paměti telefonu = adresa bez podpisu (podepsaný odkaz platí jen hodinu, fotka se nemění)
export const photoKey = (url) => {
  const u = new URL(url);
  return u.origin + u.pathname;
};

const byNewest = (a, b) => Date.parse(b.found_at ?? b.created_at) - Date.parse(a.found_at ?? a.created_at);

/** Stáhne a uloží všechno potřebné. Souběžné volání vrátí běžící stahování. */
export function prefetchAll(api) {
  running ??= (async () => {
    const { groups, wagons, defects, comments, overview } = await api.snapshot();
    const put = (key, data) => writeCached(api.mode, key, data);

    put('groups', groups);
    const byOpen = (a, b) => b.open_count - a.open_count || a.number.localeCompare(b.number);
    for (const g of groups) put(`wagons:${g.id}`, wagons.filter((w) => w.group_id === g.id).sort(byOpen));

    const defectsByWagon = new Map();
    for (const d of defects) {
      if (!defectsByWagon.has(d.wagon_id)) defectsByWagon.set(d.wagon_id, []);
      defectsByWagon.get(d.wagon_id).push(d);
    }
    for (const w of wagons) {
      put(`wagon:${w.id}`, w);
      put(`defects:${w.id}`, defectsByWagon.get(w.id) ?? []);
    }

    const open = defects.filter((d) => !d.resolved_at);
    for (const d of open) put(`comments:${d.id}`, comments.filter((c) => c.defect_id === d.id));

    const rows = overview.sort(byNewest);
    put('overview:all', rows);
    put('overview:open', rows.filter((r) => !r.resolved_at));
    put('overview:resolved', rows.filter((r) => r.resolved_at));

    await storePhotos(api, defects, open);
    lastAt = Date.now();
  })().finally(() => { running = null; });
  return running;
}

// Fotky neopravených závad do paměti telefonu (každá jen jednou); fotky smazaných příloh se uklidí
async function storePhotos(api, all, open) {
  if (api.mode !== 'supabase' || !window.caches) return;
  const cache = await caches.open(PHOTO_CACHE);
  const known = new Set(all.flatMap((d) => d.attachments ?? []).filter((a) => a.url).map((a) => photoKey(a.url)));
  for (const req of await cache.keys()) {
    if (req.url.includes('/object/sign/attachments/') && !known.has(photoKey(req.url))) await cache.delete(req);
  }
  const photos = open.flatMap((d) => d.attachments ?? []).filter((a) => a.kind !== 'video' && a.url);
  for (const a of photos) {
    if (!navigator.onLine) return;
    const key = photoKey(a.url);
    if (await cache.match(key)) continue;
    try {
      const res = await fetch(a.url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await cache.put(key, res);
    } catch {
      return; // výpadek sítě – zbytek příště
    }
  }
}
