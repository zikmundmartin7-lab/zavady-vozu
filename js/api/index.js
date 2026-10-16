// Vybere úložiště dat: Supabase, pokud je vyplněné v config.js, jinak demo v prohlížeči.
// Adresa s ?demo (např. …/zavady-vozu/?demo) vždy spustí ukázkový režim – na zkoušení bez zásahu do ostrých dat.
import { SUPABASE_URL } from '../config.js';

const demo = !SUPABASE_URL || new URLSearchParams(location.search).has('demo');

export const api = !demo
  ? (await import('./supabase.js')).api
  : (await import('./demo.js')).api;
