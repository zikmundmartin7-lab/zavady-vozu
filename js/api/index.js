// Vybere úložiště dat: Supabase, pokud je vyplněné v config.js, jinak demo v prohlížeči.
import { SUPABASE_URL } from '../config.js';

export const api = SUPABASE_URL
  ? (await import('./supabase.js')).api
  : (await import('./demo.js')).api;
