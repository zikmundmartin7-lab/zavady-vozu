// Rozepsaná nová závada: údaje v localStorage, fotky a videa v IndexedDB. Android při spuštění fotoaparátu
// (hlavně při natáčení videa) někdy zavře Chrome v pozadí, aby uvolnil paměť – po návratu by byl formulář
// prázdný. Koncept se obnoví při dalším otevření formuláře pro stejný vůz a smaže se po uložení závady.
// Sem patří i fotky sdílené do aplikace z galerie (sw.js je uloží do mezipaměti, formulář si je vyzvedne).

const TEXT_PREFIX = 'zavady-koncept:';
const DB = 'zavady-koncept';
const STORE = 'files';
const MAX_AGE = 12 * 3600e3; // starší koncept se zahodí
export const SHARED_CACHE = 'zavady-sdilene'; // stejný název v sw.js

let dbPromise;
function db() {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const draft = {
  /** { number, groupId, code, description, foundAt, saved_at, files: File[] } nebo null */
  async load(key) {
    let text = null;
    try { text = JSON.parse(localStorage.getItem(TEXT_PREFIX + key)); } catch { /* nevadí */ }
    const stored = await run('readonly', (s) => s.get(key)).catch(() => null);
    const savedAt = Math.max(Date.parse(text?.saved_at) || 0, Date.parse(stored?.saved_at) || 0);
    if (!savedAt) return null;
    if (Date.now() - savedAt > MAX_AGE) { await draft.clear(key); return null; }
    const files = (stored?.files ?? []).map((f) => new File([f.data], f.name, { type: f.type }));
    return { ...text, files, saved_at: new Date(savedAt).toISOString() };
  },
  saveText(key, fields) {
    try { localStorage.setItem(TEXT_PREFIX + key, JSON.stringify({ ...fields, saved_at: new Date().toISOString() })); }
    catch { /* plná paměť – nevadí */ }
  },
  async saveFiles(key, files) {
    if (!files.length) { await run('readwrite', (s) => s.delete(key)).catch(() => {}); return; }
    // File se uloží jako Blob s názvem a typem (jako v outbox.js)
    const list = await Promise.all(files.map(async (f) => ({
      name: f.name, type: f.type, data: new Blob([await f.arrayBuffer()], { type: f.type }),
    })));
    await run('readwrite', (s) => s.put({ key, files: list, saved_at: new Date().toISOString() })).catch(() => {});
  },
  async clear(key) {
    try { localStorage.removeItem(TEXT_PREFIX + key); } catch { /* nevadí */ }
    await run('readwrite', (s) => s.delete(key)).catch(() => {});
  },
};

/** Fotky a videa sdílené do aplikace (Galerie → Sdílet → Závady vozů); po vyzvednutí se smažou. */
export async function takeSharedFiles() {
  if (!window.caches) return [];
  const cache = await caches.open(SHARED_CACHE);
  const out = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) {
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-name') || '') || `foto-${out.length + 1}.jpg`;
      out.push(new File([blob], name, { type: res.headers.get('content-type') || blob.type }));
    }
    await cache.delete(req);
  }
  return out;
}
