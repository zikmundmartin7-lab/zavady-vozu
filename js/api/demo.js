// DEMO režim: všechna data jen v tomto prohlížeči (localStorage, fotky a videa v IndexedDB).
// Rozhraní je stejné jako u Supabase (supabase.js), takže aplikace neví, s čím pracuje.
// Pravidla oprávnění jsou tu napodobena podle supabase/schema.sql.

import { can, checkDigit, checkFoundAt, compressImage, matchesQuery, uid } from '../model.js';

const KEY = 'zavady-demo-v2';
const USER_KEY = 'zavady-demo-user';

const GROUPS = [
  [1, 'Chopry'], [2, 'SA'], [3, 'UA'], [4, 'Vapy/Fals'],
  [5, 'Trakce/Zetky'], [6, 'Plošiňáky/Res/Smmp'], [7, 'Ostatní'],
].map(([id, name]) => ({ id, name, sort: id }));

// Ukázkový katalog: jen pár vymyšlených kódů (skutečný katalog přílohy 9 VSP je jen v ostré verzi)
const c = (kod, cesta, popis = '', opatreni = '', trida = '', kontext = '') =>
  ({ kod, cesta, cast_vozu: cesta.split(' › ').at(-1), kontext, popis, poznamka: '', opatreni, trida, strana: null });
const DEMO_CODES = [
  c('1', 'Pojezd'),
  c('1.1', 'Pojezd › Kolo', 'Opotřebení kola (ukázka)'),
  c('1.1.1', 'Pojezd › Kolo', '– ploché místo na jízdní ploše', 'Vyřadit (A)', '4', 'Opotřebení kola (ukázka)'),
  c('1.1.2', 'Pojezd › Kolo', '– trhlina na kole', 'Vyřadit (A)', '5', 'Opotřebení kola (ukázka)'),
  c('2', 'Vypružení'),
  c('2.1', 'Vypružení › Listová pružnice', 'Poškozená pružnice (ukázka)'),
  c('2.1.1', 'Vypružení › Listová pružnice', '– prasklý list pružnice', 'K', '4', 'Poškozená pružnice (ukázka)'),
  c('3', 'Brzda'),
  c('3.1', 'Brzda › Brzdový špalík', 'Opotřebený brzdový špalík (ukázka)'),
  c('3.1.1', 'Brzda › Brzdový špalík', '– tloušťka pod limitem', 'K + R1', '3', 'Opotřebený brzdový špalík (ukázka)'),
  c('3.2', 'Brzda › Ruční brzda', 'Ruční brzda nefunkční (ukázka)', 'R1', '3'),
  c('5', 'Táhlové a narážecí ústrojí'),
  c('5.1', 'Táhlové a narážecí ústrojí › Nárazník', 'Poškozený nárazník (ukázka)', 'K', '4'),
  c('6', 'Vozová skříň'),
  c('6.1', 'Vozová skříň › Podlaha', 'Poškozená podlaha (ukázka)', 'K', '3'),
  c('6.10', 'Vozová skříň › Výsypná klapka', 'Klapka nejde uzavřít (ukázka)', 'K', '4'),
  c('6.10.1', 'Vozová skříň › Výsypná klapka', '– chybí zajištění klapky', 'K', '3', 'Klapka nejde uzavřít (ukázka)'),
].map((x, i) => ({ ...x, poradi: i + 1 }));

const listeners = new Set();
let state = load();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.version === 2) return s;
  } catch { /* poškozená data → nová ukázka */ }
  const s = seed();
  persist(s);
  return s;
}

function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('Demo: nelze uložit', e); }
}

function commit(event = {}) {
  persist(state);
  listeners.forEach((fn) => fn(event));
}

// Změny z jiné karty prohlížeče (např. jiný demo uživatel) – simulace živých aktualizací.
addEventListener('storage', (e) => {
  if (e.key !== KEY || !e.newValue) return;
  const before = new Set(state.defects.map((d) => d.id));
  state = JSON.parse(e.newValue);
  const added = state.defects.filter((d) => !before.has(d.id));
  listeners.forEach((fn) => fn({ newDefect: added[0] ?? null }));
});

