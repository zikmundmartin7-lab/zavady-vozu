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

// ───── Číslo vozu v textu přečteném kamerou (skener, js/views/scanner.js) ─────
// Převzato z aplikace Výkaz vozů (js/model.js numberCandidates) – při úpravách držet obě kopie stejné.

// Kódy států (3. a 4. číslice) – jen pro řazení kandidátů, neznámý stát číslo neodmítne.
const COUNTRIES = new Set([10, 20, 21, 22, 23, 24, 25, 26, 27, 28, 41, 44, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 65, 66, 67, 68, 70, 71, 72, 73, 74, 75, 76, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 94]);

// Znaky, které síť u číslic plete s písmeny (jen v „převážně číselných“ slovech).
const LOOKALIKE = { O: '0', o: '0', Q: '0', D: '0', I: '1', l: '1', i: '1', '|': '1', '!': '1', Z: '2', z: '2',
  S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9' };

// Přečtené řádky → číselná slova v pořadí čtení. Slovo s většinou číslic se opraví (O→0, I→1 …),
// slova z písmen (RIV, TEN, D-DB, PL-FPL …) se přeskočí – na novějších vozech bývají mezi částmi čísla.
// Desetinná čísla (tabulka zatížení „48,0“, „62.5“) nejsou části čísla vozu. Čárka v čísle vozu nebývá nikdy,
// tečka jen místo pomlčky před kontrolní číslicí (za trojčíslím) – proto se maže jen tečka za 1–2 číslicemi.
const DECIMAL = /\b\d+,\d+\b|\b\d{1,2}\.\d+\b/g;

// Kód státu bývá nalepený na značku držitele („80D-DB“, „54CZ-ČDC“, „80D-“ se značkou v dalším rámečku) – oddělí se,
// jinak by se D četlo jako 0.
const KEEPER = /(\d)(?=\p{Lu}{1,3}-(?:\p{Lu}{2}|\s|$))/gu;
// Dvojčíslí nalepené na RIV/TEN/PPW („31RIV“) – oddělí se, jinak slovo s převahou písmen vypadne celé.
const MARK = /(\d)(?=(?:RIV|TEN|PPW)\b)/g;
// Mezera mezi dvojčíslími přečtená jako tečka („31.54 3939 735-9“) – před osmi číslicemi to není desetinné číslo.
const PAIR_DOT = /\b(\d{2})\.(\d{2})(?=\s?\d{4}\s?\d{3})/g;

// Řádky s telefonem, e-mailem nebo adresou držitele („D-55252 Mainz-Kastel“, „+496134/94844-0“) – jejich číslice
// složily na jednom voze falešné číslo s platnou kontrolní číslicí.
const CONTACT = /\+\s?\d|@|\b(tel|fax|e-?mail|www|gmbh|str(aße|asse)?\.?)\b|\b[A-Z]-\d{4,5}\b/i;

function digitTokens(lines) {
  const tokens = [];
  for (const [li, l] of lines.entries()) {
    if (CONTACT.test(l.text)) continue;
    for (const word of l.text.replace(PAIR_DOT, '$1 $2').replace(DECIMAL, ' ').replace(KEEPER, '$1 ').replace(MARK, '$1 ').split(/[^0-9A-Za-z|!]+/)) {
      const digits = word.replace(/\D/g, '').length;
      if (!digits || digits / word.length < 0.6) continue;
      const d = [...word].map((c) => (/\d/.test(c) ? c : LOOKALIKE[c] ?? '')).join('');
      // výška písma: u narovnaného řádku jeho tloušťka (obdélník šikmého řádku je vyšší než písmo)
      tokens.push({ d, li, row: l.row ?? 0, h: l.th ?? l.h ?? 1, conf: l.conf ?? 0, first: !tokens.some((t) => t.li === li) });
    }
  }
  return tokens;
}

// Čísla na voze bývají rozdělená 2-2-4-3-1 (nebo po řádcích 2 / 2 / 4 3-1).
const GROUP_ENDS = new Set([2, 4, 8, 11, 12]);

/**
 * Najde v přečtených řádcích (výstup readText z js/ocr.js) možná čísla vozů – i rozdělená do více řádků.
 * Vrací [{ number, valid, sure, score, lines }] od nejpravděpodobnějšího; valid = sedí kontrolní číslice,
 * sure = navíc známý kód státu a rozdělení do skupin, lines = indexy řádků, ze kterých se číslo složilo.
 */
export function numberCandidates(lines) {
  const tokens = digitTokens(lines);
  const found = new Map();
  // block = složeno z rozložení na voze (dvojčíslí + osm číslic v jednom řádku), rozdělení do skupin je tím dané
  const add = (number, parts, aligned, block = false) => {
    const valid = isValidCheckDigit(number);
    const country = COUNTRIES.has(Number(number.slice(2, 4)));
    let n = 0;
    const grouped = block || (aligned && parts.every((t) => GROUP_ENDS.has((n += t.d.length))));
    const rows = parts.at(-1).row - parts[0].row;
    const score = parts.reduce((a, t) => a + t.conf, 0) / parts.length - rows * 0.3
      + (valid ? 10 : 0) + (country ? 2 : 0) + (grouped ? 2 : aligned ? 1 : 0);
    // „jisté“ číslo: sedí kontrolní číslice, kód státu i rozdělení do skupin (náhodná shoda je velmi vzácná)
    const sure = valid && country && grouped;
    const prev = found.get(number);
    if (!prev || prev.score < score) found.set(number, { number, valid, sure, score, lines: [...new Set(parts.map((t) => t.li))] });
  };
  for (let i = 0; i < tokens.length; i++) {
    let all = '';
    const parts = [];
    const rows = new Set();
    for (let j = i; j < tokens.length && j < i + 8; j++) {
      const t = tokens[j];
      // části jednoho čísla: nejvýš 3 řádky s číslicemi pod sebou (řádky jen s písmeny – RIV, D-DB, úlomek
      // „-“ – se nepočítají) a podobně velké písmo
      if (!rows.has(t.row) && rows.size === 3) break;
      rows.add(t.row);
      if (Math.max(t.h, tokens[i].h) / Math.min(t.h, tokens[i].h) > 1.8) continue;
      all += t.d;
      parts.push(t);
      if (all.length === 12) add(all, parts, true);
      if (all.length >= 12) {
        if (parts.length === 1) for (let k = 0; k + 12 <= all.length; k++) add(all.slice(k, k + 12), parts, false);
        else add(all.slice(0, 12), parts, false);
        break;
      }
    }
  }
  for (const [a, b, body] of numberBlocks(lines, tokens)) add(a.d + b.d + body.map((t) => t.d).join(''), [a, b, ...body], true, true);
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * Číslo podle rozložení na voze, nezávisle na pořadí řádků (na novějších vozech „33 RIV“ / „80 D-TWA“ / „2742 187-8“:
 * při mírném náklonu se řádky slijí a pořadí se pomíchá, mezi části vlezou cizí číslice). Tělo = osm číslic
 * v jednom řádku (i rozdělených „495 6 322-2“); před ním dvě dvojčíslí, každé na začátku svého řádku:
 * pod sebou zarovnaná vlevo s tělem (nad ním), nebo vlevo od těla ve stejném řádku. Vrací [[a, b, tělo]].
 */
function numberBlocks(lines, tokens) {
  const out = [];
  const box = (t) => lines[t.li];
  // svislá poloha kolmo na převažující sklon řádků (jako sortLines v ocr.js): na šikmém snímku jsou řádky
  // „33 RIV“ / „80 D-TWA“ / tělo podle středů obdélníků skoro ve stejné výšce
  const angles = lines.map((l) => l.angle).filter((a) => a != null).sort((a, b) => a - b);
  const tilt = angles.length ? angles[Math.floor(angles.length / 2)] : 0;
  const cy = (t) => -(box(t).x + box(t).w / 2) * Math.sin(tilt) + (box(t).y + box(t).h / 2) * Math.cos(tilt);
  const pairs = tokens.filter((t) => t.first && t.d.length === 2);
  for (const li of new Set(tokens.map((t) => t.li))) {
    const own = tokens.filter((t) => t.li === li);
    // tělo: souvislá část slov řádku s právě osmi číslicemi (4-3-1, s rozdělením, které čtení přidá)
    for (let i = 0; i < own.length; i++) {
      let n = 0;
      let j = i;
      while (j < own.length && n < 8) n += own[j++].d.length;
      if (n !== 8 || own[i].d.length < 3) continue;
      const body = own.slice(i, j);
      const B = box(body[0]);
      const h = body[0].h;
      const yb = cy(body[0]);
      // dvojčíslí bývají menším písmem než tělo (na vozech TSI zhruba polovičním)
      const near = pairs.filter((p) => p.li !== li && Math.max(p.h, h) / Math.min(p.h, h) < 2.6);
      // pod sebou: nad tělem, levý okraj do 1,5 výšky těla od levého okraje těla; řádky od sebe aspoň
      // půl výšky svého písma, nejvýš 3 výšky těla
      const above = near.filter((p) => cy(p) < yb && Math.abs(box(p).x - B.x) < h * 1.5).sort((p, q) => cy(p) - cy(q));
      for (let k = 0; k + 1 < above.length; k++) {
        const [a, b] = [above[k], above[k + 1]];
        if (cy(b) - cy(a) > a.h * 0.5 && yb - cy(b) > b.h * 0.5 && yb - cy(a) < h * 3) out.push([a, b, body]);
      }
      // v jednom řádku: dvě dvojčíslí vlevo od těla ve stejné výšce (samostatné rámečky v pořadí zleva,
      // pak dvojčíslí na začátku řádku těla „52 495 6 322-2“)
      const left = [...near.filter((p) => Math.abs(cy(p) - yb) < Math.max(p.h, h) * 0.5 && box(p).x + box(p).w <= B.x + h * 0.3
        && B.x - box(p).x < Math.max(p.h, h) * 8).sort((p, q) => box(p).x - box(q).x), ...own.slice(0, i).filter((t) => t.d.length === 2)];
      if (left.length >= 2) out.push([left.at(-2), left.at(-1), body]);
    }
  }
  return out;
}

// Vyhledávání: do 4 číslic se hledá podle posledního čtyřčíslí (XXX-X, vč. kontrolní číslice),
// při delším zadání kdekoli v celém čísle.
export const SEARCH_DIGITS = 4;
export function matchesQuery(number, q) {
  if (!q) return true;
  return q.length <= SEARCH_DIGITS ? number.slice(-SEARCH_DIGITS).startsWith(q) : number.includes(q);
}

// ───── Role, oprávnění ─────

// Skupina vozů: odborný název (řady vozů, např. „Faccpp“) a slangový („Choper“, u některých není).
// Na jeden řádek se píšou oba: „Faccpp – Choper“ (stejně jako group_name z databáze).
export const groupLabel = (g) => [g?.name, g?.slang].filter(Boolean).join(' – ');

// Základní heslo nového účtu (předvyplněné v registraci i při založení administrátorem); změnit ho jde, ale nemusí se
export const DEFAULT_PASSWORD = '123456';

export const ROLES = {
  pending: 'Čeká na schválení',
  user: 'Vozmistr',
  repairer: 'Správce',
  admin: 'Administrátor',
};

export const can = {
  use: (me) => ['user', 'repairer', 'admin'].includes(me?.role),
  admin: (me) => me?.role === 'admin',
  // Opravu (zelenou) označí správce, administrátor, nebo autor u své vlastní závady.
  resolve: (me, defect) => can.use(me) && (['repairer', 'admin'].includes(me.role) || defect?.created_by === me.id),
  edit: (me, defect) => !!me && (defect.created_by === me.id || me.role === 'admin'),
  // Opravená závada je zamčená: upravit nebo smazat ji smí jen administrátor
  editDefect: (me, defect) => can.edit(me, defect) && (!defect.resolved_at || me.role === 'admin'),
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

// ───── Datum zjištění ─────

export const foundAtOf = (d) => d.found_at ?? d.created_at;

// Hodnota pro <input type="datetime-local"> v místním čase: "2026-10-16T10:12"
export function toLocalInput(date) {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Stejná pravidla hlídá databáze (supabase/schema.sql → prepare_defect, protect_defect).
// 5 minut rezerva na nepřesně nařízené hodiny v telefonu.
export function checkFoundAt(value, resolvedAt) {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return 'Vyplňte datum a čas zjištění.';
  if (t > Date.now() + 5 * 60 * 1000) return 'Datum zjištění nemůže být v budoucnosti.';
  if (resolvedAt && t > Date.parse(resolvedAt)) return 'Datum zjištění nemůže být pozdější než oprava závady.';
  return null;
}
