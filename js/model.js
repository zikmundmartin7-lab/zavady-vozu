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
// Kód státu nalepený na svou značku i bez pomlčky za ní („80D“ u přetřeného držitele, „80D-V“, „54CZ“) – oddělí se,
// jen když značka ke kódu patří (80 = D, 54 = CZ …), aby se „40O“ v těle čísla dál četlo jako 400.
const MARKS = { 10: 'FIN', 20: 'RUS', 21: 'BY', 22: 'UA', 23: 'MD', 24: 'LT', 25: 'LV', 26: 'EST', 27: 'KZ', 28: 'GE',
  41: 'AL', 44: 'BIH', 50: 'BIH', 51: 'PL', 52: 'BG', 53: 'RO', 54: 'CZ', 55: 'H', 56: 'SK', 57: 'AZ', 58: 'AM', 59: 'KS',
  60: 'IRL', 62: 'MNE', 65: 'MK', 70: 'GB', 71: 'E', 72: 'SRB', 73: 'GR', 74: 'S', 75: 'TR', 76: 'N', 78: 'HR', 79: 'SLO',
  80: 'D', 81: 'A', 82: 'L', 83: 'I', 84: 'NL', 85: 'CH', 86: 'DK', 87: 'F', 88: 'B', 94: 'P' };
const GLUED = /\b(\d{2})(\p{Lu}{1,3})(?![\p{L}\d])/gu;
const unglue = (m, cc, mark) => (MARKS[cc] === mark ? `${cc} ${mark}` : m);
// Dvojčíslí nalepené na RIV/TEN/PPW („31RIV“, i „31RV“) – oddělí se, jinak slovo s převahou písmen vypadne celé.
const MARK = /(\d)(?=(?:RI?V|TEN|PPW)\b)/g;
// Mezera mezi dvojčíslími přečtená jako tečka („31.54 3939 735-9“) – před osmi číslicemi to není desetinné číslo.
const PAIR_DOT = /\b(\d{2})\.(\d{2})(?=\s?\d{4}\s?\d{3})/g;
// … ani samotné „31.54“ v rámečku nad tělem nebo vedle něj, když je za tečkou kód státu
const PAIR_ALONE = /^\s*(\d{2})\.(\d{2})\s*$/;
const unpair = (m, a, b) => (COUNTRIES.has(Number(b)) ? `${a} ${b}` : m);

// Řádky s telefonem, e-mailem nebo adresou držitele („D-55252 Mainz-Kastel“, „+496134/94844-0“, „CZ 160 00“,
// „Komornická 7, Praha 6“, „421 01 Litoměřice“) – jejich číslice složily falešné číslo s platnou kontrolní číslicí
// nebo se vmísily mezi řádky čísla vedle nich.
const CONTACT = /\+\s?\d|@|\b(tel|fax|e-?mail|www|gmbh|str(aße|asse)?\.?)\b|\b[A-Z]-\d{4,5}\b/i;
const ADDRESS = /\b(?:CZ|SK)[- ]?\d{3} ?\d{2}\b|\b\d{3} \d{2} \p{Lu}\p{Ll}{3,}|\bPraha\b/u;

