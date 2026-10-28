// Supabase Edge Function „fotky“ (v Supabase se jmenuje smooth-endpoint): fotky a videa jedné závady i pro
// lidi bez účtu (souběh se skupinou na WhatsAppu – odkaz „Fotky v plné kvalitě ke stažení“ ve zprávě vede
// na stránku fotky.html).
//   GET ?z=<id závady>  →  { number, found_at, files: [{ kind, url }] }
// Klíčem je náhodné ID závady (UUID, nedá se uhodnout): kdo má odkaz, uvidí číslo vozu a přílohy té jedné
// závady, nic jiného (popis má ve zprávě, komentáře ani ostatní závady ne). Odkazy na soubory platí hodinu.
// Konec souběhu: funkci v Supabase smazat → odkazy přestanou fungovat (a v js/config.js PHOTOS_FUNCTION = '').
//
// Nastavení funkce: Verify JWT vypnout (volá se bez přihlášení).
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY doplňuje Supabase sám.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const formatNumber = (n: string) => `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 8)} ${n.slice(8, 11)}-${n.slice(11)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const id = new URL(req.url).searchParams.get('z') ?? '';
  if (!UUID.test(id)) return json({ error: 'Neplatný odkaz.' }, 400);

  const env = (k: string) => Deno.env.get(k) ?? '';
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  const { data: d, error } = await admin.from('defects').select('id, found_at, wagons(number)').eq('id', id).maybeSingle();
  if (error) return json({ error: 'Databáze neodpověděla, zkuste to za chvíli.' }, 500);
  if (!d) return json({ error: 'Závada nebyla nalezena (možná byla smazána).' }, 404);

  const { data: atts } = await admin.from('attachments').select('path, kind').eq('defect_id', id).order('created_at');
  const paths = (atts ?? []).map((a) => a.path);
  const { data: signed } = paths.length
    ? await admin.storage.from('attachments').createSignedUrls(paths, 3600)
    : { data: [] };
  const urls = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  // deno-lint-ignore no-explicit-any
  const number = (d as any).wagons?.number ?? '';
  return json({
    number: number ? formatNumber(number) : '',
    found_at: d.found_at,
    files: (atts ?? []).filter((a) => urls.has(a.path)).map((a) => ({ kind: a.kind, url: urls.get(a.path) })),
  });
});
