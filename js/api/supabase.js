// Ostrý režim: data v Supabase (databáze Postgres, přihlášení, úložiště souborů, živé změny).
// Oprávnění hlídá databáze (supabase/schema.sql), aplikace je jen zobrazuje.

import { SUPABASE_URL, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY } from '../config.js';
import { compressImage, uid } from '../model.js';

await new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = new URL('../../vendor/supabase.js', import.meta.url).href;
  s.onload = res;
  s.onerror = () => rej(new Error('Nepodařilo se načíst knihovnu Supabase.'));
  document.head.append(s);
});

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = 'attachments';
const appUrl = () => location.origin + location.pathname;

const MESSAGES = [
  [/invalid login credentials/i, 'Nesprávný e-mail nebo heslo.'],
  [/email not confirmed/i, 'E-mail ještě není potvrzený – klikněte na odkaz, který vám přišel.'],
  [/already registered/i, 'Účet s tímto e-mailem už existuje.'],
  [/password should be at least/i, 'Heslo musí mít alespoň 6 znaků.'],
  [/wagons_number_key/i, 'Vůz s tímto číslem už existuje.'],
  [/rate limit/i, 'Příliš mnoho pokusů, zkuste to za chvíli.'],
  [/failed to fetch|network/i, 'Chyba připojení k internetu.'],
  [/row-level security/i, 'Nemáte oprávnění.'],
];
function fail(error) {
  const msg = error?.message ?? String(error);
  const hit = MESSAGES.find(([re]) => re.test(msg));
  throw new Error(hit ? hit[1] : msg);
}
const check = ({ data, error }) => (error ? fail(error) : data);

async function currentUserId() {
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

async function withUrls(defects) {
  const ids = defects.map((d) => d.id);
  const atts = ids.length
    ? check(await sb.from('attachments').select('*').in('defect_id', ids).order('created_at'))
    : [];
  const signed = atts.length
    ? check(await sb.storage.from(BUCKET).createSignedUrls(atts.map((a) => a.path), 3600))
    : [];
  const urls = new Map(signed.map((s) => [s.path, s.signedUrl]));
  return defects.map((d) => ({
    ...d,
    attachments: atts.filter((a) => a.defect_id === d.id).map((a) => ({ ...a, url: urls.get(a.path) ?? '' })),
  }));
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

async function removeStorage(paths) {
  if (paths.length) check(await sb.storage.from(BUCKET).remove(paths));
}

function base64UrlToBytes(s) {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export const api = {
  mode: 'supabase',

  // Přihlášení
  async getProfile() {
    const id = await currentUserId();
    if (!id) return null;
    const p = check(await sb.from('profiles').select('*').eq('id', id).maybeSingle());
    return p ?? { id, email: '', full_name: '', role: 'pending' };
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
      email, password, options: { data: { full_name: fullName.trim() }, emailRedirectTo: appUrl() },
    }));
    return { needsConfirmation: !r.session };
  },
  async resetPassword(email) {
    check(await sb.auth.resetPasswordForEmail(email, { redirectTo: appUrl() }));
  },
  async updatePassword(password) {
    check(await sb.auth.updateUser({ password }));
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
      .order('max_severity', { ascending: false }).order('open_count', { ascending: false })
      .order('number').limit(50));
  },
  async listWagons(groupId) {
    return check(await sb.from('wagon_overview').select('*').eq('group_id', groupId)
      .order('max_severity', { ascending: false }).order('open_count', { ascending: false })
      .order('number'));
  },
  async getWagon(id) {
    return check(await sb.from('wagon_overview').select('*').eq('id', id).maybeSingle());
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
  async deleteWagon(id) {
    const defects = check(await sb.from('defects').select('id').eq('wagon_id', id));
    if (defects.length) {
      const atts = check(await sb.from('attachments').select('path').in('defect_id', defects.map((d) => d.id)));
      await removeStorage(atts.map((a) => a.path));
    }
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
  async createDefect({ wagon_id, severity, description }, files = [], onProgress) {
    const d = check(await sb.from('defects').insert({
      wagon_id, severity, description: description.trim(), created_by: await currentUserId(),
    }).select().single());
    await uploadFiles(d.id, files, onProgress);
    // Rozeslání upozornění ostatním (Edge Function notify-new-defect). Chyba nevadí – závada je uložená.
    sb.functions.invoke('notify-new-defect', { body: { defect_id: d.id } }).catch(() => {});
    return d;
  },
  async updateDefect(id, { severity, description }, newFiles = [], removeIds = [], onProgress) {
    check(await sb.from('defects').update({ severity, description: description.trim() }).eq('id', id));
    if (removeIds.length) {
      const atts = check(await sb.from('attachments').select('path').in('id', removeIds));
      await removeStorage(atts.map((a) => a.path));
      check(await sb.from('attachments').delete().in('id', removeIds));
    }
    await uploadFiles(id, newFiles, onProgress);
  },
  async deleteDefect(id) {
    const atts = check(await sb.from('attachments').select('path').eq('defect_id', id));
    check(await sb.from('defects').delete().eq('id', id));
    await removeStorage(atts.map((a) => a.path)).catch(() => {});
  },
  async resolveDefect(id, note) {
    check(await sb.from('defects')
      .update({ resolved_at: new Date().toISOString(), resolution_note: note?.trim() || null }).eq('id', id));
  },
  async reopenDefect(id) {
    check(await sb.from('defects').update({ resolved_at: null, resolution_note: null }).eq('id', id));
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
    async enable() {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Upozornění nejsou povolená v nastavení prohlížeče.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) });
      check(await sb.from('push_subscriptions').upsert({
        endpoint: sub.endpoint, subscription: sub.toJSON(), user_id: await currentUserId(),
      }));
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
