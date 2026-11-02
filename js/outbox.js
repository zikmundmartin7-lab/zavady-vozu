// Zápis bez signálu: závady, které se nepodařilo odeslat, čekají v telefonu (IndexedDB)
// a odešlou se samy, až bude připojení. Fotky a videa se ukládají s nimi.
// Uložený záznam s fotkami se už nikdy nepřepisuje: Safari v iPhonu po zápisu Blobu přečteného z IndexedDB
// zpět do databáze fotku ztratí (černý náhled) a další zápis selže (Výkaz vozů v27). Chyba odeslání a příznaky
// se proto drží zvlášť v localStorage a fotky se odesílají z kopie bajtů.

const DB = 'zavady-outbox';
const STORE = 'items';
const STATE_KEY = 'zavady-outbox-stav'; // id → { error, unreadable, skip, sent }
let dbPromise;

function db() {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
    // plná paměť apod. zruší transakci bez onerror – jinak by se čekalo navždy
    t.onabort = () => rej(t.error ?? new Error('Zápis do paměti telefonu se nepovedl.'));
  });
}

let state;
function getState() {
  if (!state) {
    try { state = JSON.parse(localStorage.getItem(STATE_KEY)) ?? {}; } catch { state = {}; }
  }
  return state;
}
function setState(id, patch) {
  const s = getState();
  if (patch) s[id] = { ...s[id], ...patch };
  else delete s[id];
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch { /* zůstane v paměti do zavření aplikace */ }
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const outbox = {
  /** item: { wagon_id? | number + group_id, description, defect_code, found_at, files: File[] } */
  async add(item) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // File se uloží jako Blob s názvem a typem (Safari neumí uložit File do IndexedDB spolehlivě)
    const files = [];
    for (const f of item.files ?? []) {
      let data;
      try {
        data = new Blob([await f.arrayBuffer()], { type: f.type });
      } catch {
        throw new Error(`Fotku nebo video „${f.name}“ se nepodařilo přečíst – odeberte ji a vyfoťte znovu.`);
      }
      files.push({ name: f.name, type: f.type, data });
    }
    await run('readwrite', (s) => s.put({ ...item, files, id, saved_at: new Date().toISOString(), error: null }));
    emit();
    return id;
  },
  async list() {
    const items = (await run('readonly', (s) => s.getAll())) ?? [];
    const s = getState();
    // error v záznamu: verze do 57 ho zapisovaly přepsáním celého záznamu
    return items.map((i) => ({ ...i, ...s[i.id], error: s[i.id] && 'error' in s[i.id] ? s[i.id].error : i.error ?? null }));
  },
  async remove(id) {
    await run('readwrite', (s) => s.delete(id));
    setState(id, null);
    emit();
  },
  /** Chyba odeslání – jen do localStorage, záznam s fotkami se nepřepisuje. */
  setError(id, error, extra = {}) {
    setState(id, { error, unreadable: 0, ...extra });
    emit();
  },
  /** Vozmistr souhlasil s odesláním bez fotek, které telefon nedokáže přečíst. */
  skipUnreadable(id) {
    setState(id, { skip: true, error: null });
    emit();
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const unreadableText = (names, total) => (names.length === 1
  ? `Fotku nebo video „${names[0]}“ se v telefonu nepodařilo přečíst.`
  : `${names.length} z ${total} fotek a videí se v telefonu nepodařilo přečíst.`);

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
          // odesláno už dřív, jen se nepodařilo smazat z telefonu – podruhé neposílat
          if (item.sent) { await outbox.remove(item.id); continue; }
          // Fotky se posílají z kopie bajtů; nečitelné se zjistí dřív, než na serveru vznikne závada
          const files = [];
          const unreadable = [];
          for (const f of item.files) {
            try { files.push(new File([await f.data.arrayBuffer()], f.name, { type: f.type })); }
            catch { unreadable.push(f.name); }
          }
          if (unreadable.length && !item.skip) {
            outbox.setError(item.id, unreadableText(unreadable, item.files.length), { unreadable: unreadable.length });
            continue;
          }
          let wagonId = item.wagon_id;
          if (!wagonId) {
            const w = (await api.findWagon(item.number)) ?? (await api.createWagon(item.number, item.group_id));
            wagonId = w.id;
          }
          await api.createDefect({
            wagon_id: wagonId, description: item.description, found_at: item.found_at, defect_code: item.defect_code,
          }, files);
          setState(item.id, { sent: true });
          sent++;
          await outbox.remove(item.id);
        } catch (e) {
          if (e.network || !navigator.onLine) break;
          outbox.setError(item.id, e.message);
        }
      }
    } finally {
      syncing = null;
    }
    return sent;
  })();
  return syncing;
}
