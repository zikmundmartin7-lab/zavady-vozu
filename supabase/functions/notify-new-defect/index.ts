// Supabase Edge Function: po vložení nové závady pošle push upozornění všem ostatním schváleným uživatelům.
// Volá ji aplikace hned po uložení závady (js/api/supabase.js → createDefect).
//
// Potřebné tajné hodnoty (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (např. mailto:vas@email.cz)
// SUPABASE_URL, SUPABASE_ANON_KEY a SUPABASE_SERVICE_ROLE_KEY doplňuje Supabase sám.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SEVERITY: Record<number, string> = { 1: '🟡', 2: '🟠', 3: '🔴' };
const formatNumber = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 8)} ${n.slice(8, 11)}-${n.slice(11)}`;

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // Čteme jako přihlášený uživatel → databáze sama ověří, že závadu smí vidět.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Nepřihlášený uživatel' }, 401);

  const { defect_id } = await req.json().catch(() => ({}));
  const { data: d } = await asUser.from('defect_feed')
    .select('id, wagon_id, severity, description, created_by, created_by_name, created_at')
    .eq('id', defect_id).maybeSingle();
  // Upozornění smí rozeslat jen autor, a to jen krátce po vložení (ochrana proti zneužití).
  if (!d || d.created_by !== user.id || Date.now() - Date.parse(d.created_at) > 10 * 60_000) {
    return json({ error: 'Závada nenalezena' }, 404);
  }
  const { data: w } = await asUser.from('wagon_overview').select('number, group_name').eq('id', d.wagon_id).single();

  // Odběry ostatních schválených uživatelů (servisní klíč – obchází RLS).
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: subs } = await admin.from('push_subscriptions')
    .select('endpoint, subscription, profiles!inner(role)')
    .neq('user_id', user.id)
    .in('profiles.role', ['user', 'repairer', 'admin']);

  const payload = JSON.stringify({
    title: `${SEVERITY[d.severity] ?? ''} Nová závada · ${w ? formatNumber(w.number) : ''}`.trim(),
    body: `${w?.group_name ? `${w.group_name}: ` : ''}${d.description}${d.created_by_name ? ` (${d.created_by_name})` : ''}`,
    url: `#/vuz/${d.wagon_id}`,
    tag: d.id,
  });

  let sent = 0;
  const gone: string[] = [];
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 24 * 3600 });
      sent++;
    } catch (e) {
      // 404/410 = telefon odběr zrušil (odinstalace, odhlášení) → smazat
      if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint);
      else console.error('push', e?.statusCode, e?.body ?? e);
    }
  }));
  if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone);

  return json({ sent, removed: gone.length });
});