function digitTokens(lines) {
  const tokens = [];
  for (const [li, l] of lines.entries()) {
    if (CONTACT.test(l.text) || ADDRESS.test(l.text)) continue;
    const text = l.text.replace(PAIR_ALONE, unpair).replace(PAIR_DOT, '$1 $2').replace(DECIMAL, ' ')
      .replace(KEEPER, '$1 ').replace(GLUED, unglue).replace(MARK, '$1 ');
    for (const word of text.split(/[^0-9A-Za-z|!]+/)) {
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
 * known = indexWagons(čísla známých vozů): doplní začátek čísla, který se na voze nepřečetl (filled).
 */
export function numberCandidates(lines, known) {
  const tokens = digitTokens(lines);
  const found = new Map();
  // block = složeno z rozložení na voze (dvojčíslí + osm číslic v jednom řádku), rozdělení do skupin je tím dané;
  // filled = začátek čísla doplněný ze známých vozů: 'vuz' = vůz se stejným koncem čísla, 'rada' = jen podle řady
  const add = (number, parts, aligned, block = false, filled = null) => {
    const valid = isValidCheckDigit(number);
    const country = COUNTRIES.has(Number(number.slice(2, 4)));
    let n = 0;
    const grouped = block || (aligned && parts.every((t) => GROUP_ENDS.has((n += t.d.length))));
    const rows = parts.at(-1).row - parts[0].row;
    const score = parts.reduce((a, t) => a + t.conf, 0) / parts.length - rows * 0.3
      + (valid ? 10 : 0) + (country ? 2 : 0) + (grouped ? 2 : aligned ? 1 : 0) - (filled === 'rada' ? 3 : 0);
    // „jisté“ číslo: sedí kontrolní číslice, kód státu i rozdělení do skupin (náhodná shoda je velmi vzácná);
    // začátek doplněný jen podle řady jisté není (stejnou řadu mívají vozy různých držitelů)
    const sure = valid && country && grouped && filled !== 'rada';
    const prev = found.get(number);
    if (!prev || prev.score < score) found.set(number, { number, valid, sure, score, lines: [...new Set(parts.map((t) => t.li))], ...(filled ? { filled } : {}) });
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
  const blocks = numberBlocks(lines, tokens);
  for (const [a, b, body] of blocks.out) add(a.d + b.d + body.map((t) => t.d).join(''), [a, b, ...body], true, true);
  // Začátek čísla, který se na voze nepřečetl (přetřené nebo vybledlé „83“ nad „54 CZ-VDSP“ / „6836 052-3“), se doplní
  // ze známých vozů: tělo (5.–12. číslice, kontrolní číslice v něm) shodné s jediným známým vozem = jisté číslo,
  // jinak se jen nabídnou začátky vozů stejné řady (5.–8. číslice), se kterými sedí kontrolní číslice.
  if (known) {
    // i tělo rozdělené do obdélníků vedle sebe („6836“ „052-3“): po sobě jdoucí slova jednoho řádku s osmi číslicemi
    const split = [];
    for (let i = 0; i < tokens.length; i++) {
      let n = 0;
      let j = i;
      while (j < tokens.length && tokens[j].row === tokens[i].row && n < 8) n += tokens[j++].d.length;
      const body = tokens.slice(i, j);
      if (n !== 8 || tokens[i].d.length < 3 || new Set(body.map((t) => t.li)).size < 2) continue;
      split.push({ body, cc: tokens.slice(0, i).reverse().find((t) => t.first && t.d.length === 2 && t.row === tokens[i].row - 1) ?? null });
    }
    for (const { body, cc } of [...blocks.bodies, ...split]) {
      const b = body.map((t) => t.d).join('');
      const parts = cc ? [cc, ...body] : body;
      const same = known.body.get(b) ?? [];
      // kód státu přečtený nad tělem nebo před ním vybere mezi vozy se stejným tělem (sám může být přečtený špatně)
      const pick = same.length === 1 ? same : same.filter((x) => x.slice(2, 4) === cc?.d);
      if (pick.length === 1) {
        if (!found.has(pick[0])) add(pick[0], parts, true, true, 'vuz');
        continue;
      }
      const offers = same.length ? same : [...(known.series.get(b.slice(0, 4)) ?? [])].map((p) => p + b).filter(isValidCheckDigit);
      const own = offers.filter((x) => x.slice(2, 4) === cc?.d);
      for (const x of (own.length ? own : offers).slice(0, 3)) if (!found.has(x)) add(x, parts, true, true, 'rada');
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * Rejstřík známých čísel vozů (evidence, paměť vozů) pro numberCandidates: body = 5.–12. číslice → čísla vozů,
 * series = 5.–8. číslice (řada) → první čtyři číslice vozů té řady.
 */
export function indexWagons(numbers) {
  const body = new Map();
  const series = new Map();
  for (const n of new Set(numbers)) {
    if (!/^\d{12}$/.test(n) || !isValidCheckDigit(n)) continue;
    if (!body.has(n.slice(4))) body.set(n.slice(4), []);
    body.get(n.slice(4)).push(n);
    if (!series.has(n.slice(4, 8))) series.set(n.slice(4, 8), new Set());
    series.get(n.slice(4, 8)).add(n.slice(0, 4));
  }
  return { body, series };
}

/**
 * Číslo podle rozložení na voze, nezávisle na pořadí řádků (na novějších vozech „33 RIV“ / „80 D-TWA“ / „2742 187-8“:
 * při mírném náklonu se řádky slijí a pořadí se pomíchá, mezi části vlezou cizí číslice). Tělo = osm číslic
 * v jednom řádku (i rozdělených „495 6 322-2“ nebo v obdélnících těsně vedle sebe); před ním dvě dvojčíslí,
 * každé na začátku svého řádku: pod sebou zarovnaná vlevo s tělem (nad ním), nebo vlevo od těla ve stejném
 * řádku (tam i obě v jednom obdélníku „84 54“). Vrací out = [[a, b, tělo]]
 * a bodies = [{ body, cc }] – každé tělo s dvojčíslím těsně nad ním nebo před ním (kód státu), pokud je.
 */
function numberBlocks(lines, tokens) {
  const out = [];
  const bodies = [];
  const box = (t) => lines[t.li];
  // svislá poloha kolmo na převažující sklon řádků: na šikmém snímku jsou řádky „33 RIV“ / „80 D-TWA“ / tělo
  // podle středů obdélníků skoro ve stejné výšce. Sklon = medián vážený plochou obdélníku, řádky bez sklonu
  // (čtení narovnává až od 2°) se počítají jako rovné – jinak sklon určil drobný text okolo (šikmá cedulka,
  // tabulka) a rovné řádky čísla se rozešly (sortLines v ocr.js počítá jen narovnané řádky).
  const angles = lines.map((l) => [l.angle ?? 0, l.w * l.h]).sort((a, b) => a[0] - b[0]);
  let half = angles.reduce((s, [, w]) => s + w, 0) / 2;
  const tilt = angles.find(([, w]) => (half -= w) <= 0)?.[0] ?? 0;
  const cy = (t) => -(box(t).x + box(t).w / 2) * Math.sin(tilt) + (box(t).y + box(t).h / 2) * Math.cos(tilt);
  const pairs = tokens.filter((t) => t.first && t.d.length === 2);
  // obdélníky jen s dvojčíslími („84 54“ vlevo od těla) – vlevo se počítají všechna jejich dvojčíslí
  const pairBox = (li) => tokens.every((t) => t.li !== li || t.d.length === 2);
  for (const li of new Set(tokens.map((t) => t.li))) {
    const own = tokens.filter((t) => t.li === li);
    // tělo: souvislá část slov řádku s právě osmi číslicemi (4-3-1, s rozdělením, které čtení přidá), případně
    // pokračující v obdélnících těsně napravo ve stejné výšce („6992“ „021- 9 Faccs“ – na šikmé fotce jim
    // čtení může přidělit i různé řádky)
    for (let i = 0; i < own.length; i++) {
      if (own[i].d.length < 3) continue;
      const h = own[i].h;
      const body = [];
      let n = 0;
      for (let j = i; j < own.length && n < 8; j++) n += body[body.push(own[j]) - 1].d.length;
      for (let last = li; n < 8;) {
        const L = lines[last];
        const next = tokens.filter((t) => t.first && t.li !== last && !body.includes(t) && box(t).x > L.x + L.w * 0.5
          && box(t).x - (L.x + L.w) < h * 2 && Math.abs(cy(t) - cy(body.at(-1))) < h * 0.5
          && Math.max(t.h, h) / Math.min(t.h, h) < 1.4).sort((p, q) => box(p).x - box(q).x)[0];
        if (!next) break;
        last = next.li;
        for (const t of tokens) if (t.li === last && n < 8) n += body[body.push(t) - 1].d.length;
      }
      if (n !== 8) continue;
      const B = box(body[0]);
      const yb = cy(body[0]);
      // dvojčíslí bývají menším písmem než tělo (na vozech TSI zhruba polovičním)
      const near = pairs.filter((p) => p.li !== li && Math.max(p.h, h) / Math.min(p.h, h) < 2.6);
      const side = tokens.filter((p) => p.d.length === 2 && p.li !== li && (p.first || pairBox(p.li))
        && Math.max(p.h, h) / Math.min(p.h, h) < 2.6);
      // pod sebou: nad tělem, levý okraj do 1,5 výšky těla od levého okraje těla; řádky od sebe aspoň
      // půl výšky svého písma, nejvýš 3 výšky těla
      const above = near.filter((p) => cy(p) < yb && Math.abs(box(p).x - B.x) < h * 1.5).sort((p, q) => cy(p) - cy(q));
      for (let k = 0; k + 1 < above.length; k++) {
        const [a, b] = [above[k], above[k + 1]];
        if (cy(b) - cy(a) > a.h * 0.5 && yb - cy(b) > b.h * 0.5 && yb - cy(a) < h * 3) out.push([a, b, body]);
      }
      // v jednom řádku: dvě dvojčíslí vlevo od těla ve stejné výšce (samostatné rámečky v pořadí zleva,
      // pak dvojčíslí na začátku řádku těla „52 495 6 322-2“)
      const left = [...side.filter((p) => Math.abs(cy(p) - yb) < Math.max(p.h, h) * 0.5 && box(p).x + box(p).w <= B.x + h * 0.3
        && B.x - box(p).x < Math.max(p.h, h) * 8).sort((p, q) => box(p).x - box(q).x || tokens.indexOf(p) - tokens.indexOf(q)),
      ...own.slice(0, i).filter((t) => t.d.length === 2)];
      if (left.length >= 2) out.push([left.at(-2), left.at(-1), body]);
      // kód státu: nejbližší dvojčíslí nad tělem (do 1,5 výšky těla), jinak vlevo ve stejném řádku
      const up = above.filter((p) => yb - cy(p) > p.h * 0.5 && yb - cy(p) < h * 1.5).at(-1);
      bodies.push({ body, cc: up ?? left.at(-1) ?? null });
    }
  }
  return { out, bodies };
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
