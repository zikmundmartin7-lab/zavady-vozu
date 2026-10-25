// Ostrý režim: data v Supabase (databáze Postgres, přihlášení, úložiště souborů, živé změny).
// Oprávnění hlídá databáze (supabase/schema.sql), aplikace je jen zobrazuje.

import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from '../config.js';
import { IMAGE_NAME } from '../codes.js';
import { DEFAULT_PASSWORD, compressImage, groupLabel, uid } from '../model.js';

// Knihovnu načítá už index.html (souběžně s ostatními soubory); tady jen záložně, kdyby chyběla.
if (!window.supabase) {
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/supabase.js', import.meta.url).href;
    s.onload = res;
    s.onerror = () => rej(new Error('Nepodařilo se načíst knihovnu Supabase.'));
    document.head.append(s);
  });
}

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = 'attachments';
const REG_BUCKET = 'predpisy';
const IMG_BUCKET = 'katalog';
const IMG_DIR = 'obrazky';
let catalogPromise = null;
let imagesPromise = null;
let imagesAt = 0;
const appUrl = () => location.origin + location.pathname;

const MESSAGES = [
  [/invalid login credentials/i, 'Nesprávný e-mail nebo heslo.'],
  [/email not confirmed/i, 'E-mail ještě není potvrzený – klikněte na odkaz, který vám přišel.'],
  [/already registered/i, 'Účet s tímto e-mailem už existuje.'],
  [/password should be at least/i, 'Heslo musí mít alespoň 6 znaků.'],
  [/should be different from the old/i, 'Nové heslo musí být jiné než současné.'],
  [/wagons_number_key/i, 'Vůz s tímto číslem už existuje.'],
  [/rate limit/i, 'Příliš mnoho pokusů, zkuste to za chvíli.'],
  [/failed to fetch|load failed|network/i, 'Chyba připojení k internetu.'],
  [/row-level security/i, 'Nemáte oprávnění.'],
];
function fail(error) {
  const msg = error?.message ?? String(error);
  const hit = MESSAGES.find(([re]) => re.test(msg));
  const err = new Error(hit ? hit[1] : msg);
  // výpadek sítě → aplikace může závadu uložit do fronty a odeslat později
  err.network = !navigator.onLine || /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(msg);
  throw err;
}
const check = ({ data, error }) => (error ? fail(error) : data);

async function currentUserId() {
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

// Odběr upozornění v tomto telefonu (povolení už musí být udělené) → uložit k přihlášenému uživateli
async function subscribePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) });
  check(await sb.from('push_subscriptions').upsert({
    endpoint: sub.endpoint, subscription: sub.toJSON(), user_id: await currentUserId(),
  }));
}

// Podepsané odkazy na soubory (platí hodinu); po částech, ať dotaz nepřeroste
async function signedUrls(paths) {
  const urls = new Map();
  for (let i = 0; i < paths.length; i += 500) {
    const signed = check(await sb.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 500), 3600));
    for (const s of signed) urls.set(s.path, s.signedUrl);
  }
  return urls;
}

function attachUrls(defects, atts, urls) {
  return defects.map((d) => ({
    ...d,
    attachments: atts.filter((a) => a.defect_id === d.id).map((a) => ({ ...a, url: urls.get(a.path) ?? '' })),
  }));
}

async function withUrls(defects) {
  const ids = defects.map((d) => d.id);
  const atts = ids.length
    ? check(await sb.from('attachments').select('*').in('defect_id', ids).order('created_at'))
    : [];
  return attachUrls(defects, atts, await signedUrls(atts.map((a) => a.path)));
}

// Řádek přehledu závad: závada + číslo vozu, skupina a počet příloh
function overviewRows(defects, wagons, groups, atts) {
  const wagonMap = new Map(wagons.map((w) => [w.id, w]));
  const groupMap = new Map(groups.map((g) => [g.id, groupLabel(g)]));
  const attCount = new Map();
  for (const a of atts) attCount.set(a.defect_id, (attCount.get(a.defect_id) ?? 0) + 1);
  return defects.map(({ attachments, ...d }) => {
    const w = wagonMap.get(d.wagon_id);
    return { ...d, number: w?.number ?? '', group_id: w?.group_id, group_name: groupMap.get(w?.group_id) ?? '',
      attachment_count: attCount.get(d.id) ?? 0 };
  });
}

