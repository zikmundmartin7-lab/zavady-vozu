// Supabase Edge Function: po vložení nové závady pošle push upozornění všem ostatním schváleným uživatelům.
// Volá ji aplikace hned po uložení závady (js/api/supabase.js → createDefect).
// S tělem { test: true } pošle zkušební upozornění jen na zařízení přihlášeného uživatele.
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

const SEVERITY: Record<number, string> = { 1: '🟡', 2: '🟠', 3: '🔴' };
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
        await webpush.sendNotification(s.subscription, JSON.stringify(payload), { TTL: 24 * 3600 });
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

  const { data: d } = await asUser.from('defect_feed')
    .select('id, wagon_id, severity, description, created_by, created_by_name, created_at')
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
    title: `${SEVERITY[d.severity] ?? ''} Nová závada · ${w ? formatNumber(w.number) : ''}`.trim(),
    body: `${w?.group_name ? `${w.group_name}: ` : ''}${d.description}${d.created_by_name ? ` (${d.created_by_name})` : ''}`,
    url: `#/vuz/${d.wagon_id}`,
    tag: d.id,
  }));
});
