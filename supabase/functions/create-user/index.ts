// Supabase Edge Function: administrátor založí účet za kolegu s dočasným heslem.
//   { email, full_name, role, password } → { id }
// Účet je rovnou potvrzený (žádný e-mail) a schválený (zvolená role). Heslo si uživatel může,
// ale nemusí změnit (Můj účet → Změnit heslo); do té doby má v user_metadata temp_password: true.
//
// V Supabase je nasazená pod názvem clever-task (adresa /functions/v1/clever-task, volá ji js/api/supabase.js).
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY doplňuje Supabase sám.
// Přihlášení i roli volajícího si funkce ověřuje sama, kontrolu JWT v nastavení funkce lze vypnout.

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['user', 'repairer', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const env = (k: string) => Deno.env.get(k) ?? '';

  // Volající jako přihlášený uživatel → databáze sama ověří, co smí.
  const apiKey = req.headers.get('apikey') ?? env('SUPABASE_ANON_KEY');
  const asUser = createClient(env('SUPABASE_URL'), apiKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Nepřihlášený uživatel.' }, 401);
  const { data: me } = await asUser.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') return json({ error: 'Účty zakládá jen administrátor.' }, 403);

  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim();
  const password = String(body.password ?? '');
  const role = ROLES.includes(body.role) ? body.role : 'user';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Zadejte platný e-mail.' }, 400);
  if (!fullName) return json({ error: 'Vyplňte jméno a příjmení.' }, 400);
  if (password.length < 6) return json({ error: 'Heslo musí mít alespoň 6 znaků.' }, 400);

  // Založení účtu umí jen servisní klíč (obchází potvrzovací e-mail).
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, temp_password: true },
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) {
      return json({ error: 'Účet s tímto e-mailem už existuje – najdete ho v seznamu uživatelů.' }, 409);
    }
    console.error('createUser', error);
    return json({ error: error.message }, 400);
  }

  // Profil založil trigger handle_new_user (role „čeká na schválení“). Roli nastavíme přihlášením
  // administrátor – trigger protect_profile pustí změnu role jen jemu, servisnímu klíči ne.
  const { data: updated, error: roleError } = await asUser.from('profiles')
    .update({ role }).eq('id', data.user.id).select('id');
  if (roleError || !updated?.length) {
    console.error('role', roleError ?? 'profil nenalezen');
    return json({ id: data.user.id, warning: 'Účet je založený, ale roli se nepodařilo nastavit – nastavte ji v seznamu.' });
  }
  return json({ id: data.user.id });
});