async function uploadFiles(defectId, files, onProgress) {
  let i = 0;
  for (const file of files) {
    onProgress?.(++i, files.length);
    const blob = await compressImage(file);
    const ext = (blob.name?.split('.').pop() || (blob.type.split('/')[1] ?? 'bin')).toLowerCase();
    const path = `${defectId}/${uid()}.${ext}`;
    check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type }));
    check(await sb.from('attachments').insert({
      defect_id: defectId, path, kind: file.type.startsWith('video/') ? 'video' : 'image',
    }));
  }
}

// Načte všechny řádky po stránkách (Supabase vrací nejvýš 1000 řádků na dotaz)
async function fetchAll(build, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = check(await build().range(from, from + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function base64UrlToBytes(s) {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export const api = {
  mode: 'supabase',

  // Přihlášení
  async getProfile() {
    const { data } = await sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const p = check(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
    // temp_password: účet založil správce (funkce create-user) a heslo zatím nikdo nezměnil
    return { ...(p ?? { id: user.id, email: '', full_name: '', role: 'pending' }), temp_password: user.user_metadata?.temp_password === true };
  },
  onAuthChange(cb) {
    const { data } = sb.auth.onAuthStateChange((event) => setTimeout(() => cb(event), 0));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    check(await sb.auth.signInWithPassword({ email, password }));
  },
  async signUp(email, password, fullName) {
    const r = check(await sb.auth.signUp({
      email, password, options: { data: { full_name: fullName.trim(), temp_password: password === DEFAULT_PASSWORD }, emailRedirectTo: appUrl() },
    }));
    // Správcům přijde upozornění, že nový uživatel čeká na schválení (jde jen s přihlášením hned po registraci)
    if (r.session) sb.functions.invoke('notify-new-defect', { body: { new_user: true } }).catch(() => {});
    return { needsConfirmation: !r.session };
  },
  async resetPassword(email) {
    check(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() }));
  },
  async updatePassword(password) {
    check(await sb.auth.updateUser({ password, data: { temp_password: false } }));
  },
  async signOut() {
    await api.push.disable().catch(() => {});
    await sb.auth.signOut();
  },

  // Skupiny a vozy
  async listGroups() {
    return check(await sb.from('group_overview').select('*').order('sort'));
  },
  async searchWagons(q, groupId) {
    let query = sb.from('wagon_overview').select('*');
    query = q.length <= 4 ? query.like('last4', `${q}%`) : query.like('number', `%${q}%`);
    if (groupId) query = query.eq('group_id', groupId);
    return check(await query
      .order('open_count', { ascending: false }).order('number').limit(50));
  },
  async listWagons(groupId) {
    return check(await sb.from('wagon_overview').select('*').eq('group_id', groupId)
      .order('open_count', { ascending: false }).order('number'));
  },
  async getWagon(id) {
    return check(await sb.from('wagon_overview').select('*').eq('id', id).maybeSingle());
  },
  // Otevření vozu = jeho závady jsou prohlédnuté; vrací čas předchozí návštěvy (pro štítek „Nová“)
  async markWagonSeen(wagonId) {
    return check(await sb.rpc('mark_wagon_seen', { p_wagon: wagonId }));
  },
  async findWagon(number) {
    return check(await sb.from('wagon_overview').select('*').eq('number', number).maybeSingle());
  },
  async createWagon(number, groupId) {
    const w = check(await sb.from('wagons')
      .insert({ number, group_id: groupId, created_by: await currentUserId() }).select('id').single());
    return api.getWagon(w.id);
  },
  async updateWagon(id, patch) {
    check(await sb.from('wagons').update(patch).eq('id', id));
  },
  // Smazané záznamy jdou do koše (historie v databázi), soubory se nemažou, aby šly obnovit
  async deleteWagon(id) {
    check(await sb.from('wagons').delete().eq('id', id));
  },

  // Závady
  async listDefects(wagonId) {
    return withUrls(check(await sb.from('defect_feed').select('*').eq('wagon_id', wagonId)));
  },
  async getDefect(id) {
    const d = check(await sb.from('defect_feed').select('*').eq('id', id).maybeSingle());
    return d ? (await withUrls([d]))[0] : null;
  },
  async createDefect({ wagon_id, description, found_at, defect_code }, files = [], onProgress) {
    const d = check(await sb.from('defects').insert({
      wagon_id, description: description.trim(), found_at, defect_code: defect_code || null,
      created_by: await currentUserId(),
    }).select().single());
    await uploadFiles(d.id, files, onProgress);
    // Rozeslání upozornění ostatním (Edge Function notify-new-defect). Chyba nevadí – závada je uložená.
    sb.functions.invoke('notify-new-defect', { body: { defect_id: d.id } }).catch(() => {});
    return d;
  },
  async updateDefect(id, { description, found_at, defect_code }, newFiles = [], removeIds = [], onProgress) {
    const patch = { description: description.trim(), defect_code: defect_code || null, ...(found_at ? { found_at } : {}) };
    check(await sb.from('defects').update(patch).eq('id', id));
    if (removeIds.length) check(await sb.from('attachments').delete().in('id', removeIds));
    await uploadFiles(id, newFiles, onProgress);
  },
  async deleteDefect(id) {
    check(await sb.from('defects').delete().eq('id', id));
  },
  async resolveDefect(id, note) {
    check(await sb.from('defects')
      .update({ resolved_at: new Date().toISOString(), resolution_note: note?.trim() || null }).eq('id', id));
  },
  async reopenDefect(id) {
    check(await sb.from('defects').update({ resolved_at: null, resolution_note: null }).eq('id', id));
  },

  // Katalog kódů závad (příloha 9 VSP) – načte se jednou za spuštění aplikace
  listCodes() {
    catalogPromise ??= sb.from('defect_codes')
      .select('kod, poradi, cast_vozu, cesta, kontext, popis, poznamka, opatreni, trida, strana')
      .order('poradi').limit(5000)
      .then(check)
      // prázdný výsledek (např. před přihlášením) si nepamatovat – příště se načte znovu
      .then((rows) => { if (!rows.length) catalogPromise = null; return rows; })
      .catch((e) => { catalogPromise = null; throw e; });
    return catalogPromise;
  },

  // Obrázky z katalogu (soukromé úložiště „katalog“): Map kód → [{ id, kind, url }], odkazy platí hodinu
  listCodeImages() {
    if (!imagesPromise || Date.now() - imagesAt > 50 * 60 * 1000) {
      imagesAt = Date.now();
      imagesPromise = (async () => {
        const files = check(await sb.storage.from(IMG_BUCKET).list(IMG_DIR, { limit: 1000 }));
        const found = files.map((f) => f.name.match(IMAGE_NAME)).filter(Boolean)
          .sort((a, b) => a[1].localeCompare(b[1]) || Number(a[2]) - Number(b[2]));
        const map = new Map();
        if (!found.length) { imagesPromise = null; return map; }
        const signed = check(await sb.storage.from(IMG_BUCKET)
          .createSignedUrls(found.map((m) => `${IMG_DIR}/${m[0]}`), 3600));
        found.forEach((m, i) => {
          if (!map.has(m[1])) map.set(m[1], []);
          map.get(m[1]).push({ id: m[0], kind: 'image', url: signed[i]?.signedUrl ?? '' });
        });
        return map;
      })().catch((e) => { imagesPromise = null; throw e; });
    }
    return imagesPromise;
  },
  async uploadCodeImages(files, onProgress) {
    let i = 0;
    for (const f of files) {
      onProgress?.(++i, files.length);
      check(await sb.storage.from(IMG_BUCKET).upload(`${IMG_DIR}/${f.name}`, f,
        { upsert: true, contentType: f.type || 'image/png' }));
    }
    imagesPromise = null;
  },

  // Předpisy (PDF v soukromém úložišti, odkazy platí hodinu)
  async listRegulations() {
    const rows = check(await sb.from('regulations').select('*').order('title'));
    if (!rows.length) return rows;
    const signed = check(await sb.storage.from(REG_BUCKET).createSignedUrls(rows.map((r) => r.path), 3600));
    const urls = new Map(signed.map((x) => [x.path, x.signedUrl]));
    return rows.map((r) => ({ ...r, url: urls.get(r.path) ?? '' }));
  },
  async addRegulation(title, file) {
    const path = `${uid()}.pdf`;
    check(await sb.storage.from(REG_BUCKET).upload(path, file, { contentType: 'application/pdf' }));
    check(await sb.from('regulations').insert({ title: title.trim(), path, size_bytes: file.size }));
  },
  async deleteRegulation(r) {
    check(await sb.from('regulations').delete().eq('id', r.id));
  },

  // Přehled závad napříč vozy: status 'open' | 'resolved' | 'all'
  async listOverview(status = 'open') {
    const cols = 'id, wagon_id, description, defect_code, found_at, created_at, created_by, created_by_name, '
      + 'resolved_at, resolved_by_name, resolution_note, comment_count';
    const defects = () => {
      let q = sb.from('defect_feed').select(cols);
      if (status === 'open') q = q.is('resolved_at', null);
      if (status === 'resolved') q = q.not('resolved_at', 'is', null);
      return q.order('found_at', { ascending: false }).order('id');
    };
    const [rows, wagons, groups, atts] = await Promise.all([
      fetchAll(defects),
      fetchAll(() => sb.from('wagons').select('id, number, group_id').order('id')),
      api.listGroups(),
      fetchAll(() => sb.from('attachments').select('defect_id').order('id')),
    ]);
    return overviewRows(rows, wagons, groups, atts);
  },

  // Všechna data najednou pro stahování na pozadí (offline.js): skupiny, vozy, závady s odkazy na fotky,
  // komentáře k neopraveným závadám a řádky přehledu
  async snapshot() {
    const [groups, wagons, defects, atts] = await Promise.all([
      api.listGroups(),
      fetchAll(() => sb.from('wagon_overview').select('*').order('id')),
      fetchAll(() => sb.from('defect_feed').select('*').order('id')),
      fetchAll(() => sb.from('attachments').select('*').order('created_at').order('id')),
    ]);
    const withAtt = attachUrls(defects, atts, await signedUrls(atts.map((a) => a.path)));
    const openIds = defects.filter((d) => !d.resolved_at).map((d) => d.id);
    const comments = [];
    for (let i = 0; i < openIds.length; i += 100) {
      const part = openIds.slice(i, i + 100);
      comments.push(...await fetchAll(() => sb.from('comment_feed').select('*').in('defect_id', part)
        .order('created_at').order('id')));
    }
    return { groups, wagons, defects: withAtt, comments, overview: overviewRows(defects, wagons, groups, atts) };
  },

  // Historie změn a koš (tabulka audit_log, plní ji databáze sama)
  async listHistory(defectId) {
    return check(await sb.from('audit_log').select('id, tx, at, actor_name, tbl, action, old_row, new_row')
      .eq('defect_id', defectId).order('at').order('id'));
  },
  async listAudit(limit = 300) {
    return check(await sb.from('audit_log')
      .select('id, tx, at, actor_name, tbl, row_id, action, old_row, new_row, wagon_id, defect_id, restored_at')
      .order('id', { ascending: false }).limit(limit));
  },
  async listTrash() {
    return fetchAll(() => sb.from('audit_log').select('id, tx, at, actor_name, tbl, row_id, old_row, wagon_id, defect_id')
      .eq('action', 'delete').is('restored_at', null).order('id', { ascending: false }));
  },
  async restoreDeleted(tx) {
    return check(await sb.rpc('restore_deleted', { p_tx: tx }));
  },
  async listWagonNumbers() {
    const rows = await fetchAll(() => sb.from('wagons').select('id, number').order('id'));
    return new Map(rows.map((w) => [w.id, w.number]));
  },

  // Pravidelné exporty na e-mail (nastavuje správce, rozesílá server)
  async listExportSchedules() {
    return check(await sb.from('export_schedules').select('*').order('created_at'));
  },
  async saveExportSchedule({ id, ...fields }) {
    if (id) check(await sb.from('export_schedules').update(fields).eq('id', id));
    else check(await sb.from('export_schedules').insert(fields));
  },
  async deleteExportSchedule(id) {
    check(await sb.from('export_schedules').delete().eq('id', id));
  },

  // Komentáře
  async listComments(defectId) {
    return check(await sb.from('comment_feed').select('*').eq('defect_id', defectId).order('created_at'));
  },
  async addComment(defectId, body) {
    check(await sb.from('comments').insert({ defect_id: defectId, body: body.trim(), author_id: await currentUserId() }));
  },
  async deleteComment(id) {
    check(await sb.from('comments').delete().eq('id', id));
  },

  // Živé aktualizace
  subscribeChanges(cb) {
    const ch = sb.channel(`changes-${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'defects' }, async (p) => {
        const mine = p.new?.created_by && p.new.created_by === (await currentUserId());
        cb({ newDefect: p.eventType === 'INSERT' && !mine ? p.new : null });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => cb({ newDefect: null }))
      .subscribe();
    return () => sb.removeChannel(ch);
  },
  subscribeComments(defectId, cb) {
    const ch = sb.channel(`comments-${defectId}-${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `defect_id=eq.${defectId}` }, () => cb())
      .subscribe();
    return () => sb.removeChannel(ch);
  },

  // Uživatelé
  async listProfiles() {
    return check(await sb.from('profiles').select('*').order('full_name'));
  },
  async setRole(id, role) {
    check(await sb.from('profiles').update({ role }).eq('id', id));
  },
  // Účet za kolegu s dočasným heslem (jen správce; účet je hned potvrzený a schválený).
  // Kód je v supabase/functions/create-user, v Supabase je funkce nasazená pod názvem clever-task.
  async createUser({ email, fullName, role, password }) {
    const { data, error } = await sb.functions.invoke('clever-task', {
      body: { email: email.trim(), full_name: fullName.trim(), role, password },
    });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      fail(new Error(detail?.error ?? (navigator.onLine
        ? 'Funkce pro zakládání účtů neodpověděla – je nasazená v Supabase?' : 'Chyba připojení k internetu.')));
    }
    return data;
  },
  async updateMyName(full_name) {
    check(await sb.from('profiles').update({ full_name: full_name.trim() }).eq('id', await currentUserId()));
  },

  // Push upozornění (Web Push přes service worker)
  push: {
    supported: () => !!VAPID_PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window,
    async status() {
      if (!api.push.supported()) return 'off';
      const reg = await navigator.serviceWorker.ready;
      return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
    },
    // 'default' (ještě se neptal) | 'granted' | 'denied' | 'unsupported'
    permission: () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission),
    async enable() {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Upozornění nejsou povolená v nastavení prohlížeče.');
      await subscribePush();
    },
    // Bez ptaní: telefon upozornění už dřív povolil (nové přihlášení, přeinstalace) → odběr obnovit
    // a přiřadit přihlášenému uživateli. Vrací 'on' / 'off'.
    async resume() {
      if (!api.push.supported() || api.push.permission() !== 'granted') return 'off';
      await subscribePush();
      return 'on';
    },
    async test() {
      const { data, error } = await sb.functions.invoke('notify-new-defect', { body: { test: true } });
      if (error) {
        const detail = await error.context?.json?.().catch(() => null);
        throw new Error(detail?.error ?? 'Funkce pro upozornění neodpověděla – je nasazená v Supabase?');
      }
      if (data?.errors?.length) throw new Error(`Odeslání selhalo: ${data.errors[0]}`);
      return data.sent;
    },
    async disable() {
      if (!('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return;
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe();
    },
  },
};