// ───── Soubory v IndexedDB ─────

let dbPromise;
function idb(mode, fn) {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open('zavady-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbPromise.then((db) => new Promise((res, rej) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  }));
}
const urlCache = new Map();
async function fileUrl(id) {
  if (!urlCache.has(id)) {
    const blob = await idb('readonly', (s) => s.get(id)).catch(() => null);
    urlCache.set(id, blob ? URL.createObjectURL(blob) : '');
  }
  return urlCache.get(id);
}

// ───── Pomocné ─────

const me = () => {
  const id = sessionStorage.getItem(USER_KEY) ?? localStorage.getItem(USER_KEY);
  return state.profiles.find((p) => p.id === id) ?? null;
};
const requireMember = () => {
  const m = me();
  if (!can.use(m)) throw new Error('Nemáte oprávnění.');
  return m;
};
const nameOf = (id) => state.profiles.find((p) => p.id === id)?.full_name ?? 'Neznámý uživatel';
const groupName = (id) => GROUPS.find((g) => g.id === id)?.name ?? '';
const findDefect = (id) => {
  const d = state.defects.find((x) => x.id === id);
  if (!d) throw new Error('Závada neexistuje (možná byla smazána).');
  return d;
};

function wagonOverview(w) {
  const ds = state.defects.filter((d) => d.wagon_id === w.id);
  const open = ds.filter((d) => !d.resolved_at);
  return {
    ...w,
    last4: w.number.slice(-4),
    group_name: groupName(w.group_id),
    open_count: open.length,
    resolved_count: ds.length - open.length,
    last_defect_at: ds.map((d) => d.created_at).sort().at(-1) ?? null,
  };
}

const byUrgency = (a, b) => b.open_count - a.open_count || a.number.localeCompare(b.number);

async function defectFeed(d) {
  const atts = state.attachments.filter((a) => a.defect_id === d.id);
  return {
    ...d,
    created_by_name: nameOf(d.created_by),
    resolved_by_name: d.resolved_by ? nameOf(d.resolved_by) : null,
    comment_count: state.comments.filter((c) => c.defect_id === d.id).length,
    attachments: await Promise.all(atts.map(async (a) => ({ ...a, url: await fileUrl(a.id) }))),
  };
}

async function storeFiles(defectId, files, onProgress) {
  let i = 0;
  for (const file of files) {
    onProgress?.(++i, files.length);
    const blob = await compressImage(file);
    const id = uid();
    await idb('readwrite', (s) => s.put(blob, id));
    state.attachments.push({
      id, defect_id: defectId, path: id,
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      created_by: me().id, created_at: new Date().toISOString(),
    });
  }
}

async function removeFiles(attachmentIds) {
  for (const id of attachmentIds) {
    await idb('readwrite', (s) => s.delete(id)).catch(() => {});
    URL.revokeObjectURL(urlCache.get(id) ?? '');
    urlCache.delete(id);
  }
  state.attachments = state.attachments.filter((a) => !attachmentIds.includes(a.id));
}

// ───── Rozhraní ─────

export const api = {
  mode: 'demo',

  // Přihlášení
  async getProfile() { return me(); },
  onAuthChange(cb) {
    const fn = (e) => e.auth && cb();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  demoUsers: () => state.profiles,
  async signInAs(id) {
    sessionStorage.setItem(USER_KEY, id);
    localStorage.setItem(USER_KEY, id);
    listeners.forEach((fn) => fn({ auth: true }));
  },
  async signOut() {
    sessionStorage.removeItem(USER_KEY);
    localStorage.removeItem(USER_KEY);
    listeners.forEach((fn) => fn({ auth: true }));
  },
  async resetDemo() {
    await idb('readwrite', (s) => s.clear()).catch(() => {});
    urlCache.clear();
    state = seed();
    commit({ auth: true });
  },

  // Skupiny a vozy
  async listGroups() {
    requireMember();
    return GROUPS.map((g) => ({
      ...g,
      open_count: state.defects.filter((d) => !d.resolved_at
        && state.wagons.find((w) => w.id === d.wagon_id)?.group_id === g.id).length,
    }));
  },
  async searchWagons(q, groupId) {
    requireMember();
    return state.wagons
      .filter((w) => (!groupId || w.group_id === groupId) && matchesQuery(w.number, q))
      .map(wagonOverview).sort(byUrgency).slice(0, 50);
  },
  async listWagons(groupId) {
    requireMember();
    return state.wagons.filter((w) => w.group_id === groupId).map(wagonOverview).sort(byUrgency);
  },
  async getWagon(id) {
    requireMember();
    const w = state.wagons.find((x) => x.id === id);
    return w ? wagonOverview(w) : null;
  },
  async findWagon(number) {
    requireMember();
    const w = state.wagons.find((x) => x.number === number);
    return w ? wagonOverview(w) : null;
  },
  async createWagon(number, groupId) {
    const m = requireMember();
    if (state.wagons.some((w) => w.number === number)) throw new Error('Vůz s tímto číslem už existuje.');
    const w = { id: uid(), number, group_id: groupId, note: null, created_by: m.id, created_at: new Date().toISOString() };
    state.wagons.push(w);
    commit();
    return wagonOverview(w);
  },
  async updateWagon(id, patch) {
    if (!can.admin(me())) throw new Error('Vůz může upravit jen správce.');
    Object.assign(state.wagons.find((w) => w.id === id), patch);
    commit();
  },
  async deleteWagon(id) {
    if (!can.admin(me())) throw new Error('Vůz může smazat jen správce.');
    const defectIds = state.defects.filter((d) => d.wagon_id === id).map((d) => d.id);
    await removeFiles(state.attachments.filter((a) => defectIds.includes(a.defect_id)).map((a) => a.id));
    state.comments = state.comments.filter((c) => !defectIds.includes(c.defect_id));
    state.defects = state.defects.filter((d) => d.wagon_id !== id);
    state.wagons = state.wagons.filter((w) => w.id !== id);
    commit();
  },

  // Závady
  async listDefects(wagonId) {
    requireMember();
    return Promise.all(state.defects.filter((d) => d.wagon_id === wagonId).map(defectFeed));
  },
  async getDefect(id) {
    requireMember();
    const d = state.defects.find((x) => x.id === id);
    return d ? defectFeed(d) : null;
  },
  async createDefect({ wagon_id, description, found_at, defect_code }, files = [], onProgress) {
    const m = requireMember();
    const now = new Date().toISOString();
    const problem = found_at && checkFoundAt(found_at);
    if (problem) throw new Error(problem);
    const d = {
      id: uid(), wagon_id, description: description.trim(), found_at: found_at ?? now, defect_code: defect_code || null,
      created_by: m.id, created_at: now, updated_at: null,
      resolved_at: null, resolved_by: null, resolution_note: null,
    };
    state.defects.push(d);
    await storeFiles(d.id, files, onProgress);
    commit({ newDefect: d, own: true });
    return d;
  },
  async updateDefect(id, { description, found_at, defect_code }, newFiles = [], removeIds = [], onProgress) {
    const d = findDefect(id);
    if (!can.edit(me(), d)) throw new Error('Závadu může upravit jen ten, kdo ji vložil, nebo správce.');
    const problem = found_at && checkFoundAt(found_at, d.resolved_at);
    if (problem) throw new Error(problem);
    Object.assign(d, { description: description.trim(), defect_code: defect_code || null, updated_at: new Date().toISOString() });
    if (found_at) d.found_at = found_at;
    await removeFiles(removeIds);
    await storeFiles(id, newFiles, onProgress);
    commit();
  },
  async deleteDefect(id) {
    const d = findDefect(id);
    if (!can.edit(me(), d)) throw new Error('Závadu může smazat jen ten, kdo ji vložil, nebo správce.');
    await removeFiles(state.attachments.filter((a) => a.defect_id === id).map((a) => a.id));
    state.comments = state.comments.filter((c) => c.defect_id !== id);
    state.defects = state.defects.filter((x) => x.id !== id);
    commit();
  },
  async resolveDefect(id, note) {
    if (!can.resolve(me(), findDefect(id))) throw new Error('Závadu může označit jako opravenou jen její autor, opravář nebo správce.');
    Object.assign(findDefect(id), {
      resolved_at: new Date().toISOString(), resolved_by: me().id, resolution_note: note?.trim() || null,
    });
    commit();
  },
  async reopenDefect(id) {
    if (!can.resolve(me(), findDefect(id))) throw new Error('Závadu může vrátit jen její autor, opravář nebo správce.');
    Object.assign(findDefect(id), { resolved_at: null, resolved_by: null, resolution_note: null });
    commit();
  },

  // Katalog kódů a předpisy
  async listCodes() { return DEMO_CODES; },
  async listRegulations() { return []; },
  async addRegulation() { throw new Error('V ukázkovém režimu nelze nahrávat předpisy.'); },
  async deleteRegulation() { throw new Error('V ukázkovém režimu nelze mazat předpisy.'); },

  // Komentáře
  async listComments(defectId) {
    requireMember();
    return state.comments.filter((c) => c.defect_id === defectId)
      .map((c) => ({ ...c, author_name: nameOf(c.author_id) }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async addComment(defectId, body) {
    const m = requireMember();
    findDefect(defectId);
    state.comments.push({ id: uid(), defect_id: defectId, author_id: m.id, body: body.trim(), created_at: new Date().toISOString() });
    commit({ comment: defectId });
  },
  async deleteComment(id) {
    const c = state.comments.find((x) => x.id === id);
    if (!can.deleteComment(me(), c)) throw new Error('Komentář může smazat jen autor nebo správce.');
    state.comments = state.comments.filter((x) => x.id !== id);
    commit({ comment: c.defect_id });
  },

  // Živé aktualizace: cb({ newDefect }) při jakékoli změně
  subscribeChanges(cb) {
    const fn = (e) => !e.auth && cb({ newDefect: e.own ? null : e.newDefect ?? null });
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  subscribeComments(defectId, cb) {
    const fn = (e) => !e.auth && cb();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // Uživatelé
  async listProfiles() {
    requireMember();
    return [...state.profiles].sort((a, b) => a.full_name.localeCompare(b.full_name, 'cs'));
  },
  async setRole(id, role) {
    const m = me();
    if (!can.admin(m)) throw new Error('Roli může změnit jen správce.');
    if (id === m.id && role !== 'admin') throw new Error('Správce si nemůže odebrat vlastní roli.');
    state.profiles.find((p) => p.id === id).role = role;
    commit();
  },
  async updateMyName(full_name) {
    me().full_name = full_name.trim();
    commit({ auth: true });
  },

  // Upozornění: v demu jen lokálně v tomto prohlížeči
  push: {
    supported: () => 'Notification' in window,
    async status() { return 'Notification' in window && Notification.permission === 'granted' ? 'on' : 'off'; },
    async enable() {
      const p = await Notification.requestPermission();
      if (p !== 'granted') throw new Error('Upozornění nejsou povolená v nastavení prohlížeče.');
    },
    async test() {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) throw new Error('Tento prohlížeč neumí zobrazit upozornění.');
      await reg.showNotification('Zkušební upozornění', { body: 'Upozornění na nové závady fungují.', icon: 'icons/icon-192.png' });
      return 1;
    },
    async disable() { /* v demu nelze odvolat – stačí zakázat v prohlížeči */ },
  },
};

// ───── Ukázková data ─────

function seed() {
  let s = 20261016;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = Date.now();
  const ago = (days) => new Date(now - days * 864e5 - rnd() * 6 * 36e5).toISOString();

  const profiles = [
    { id: 'u-spravce', email: 'spravce@demo.cz', full_name: 'Petr Novák', role: 'admin' },
    { id: 'u-opravar', email: 'opravar@demo.cz', full_name: 'Tomáš Horák', role: 'repairer' },
    { id: 'u-uzivatel', email: 'uzivatel@demo.cz', full_name: 'Eva Svobodová', role: 'user' },
    { id: 'u-novy', email: 'novy@demo.cz', full_name: 'Karel Dvořák', role: 'pending' },
  ];
  const reporters = ['u-spravce', 'u-opravar', 'u-uzivatel', 'u-uzivatel'];

  // Typové kódy (prvních 7 číslic) podle skupiny – jen pro realistický vzhled.
  const prefixes = { 1: '3354695', 2: '3154398', 3: '3354490', 4: '3381665', 5: '3354786', 6: '3154397', 7: '3354245' };
  // Několik sériových čísel se schválně podobá, aby bylo vidět vyhledávání podle čtyřčíslí.
  // (poslední čtyřčíslí = poslední 3 číslice sériového čísla + kontrolní číslice)
  const serials = ['1017', '2017', '6017', '1018', '3019', '4350', '5350', '7442', '8442', '2510', '6631', '9012'];

  const wagons = [];
  for (const g of GROUPS) {
    for (let i = 0; i < 6; i++) {
      const first11 = prefixes[g.id] + (rnd() < 0.5 ? pick(serials) : String(Math.floor(rnd() * 1e4)).padStart(4, '0'));
      const number = first11 + checkDigit(first11 + '0');
      if (wagons.some((w) => w.number === number)) continue;
      wagons.push({ id: uid(), number, group_id: g.id, note: null, created_by: 'u-spravce', created_at: ago(60) });
    }
  }

  const texts = [
    'Prasklá listová pružnice, 2. dvojkolí.',
    'Netěsný brzdový válec – uniká vzduch, slyšet syčení.',
    'Ohnuté madlo posunovače, levá strana.',
    'Brzdové špalíky opotřebené pod limit.',
    'Výsypná klapka nejde úplně uzavřít.',
    'Chybí plomba na výpustném ventilu.',
    'Vylomená podlahová deska u čela vozu.',
    'Nefunkční ruční brzda.',
    'Prasklina na nárazníkovém pouzdře.',
    'Uvolněné šroubovkové spřáhlo.',
    'Plochá místa na kole, 1. dvojkolí.',
    'Netěsná hadice brzdového potrubí.',
    'Zkřivená klanice, pravá strana.',
    'Ložisko hřeje – zvýšená teplota po jízdě.',
    'Prasklý svar na čelníku.',
    'Rozvaděč nereaguje na odbrzdění.',
  ];
  const chat = [
    'Nahlášeno dispečinku.', 'Díl je objednaný, měl by dorazit ve čtvrtek.', 'Vůz odstaven na 12. koleji.',
    'Beru to, podívám se na to po obědě.', 'Můžeš poslat ještě fotku z druhé strany?', 'Hotovo, zkontrolováno.',
    'Pozor, je to na trati do Kolína – odvěs prosím co nejdřív.', 'Díky!',
  ];

  const defects = [];
  const comments = [];
  for (const w of wagons) {
    if (rnd() < 0.35) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const created = ago(1 + rnd() * 40);
      const resolved = rnd() < 0.35;
      const d = {
        id: uid(), wagon_id: w.id, description: pick(texts),
        defect_code: rnd() < 0.5 ? pick(DEMO_CODES.filter((x) => x.opatreni)).kod : null,
        // část závad zapsána zpětně (zjištěno o několik hodin dřív)
        found_at: rnd() < 0.25 ? new Date(Date.parse(created) - (2 + rnd() * 20) * 36e5).toISOString() : created,
        created_by: pick(reporters), created_at: created, updated_at: null,
        resolved_at: resolved ? new Date(Date.parse(created) + (1 + rnd() * 5) * 864e5).toISOString() : null,
        resolved_by: resolved ? 'u-opravar' : null,
        resolution_note: resolved && rnd() < 0.6 ? 'Vyměněno, zkouška brzdy OK.' : null,
      };
      if (d.resolved_at && d.resolved_at > new Date(now).toISOString()) d.resolved_at = new Date(now - 36e5).toISOString();
      defects.push(d);
      const k = Math.floor(rnd() * 4);
      for (let j = 0; j < k; j++) {
        comments.push({
          id: uid(), defect_id: d.id, author_id: pick(profiles.slice(0, 3)).id, body: pick(chat),
          created_at: new Date(Math.min(now - (k - j) * 6e5, Date.parse(created) + (j + 1) * (2 + rnd() * 10) * 36e5)).toISOString(),
        });
      }
    }
  }
  return { version: 2, profiles, wagons, defects, attachments: [], comments };
}
