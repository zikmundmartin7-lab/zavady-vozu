// Zápis bez signálu: závady, které se nepodařilo odeslat, čekají v telefonu (IndexedDB)
// a odešlou se samy, až bude připojení a aplikace bude otevřená. Fotky a videa se ukládají s nimi.
// Se zavřenou aplikací se nic neodešle (přihlášení je jen v ní) – připomene je oznámení v liště, které se
// ukáže při odchodu z aplikace a zmizí po odeslání (remindIfPending, sw.js).
// Uložený záznam s fotkami se už nikdy nepřepisuje: Safari v iPhonu po zápisu Blobu přečteného z IndexedDB
// zpět do databáze fotku ztratí (černý náhled) a další zápis selže (Výkaz vozů v27). Chyba odeslání a příznaky
// se proto drží zvlášť v localStorage a fotky se odesílají z kopie bajtů.

const DB = 'zavady-outbox';
const STORE = 'items';
const STATE_KEY = 'zavady-outbox-stav'; // id → { error, unreadable, skip, sent }
const REMIND_TAG = 'zavady-outbox'; // značka události sync i oznámení – stejná v sw.js
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
    remindWhenOnline();
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
    // fronta je prázdná → připomínka v liště oznámení už neplatí
    if (!(await run('readonly', (s) => s.count()))) clearReminder().catch(() => {});
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

/**
 * Android (Chrome): po návratu signálu Chrome probudí service worker i u zamčeného telefonu a ten neodeslané
 * závady připomene oznámením se zvukem (sw.js, událost sync) – ale jen když Chrome mezitím neběžel; běžící
 * Chrome na pozadí o návratu sítě neví (emulátor 4. 11.). Safari (iPhone) událost sync nemá.
 */
export function remindWhenOnline() {
  navigator.serviceWorker?.ready.then((r) => r.sync?.register(REMIND_TAG)).catch(() => {});
}

/**
 * Při odchodu z aplikace: čekají závady, které se mají odeslat (ne ty s chybou) → hned tiché oznámení
 * v liště (i bez signálu, zůstane do odeslání) a v Androidu navíc připomínka po návratu signálu.
 * Oznámení ukáže service worker – stránku může telefon hned po odchodu zmrazit. Vyžaduje povolená upozornění.
 */
export async function remindIfPending() {
  const count = (await outbox.list()).filter((i) => !i.error && !i.sent).length;
  if (!count) return;
  remindWhenOnline();
  const r = await navigator.serviceWorker?.ready;
  r?.active?.postMessage({ type: 'remind-outbox', count });
}

async function clearReminder() {
  const reg = await navigator.serviceWorker?.getRegistration();
  (await reg?.getNotifications({ tag: REMIND_TAG }))?.forEach((n) => n.close());
}

const unreadableText = (names, total) => (names.length === 1
  ? `Fotku nebo video „${names[0]}“ se v telefonu nepodařilo přečíst.`
  : `${names.length} z ${total} fotek a videí se v telefonu nepodařilo přečíst.`);

let syncing = null;
const SEND_LOCK = 'zavady-outbox-odesilani';

/**
 * Odešle čekající závady. Při výpadku sítě skončí (zkusí se příště), jiné chyby (např. oprávnění)
 * si zapamatuje u položky, aby je uživatel viděl. Vrací počet odeslaných.
 * Aplikace může být otevřená ve víc oknech (na ploše i v kartě Chromu) a každé by frontu poslalo samo –
 * stejná závada by vznikla dvakrát (emulátor 4. 11.). Proto odesílá vždy jen jedno okno: když frontu
 * právě posílá jiné, tohle nic nedělá a zkusí to příště (to už najde odeslané).
 */
export function syncOutbox(api) {
  syncing ??= (navigator.locks
    ? navigator.locks.request(SEND_LOCK, { ifAvailable: true }, (lock) => (lock ? sendAll(api) : 0))
    : sendAll(api)
  ).finally(() => { syncing = null; });
  return syncing;
}

async function sendAll(api) {
  state = null; // příznaky (odesláno, chyby) mohlo mezitím změnit jiné okno – načíst znovu z localStorage
  let sent = 0;
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
  return sent;
}
