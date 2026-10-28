// Supabase Edge Function: push upozornění do telefonů.
//   { defect_id }      – nová závada → všem ostatním schváleným uživatelům (volá createDefect po uložení)
//   { new_user: true } – nový uživatel se zaregistroval → administrátorům, ať ho schválí (volá signUp)
//   { comment_id }     – nový komentář → autorovi závady a všem, kdo už u ní komentovali (volá addComment)
//   { test: true }     – zkušební upozornění jen na zařízení přihlášeného uživatele
//
// Potřebné tajné hodnoty (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (např. mailto:vas@email.cz)
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY doplňuje Supabase sám.
// Přihlášení volajícího si funkce ověřuje sama (auth.getUser), kontrolu JWT v nastavení funkce lze vypnout.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const formatNumber = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 8)} ${n.slice(8, 11)}-${n.slice(11)}`;

// deno-lint-ignore no-explicit-any
type Sub = { endpoint: string; subscription: any };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const env = (k: string) => Deno.env.get(k) ?? '';
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) {
    return json({ error: 'Chybí VAPID klíče v Edge Functions → Secrets.' }, 500);
  }
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

  // Čteme jako přihlášený uživatel → databáze sama ověří, co smí vidět.
  const apiKey = req.headers.get('apikey') ?? env('SUPABASE_ANON_KEY');
  const asUser = createClient(env('SUPABASE_URL'), apiKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Nepřihlášený uživatel.' }, 401);

  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
  const body = await req.json().catch(() => ({}));

  async function send(subs: Sub[], payload: object) {
    let sent = 0;
    const gone: string[] = [];
    const errors: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        // urgency high: Android doručí hned i zamčenému telefonu v úsporném režimu (jinak až po probuzení)
        await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high' });
        sent++;
      // deno-lint-ignore no-explicit-any
      } catch (e: any) {
        // 404/410 = zařízení odběr zrušilo (odinstalace, odhlášení) → smazat
        if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint);
        else errors.push(`${e?.statusCode ?? ''} ${e?.body ?? e?.message ?? e}`.trim());
      }
    }));
    if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);
    if (errors.length) console.error('push', errors);
    return { sent, removed: gone.length, errors };
  }

  // Zkušební upozornění na vlastní zařízení
  if (body.test) {
    const { data: subs } = await admin.from('push_subscriptions')
      .select('endpoint, subscription').eq('user_id', user.id);
    if (!subs?.length) return json({ error: 'Na tomto účtu nejsou zapnutá upozornění na žádném zařízení.' }, 404);
    return json(await send(subs, {
      title: 'Zkušební upozornění', body: 'Upozornění na nové závady fungují.', url: '#/', tag: 'test',
    }));
  }

  // Nový uživatel čeká na schválení → upozornit administrátory (jen hned po registraci, jen za sebe)
  if (body.new_user) {
    const { data: p } = await admin.from('profiles')
      .select('id, full_name, email, role, created_at').eq('id', user.id).maybeSingle();
    if (!p || p.role !== 'pending' || Date.now() - Date.parse(p.created_at) > 10 * 60_000) {
      return json({ error: 'Není co oznámit.' }, 404);
    }
    const { data: subs } = await admin.from('push_subscriptions')
      .select('endpoint, subscription, profiles!inner(role)')
      .eq('profiles.role', 'admin');
    return json(await send(subs ?? [], {
      title: 'Nový uživatel čeká na schválení',
      body: `${p.full_name || 'Bez jména'} (${p.email}) – schvalte v Můj účet → Správa uživatelů`,
      url: '#/uzivatele',
      tag: `user-${p.id}`,
    }));
  }

  // Nový komentář → autorovi závady a všem, kdo už se k ní vyjádřili (kromě pisatele)
  if (body.comment_id) {
    const { data: c } = await asUser.from('comment_feed')
      .select('id, defect_id, author_id, author_name, body, created_at').eq('id', body.comment_id).maybeSingle();
    // Rozeslat smí jen autor komentáře, a to jen krátce po napsání (ochrana proti zneužití)
    if (!c || c.author_id !== user.id || Date.now() - Date.parse(c.created_at) > 10 * 60_000) {
      return json({ error: 'Komentář nenalezen.' }, 404);
    }
    const { data: def } = await admin.from('defects').select('wagon_id, created_by').eq('id', c.defect_id).maybeSingle();
    if (!def) return json({ error: 'Závada nenalezena.' }, 404);
    const { data: others } = await admin.from('comments').select('author_id').eq('defect_id', c.defect_id);
    const people = new Set([def?.created_by, ...(others ?? []).map((o) => o.author_id)]);
    people.delete(user.id);
    const ids = [...people].filter(Boolean);
    if (!ids.length) return json({ sent: 0, removed: 0, errors: [] });
    const { data: w } = await admin.from('wagons').select('number').eq('id', def.wagon_id).single();
    const { data: subs } = await admin.from('push_subscriptions')
      .select('endpoint, subscription, profiles!inner(role)')
      .in('user_id', ids)
      .in('profiles.role', ['user', 'repairer', 'admin']);
    const text = `${c.author_name || 'Někdo'}: ${c.body}`.replace(/\s+/g, ' ');
    return json(await send(subs ?? [], {
      title: `Nový komentář${w ? ` · ${formatNumber(w.number)}` : ''}`,
      body: text.length > 180 ? `${text.slice(0, 177)}…` : text,
      url: `#/zavada/${c.defect_id}`,
      tag: `comment-${c.id}`,
    }));
  }

  const { data: d } = await asUser.from('defect_feed')
    .select('id, wagon_id, description, defect_code, created_by, created_by_name, created_at')
    .eq('id', body.defect_id).maybeSingle();
  // Upozornění smí rozeslat jen autor, a to jen krátce po vložení (ochrana proti zneužití).
  if (!d || d.created_by !== user.id || Date.now() - Date.parse(d.created_at) > 10 * 60_000) {
    return json({ error: 'Závada nenalezena.' }, 404);
  }
  const { data: w } = await asUser.from('wagon_overview').select('number, group_name').eq('id', d.wagon_id).single();

  // Odběry ostatních schválených uživatelů (servisní klíč – obchází RLS).
  const { data: subs } = await admin.from('push_subscriptions')
    .select('endpoint, subscription, profiles!inner(role)')
    .neq('user_id', user.id)
    .in('profiles.role', ['user', 'repairer', 'admin']);

  return json(await send(subs ?? [], {
    title: `Nová závada${w ? ` · ${formatNumber(w.number)}` : ''}`,
    body: `${w?.group_name ? `${w.group_name}: ` : ''}${d.defect_code ? `kód ${d.defect_code} – ` : ''}${d.description}`
      + `${d.created_by_name ? ` (${d.created_by_name})` : ''}`,
    url: `#/vuz/${d.wagon_id}`,
    tag: d.id,
  }));
});
