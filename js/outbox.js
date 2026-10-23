// Zápis bez signálu: závady, které se nepodařilo odeslat, čekají v telefonu (IndexedDB)
// a odešlou se samy, až bude připojení. Fotky a videa se ukládají s nimi.

const DB = 'zavady-outbox';
const STORE = 'items';
let dbPromise;

function db() {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
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

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const outbox = {
  /** item: { wagon_id? | number + group_id, description, defect_code, found_at, files: File[] } */
  async add(item) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // File se uloží jako Blob s názvem a typem (Safari neumí uložit File do IndexedDB spolehlivě)
    const files = await Promise.all((item.files ?? []).map(async (f) => ({
      name: f.name, type: f.type, data: new Blob([await f.arrayBuffer()], { type: f.type }),
    })));
    await run('readwrite', (s) => s.put({ ...item, files, id, saved_at: new Date().toISOString(), error: null }));
    emit();
    return id;
  },
  list: () => run('readonly', (s) => s.getAll()).then((x) => x ?? []),
  async remove(id) {
    await run('readwrite', (s) => s.delete(id));
    emit();
  },
  async setError(id, error) {
    const item = await run('readonly', (s) => s.get(id));
    if (item) await run('readwrite', (s) => s.put({ ...item, error }));
    emit();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

let syncing = null;

/**
 * Odešle čekající závady. Při výpadku sítě skončí (zkusí se příště), jiné chyby (např. oprávnění)
 * si zapamatuje u položky, aby je uživatel viděl. Vrací počet odeslaných.
 */
export function syncOutbox(api) {
  syncing ??= (async () => {
    let sent = 0;
    try {
      for (const item of await outbox.list()) {
        try {
          let wagonId = item.wagon_id;
          if (!wagonId) {
            const w = (await api.findWagon(item.number)) ?? (await api.createWagon(item.number, item.group_id));
            wagonId = w.id;
          }
          const files = item.files.map((f) => new File([f.data], f.name, { type: f.type }));
          await api.createDefect({
            wagon_id: wagonId, description: item.description, found_at: item.found_at, defect_code: item.defect_code,
          }, files);
          await outbox.remove(item.id);
          sent++;
        } catch (e) {
          if (e.network || !navigator.onLine) break;
          await outbox.setError(item.id, e.message);
        }
      }
    } finally {
      syncing = null;
    }
    return sent;
  })();
  return syncing;
}
