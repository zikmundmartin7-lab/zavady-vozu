// Společná pravidla aplikace: čísla vozů, závažnost, role, oprávnění, formátování.

// ───── Číslo vozu: 12 číslic, zobrazení "XX XX XXXX XXX-X" ─────

export const digitsOnly = (s) => String(s ?? '').replace(/\D/g, '');

export function formatNumber(n) {
  const d = digitsOnly(n).slice(0, 12);
  const head = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8), d.slice(8, 11)].filter(Boolean).join(' ');
  return d.length > 11 ? `${head}-${d[11]}` : head;
}

// Formátované číslo rozdělené na začátek a "poslední čtyřčíslí" (XXX-X) pro zvýraznění.
export function splitNumber(n) {
  const f = formatNumber(n);
  return [f.slice(0, -5), f.slice(-5)];
}

// Kontrolní číslice UIC (Luhnův algoritmus): číslice střídavě ×2 a ×1 zleva,
// sečtou se ciferné součty, kontrolní číslice doplní součet do násobku 10.
export function checkDigit(number) {
  const d = digitsOnly(number);
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const p = Number(d[i]) * (i % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  return (10 - (sum % 10)) % 10;
}

export const isCompleteNumber = (n) => /^\d{12}$/.test(digitsOnly(n));
export const isValidCheckDigit = (n) =>
  isCompleteNumber(n) && checkDigit(n) === Number(digitsOnly(n)[11]);

// Vyhledávání: do 4 číslic se hledá podle posledního čtyřčíslí (XXX-X, vč. kontrolní číslice),
// při delším zadání kdekoli v celém čísle.
export const SEARCH_DIGITS = 4;
export function matchesQuery(number, q) {
  if (!q) return true;
  return q.length <= SEARCH_DIGITS ? number.slice(-SEARCH_DIGITS).startsWith(q) : number.includes(q);
}

// ───── Závažnost, role, oprávnění ─────

export const SEVERITY = {
  1: { label: 'Nízká', color: 'yellow' },
  2: { label: 'Střední', color: 'orange' },
  3: { label: 'Vysoká', color: 'red' },
};

export const ROLES = {
  pending: 'Čeká na schválení',
  user: 'Vozmistr',
  repairer: 'Opravář',
  admin: 'Správce',
};

export const can = {
  use: (me) => ['user', 'repairer', 'admin'].includes(me?.role),
  admin: (me) => me?.role === 'admin',
  // Opravu (zelenou) označí opravář, správce, nebo autor u své vlastní závady.
  resolve: (me, defect) => can.use(me) && (['repairer', 'admin'].includes(me.role) || defect?.created_by === me.id),
  edit: (me, defect) => !!me && (defect.created_by === me.id || me.role === 'admin'),
  deleteComment: (me, c) => !!me && (c.author_id === me.id || me.role === 'admin'),
};

// ───── Formátování ─────

const dtf = new Intl.DateTimeFormat('cs-CZ', {
  day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const tf = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });

export const formatDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '');
export const formatTime = (iso) => (iso ? tf.format(new Date(iso)) : '');

export function formatDay(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Dnes';
  if (d.toDateString() === yesterday.toDateString()) return 'Včera';
  return df.format(d);
}

// plural(3, 'závada', 'závady', 'závad') → "3 závady"
export function plural(n, one, few, many) {
  const word = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return `${n} ${word}`;
}

export const initials = (name) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Fotky se před nahráním zmenší (max. 1920 px, JPEG) – šetří data i úložiště.
export async function compressImage(file, max = 1920, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export const MAX_VIDEO_MB = 50;
