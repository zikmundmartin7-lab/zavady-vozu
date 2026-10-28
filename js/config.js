// Nastavení připojení k Supabase (Project Settings → Data API / API Keys). Oba údaje jsou veřejné.
// Dokud je SUPABASE_URL prázdné, aplikace běží v DEMO režimu jen v tomto prohlížeči.
export const SUPABASE_URL = 'https://tfbirhsjavejkyscmacw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_8_8Ba8atiptC7t8AxCJ6zg_6KcJPznJ';

// Veřejný VAPID klíč pro push upozornění na telefon (postup v README.md).
export const VAPID_PUBLIC_KEY = 'BETPzNEbAr8-tarMfmh3-mIP02R_6Dv6Vo7WWhURMaydcVN5CGLtWbX5CkdUPSrSUDb9meqY9vqU7Q7UHpdhruc';

// Fotky závad pro lidi bez účtu (souběh se skupinou na WhatsAppu): název Edge Function, kterou volá stránka
// fotky.html (kód supabase/functions/fotky, Supabase ji pojmenoval smooth-endpoint). Stránka fotky.html má
// vlastní kopii adresy i názvu (nesmí záviset na souborech aplikace v paměti telefonu) – měnit na obou místech.
// Prázdné = odkaz ve zprávě vede jen do aplikace (pro přihlášené).
export const PHOTOS_FUNCTION = 'smooth-endpoint';
