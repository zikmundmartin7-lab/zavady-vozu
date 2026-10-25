// DEMO režim: všechna data jen v tomto prohlížeči (localStorage, fotky a videa v IndexedDB).
// Rozhraní je stejné jako u Supabase (supabase.js), takže aplikace neví, s čím pracuje.
// Pravidla oprávnění jsou tu napodobena podle supabase/schema.sql.

import { can, checkDigit, checkFoundAt, compressImage, groupLabel, matchesQuery, uid } from '../model.js';

const KEY = 'zavady-demo-v2';
const USER_KEY = 'zavady-demo-user';

const GROUPS = [
  [1, 'Faccpp', 'Choper'], [2, 'Faccs', 'Sa'], [3, 'Ua'], [4, 'Fals', 'Vap'],
  [5, 'Uk, Gbgs', 'Trakce'], [6, 'Res, Smmp', 'Plošinové'], [7, 'Ostatní'],
].map(([id, name, slang = null]) => ({ id, name, slang, sort: id }));

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
    if (s?.version === 2) {
      // starší uložená ukázka: nové závady počítat až od teď
      const since = new Date().toISOString();
      s.profiles.forEach((p) => { p.news_since ??= since; });
      return { audit: [], schedules: [], seen: {}, ...s };
    }
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
const groupName = (id) => groupLabel(GROUPS.find((g) => g.id === id));
const findDefect = (id) => {
  const d = state.defects.find((x) => x.id === id);
  if (!d) throw new Error('Závada neexistuje (možná byla smazána).');
  return d;
};

// Historie změn a koš – napodobuje databázovou tabulku audit_log
let txSeq = Date.now();
const newTx = () => ++txSeq;
function audit(tx, tbl, action, oldRow, newRow) {
  const r = newRow ?? oldRow;
  const defectId = tbl === 'defects' ? r.id : ['comments', 'attachments'].includes(tbl) ? r.defect_id : null;
  const wagonId = tbl === 'wagons' ? r.id : tbl === 'defects' ? r.wagon_id
    : state.defects.find((d) => d.id === defectId)?.wagon_id ?? null;
  const m = me();
  state.audit.push({
    id: (state.audit.at(-1)?.id ?? 0) + 1, tx, at: new Date().toISOString(), actor: m?.id ?? null,
    actor_name: m?.full_name ?? null, tbl, row_id: r.id, action,
    old_row: oldRow ? { ...oldRow } : null, new_row: newRow ? { ...newRow } : null,
    wagon_id: wagonId, defect_id: defectId, restored_at: null,
  });
}
const STATE_KEY = { wagons: 'wagons', defects: 'defects', attachments: 'attachments', comments: 'comments' };
function removeRows(tx, tbl, rows) {
  for (const r of rows) audit(tx, tbl, 'delete', r, null);
  const ids = new Set(rows.map((r) => r.id));
  state[STATE_KEY[tbl]] = state[STATE_KEY[tbl]].filter((r) => !ids.has(r.id));
}

// Neopravené závady od ostatních vložené od poslední návštěvy vozu (jako group_overview.new_count)
function newCount(wagonIds) {
  const m = me();
  if (!m) return 0;
  return state.defects.filter((d) => wagonIds.includes(d.wagon_id) && !d.resolved_at && d.created_by !== m.id
    && d.created_at > (state.seen[`${m.id}|${d.wagon_id}`] ?? m.news_since)).length;
}

function wagonOverview(w) {
  const ds = state.defects.filter((d) => d.wagon_id === w.id);
  const open = ds.filter((d) => !d.resolved_at);
  return {
    ...w,
    last4: w.number.slice(-4),
    group_name: groupName(w.group_id),
    open_count: open.length,
    new_count: newCount([w.id]),
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

async function storeFiles(defectId, files, onProgress, tx = newTx()) {
  let i = 0;
  for (const file of files) {
    onProgress?.(++i, files.length);
    const blob = await compressImage(file);
    const id = uid();
    await idb('readwrite', (s) => s.put(blob, id));
    const att = {
      id, defect_id: defectId, path: id,
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      created_by: me().id, created_at: new Date().toISOString(),
    };
    state.attachments.push(att);
    audit(tx, 'attachments', 'insert', null, att);
  }
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
      new_count: newCount(state.wagons.filter((w) => w.group_id === g.id).map((w) => w.id)),
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
  async markWagonSeen(wagonId) {
    const m = requireMember();
    const key = `${m.id}|${wagonId}`;
    const prev = state.seen[key] ?? m.news_since;
    state.seen[key] = new Date().toISOString();
    persist(state); // bez živé aktualizace – jinak by se obrazovka znovu načítala dokola
    return prev;
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
    audit(newTx(), 'wagons', 'insert', null, w);
    commit();
    return wagonOverview(w);
  },
  async updateWagon(id, patch) {
    if (!can.admin(me())) throw new Error('Vůz může upravit jen správce.');
    const w = state.wagons.find((x) => x.id === id);
    const old = { ...w };
    Object.assign(w, patch);
    audit(newTx(), 'wagons', 'update', old, w);
    commit();
  },
  async deleteWagon(id) {
    if (!can.admin(me())) throw new Error('Vůz může smazat jen správce.');
    // smazané jde do koše (historie), fotky zůstávají, aby šlo vše obnovit
    const tx = newTx();
    const defects = state.defects.filter((d) => d.wagon_id === id);
    const ids = new Set(defects.map((d) => d.id));
    removeRows(tx, 'attachments', state.attachments.filter((a) => ids.has(a.defect_id)));
    removeRows(tx, 'comments', state.comments.filter((c) => ids.has(c.defect_id)));
    removeRows(tx, 'defects', defects);
    removeRows(tx, 'wagons', state.wagons.filter((w) => w.id === id));
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
    const tx = newTx();
    audit(tx, 'defects', 'insert', null, d);
    await storeFiles(d.id, files, onProgress, tx);
    commit({ newDefect: d, own: true });
    return d;
  },
  async updateDefect(id, { description, found_at, defect_code }, newFiles = [], removeIds = [], onProgress) {
    const d = findDefect(id);
    if (!can.edit(me(), d)) throw new Error('Závadu může upravit jen ten, kdo ji vložil, nebo správce.');
    if (!can.editDefect(me(), d)) throw new Error('Opravená závada je zamčená. Upravit ji může jen správce, nebo ji nejdřív vraťte mezi neopravené.');
    const problem = found_at && checkFoundAt(found_at, d.resolved_at);
    if (problem) throw new Error(problem);
    const tx = newTx();
    const old = { ...d };
    Object.assign(d, { description: description.trim(), defect_code: defect_code || null, updated_at: new Date().toISOString() });
    if (found_at) d.found_at = found_at;
    audit(tx, 'defects', 'update', old, d);
    removeRows(tx, 'attachments', state.attachments.filter((a) => removeIds.includes(a.id)));
    await storeFiles(id, newFiles, onProgress, tx);
    commit();
  },
  async deleteDefect(id) {
    const d = findDefect(id);
    if (!can.editDefect(me(), d)) {
      throw new Error(d.resolved_at ? 'Opravenou závadu může smazat jen správce.' : 'Závadu může smazat jen ten, kdo ji vložil, nebo správce.');
    }
    const tx = newTx();
    removeRows(tx, 'attachments', state.attachments.filter((a) => a.defect_id === id));
    removeRows(tx, 'comments', state.comments.filter((c) => c.defect_id === id));
    removeRows(tx, 'defects', [d]);
    commit();
  },
  async resolveDefect(id, note) {
    const d = findDefect(id);
    if (!can.resolve(me(), d)) throw new Error('Závadu může označit jako opravenou jen její autor, opravář nebo správce.');
    const old = { ...d };
    Object.assign(d, { resolved_at: new Date().toISOString(), resolved_by: me().id, resolution_note: note?.trim() || null });
    audit(newTx(), 'defects', 'update', old, d);
    commit();
  },
  async reopenDefect(id) {
    const d = findDefect(id);
    if (!can.resolve(me(), d)) throw new Error('Závadu může vrátit jen její autor, opravář nebo správce.');
    const old = { ...d };
    Object.assign(d, { resolved_at: null, resolved_by: null, resolution_note: null });
    audit(newTx(), 'defects', 'update', old, d);
    commit();
  },

  // Katalog kódů a předpisy
  async listCodes() { return DEMO_CODES; },
  async listRegulations() { return []; },
  async listCodeImages() { return new Map(); },
  async uploadCodeImages() { throw new Error('V ukázkovém režimu nelze nahrávat obrázky katalogu.'); },
  async addRegulation() { throw new Error('V ukázkovém režimu nelze nahrávat předpisy.'); },
  async deleteRegulation() { throw new Error('V ukázkovém režimu nelze mazat předpisy.'); },

  // Přehled závad napříč vozy
  async listOverview(status = 'open') {
    requireMember();
    const rows = state.defects
      .filter((d) => (status === 'open' ? !d.resolved_at : status === 'resolved' ? !!d.resolved_at : true))
      .map((d) => {
        const w = state.wagons.find((x) => x.id === d.wagon_id);
        return {
          ...d, created_by_name: nameOf(d.created_by), resolved_by_name: d.resolved_by ? nameOf(d.resolved_by) : null,
          comment_count: state.comments.filter((c) => c.defect_id === d.id).length,
          attachment_count: state.attachments.filter((a) => a.defect_id === d.id).length,
          number: w?.number ?? '', group_id: w?.group_id, group_name: groupName(w?.group_id),
        };
      });
    return rows.sort((a, b) => (b.found_at ?? b.created_at).localeCompare(a.found_at ?? a.created_at));
  },

  // Všechna data najednou pro stahování na pozadí (offline.js)
  async snapshot() {
    requireMember();
    const open = new Set(state.defects.filter((d) => !d.resolved_at).map((d) => d.id));
    return {
      groups: await api.listGroups(),
      wagons: state.wagons.map(wagonOverview),
      defects: await Promise.all(state.defects.map(defectFeed)),
      comments: state.comments.filter((c) => open.has(c.defect_id))
        .map((c) => ({ ...c, author_name: nameOf(c.author_id) }))
        .sort((x, y) => x.created_at.localeCompare(y.created_at)),
      overview: await api.listOverview('all'),
    };
  },

  // Historie změn a koš
  async listHistory(defectId) {
    requireMember();
    return state.audit.filter((a) => a.defect_id === defectId);
  },
  async listAudit(limit = 300) {
    requireMember();
    return state.audit.slice(-limit).reverse();
  },
  async listTrash() {
    requireMember();
    return state.audit.filter((a) => a.action === 'delete' && !a.restored_at).reverse();
  },
  async restoreDeleted(tx) {
    if (!can.admin(me())) throw new Error('Obnovit smazané záznamy může jen správce.');
    const order = { wagons: 1, defects: 2 };
    const items = state.audit.filter((a) => a.tx === tx && a.action === 'delete' && !a.restored_at)
      .sort((a, b) => (order[a.tbl] ?? 4) - (order[b.tbl] ?? 4) || a.id - b.id);
    const rtx = newTx();
    for (const a of items) {
      const list = state[STATE_KEY[a.tbl]];
      const parentMissing = (a.tbl === 'defects' && !state.wagons.some((w) => w.id === a.old_row.wagon_id))
        || (['comments', 'attachments'].includes(a.tbl) && !state.defects.some((d) => d.id === a.old_row.defect_id));
      if (parentMissing) throw new Error('Nelze obnovit: nadřazený záznam (vůz nebo závada) je také smazaný. Obnovte nejdřív ten.');
      if (!list.some((r) => r.id === a.row_id)) list.push({ ...a.old_row });
      a.restored_at = new Date().toISOString();
      audit(rtx, a.tbl, 'restore', null, a.old_row);
    }
    commit();
    return items.length;
  },
  async listWagonNumbers() {
    return new Map([...state.wagons, ...state.audit.filter((a) => a.tbl === 'wagons' && a.old_row).map((a) => a.old_row)]
      .map((w) => [w.id, w.number]));
  },

  // Pravidelné exporty (v ukázce se jen ukládají, nerozesílají)
  async listExportSchedules() {
    if (!can.admin(me())) throw new Error('Jen pro správce.');
    return state.schedules;
  },
  async saveExportSchedule({ id, ...fields }) {
    if (!can.admin(me())) throw new Error('Jen pro správce.');
    if (id) Object.assign(state.schedules.find((x) => x.id === id), fields);
    else state.schedules.push({ id: uid(), created_at: new Date().toISOString(), last_sent_at: null, active: true, ...fields });
    commit();
  },
  async deleteExportSchedule(id) {
    if (!can.admin(me())) throw new Error('Jen pro správce.');
    state.schedules = state.schedules.filter((x) => x.id !== id);
    commit();
  },

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
    const c = { id: uid(), defect_id: defectId, author_id: m.id, body: body.trim(), created_at: new Date().toISOString() };
    state.comments.push(c);
    audit(newTx(), 'comments', 'insert', null, c);
    commit({ comment: defectId });
  },
  async deleteComment(id) {
    const c = state.comments.find((x) => x.id === id);
    if (!can.deleteComment(me(), c)) throw new Error('Komentář může smazat jen autor nebo správce.');
    removeRows(newTx(), 'comments', [c]);
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
    const p = state.profiles.find((x) => x.id === id);
    const old = { ...p };
    p.role = role;
    audit(newTx(), 'profiles', 'update', old, p);
    commit();
  },
  async createUser({ email, fullName, role, password }) {
    if (!can.admin(me())) throw new Error('Účty zakládá jen správce.');
    const mail = email.trim().toLowerCase();
    if (!fullName.trim()) throw new Error('Vyplňte jméno a příjmení.');
    if (password.length < 6) throw new Error('Heslo musí mít alespoň 6 znaků.');
    if (state.profiles.some((p) => p.email.toLowerCase() === mail)) {
      throw new Error('Účet s tímto e-mailem už existuje – najdete ho v seznamu uživatelů.');
    }
    // V demu se heslo nikde neověřuje (přihlašuje se výběrem uživatele), jen se zapamatuje příznak.
    const p = { id: `u-${uid()}`, email: mail, full_name: fullName.trim(), role, temp_password: true };
    state.profiles.push(p);
    audit(newTx(), 'profiles', 'insert', null, p);
    commit();
    return { id: p.id };
  },
  async updatePassword(password) {
    if (password.length < 6) throw new Error('Heslo musí mít alespoň 6 znaků.');
    me().temp_password = false;
    commit({ auth: true });
  },
  async updateMyName(full_name) {
    me().full_name = full_name.trim();
    commit({ auth: true });
  },

  // Upozornění: v demu jen lokálně v tomto prohlížeči
  push: {
    supported: () => 'Notification' in window,
    async status() { return 'Notification' in window && Notification.permission === 'granted' ? 'on' : 'off'; },
    permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    async resume() { return api.push.status(); },
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
  // Nové závady (odznak „nové“) se v ukázce počítají za poslední 3 dny
  const since = new Date(now - 3 * 864e5).toISOString();
  profiles.forEach((p) => { p.news_since = since; });
  return { version: 2, profiles, wagons, defects, attachments: [], comments, audit: [], schedules: [], seen: {} };
}
