// Kódy závad podle přílohy 9 VSP: hledání v katalogu a pomocné funkce pro pole s kódem.
// Kód má až 4 úrovně, každá 1–2 číslice: 1, 1.1, 1.2.2.1, 6.1.1.12.

export const CODE_RE = /^\d{1,2}(\.\d{1,2}){0,3}$/;
const CODE_QUERY_RE = /^\d{1,2}(\.\d{0,2}){0,3}$/;

// Malá písmena bez diakritiky; délka textu zůstává stejná (kvůli zvýrazňování shod).
export function fold(s) {
  return [...String(s ?? '')].map((ch) => (ch.normalize('NFD')[0] ?? ch).toLowerCase()).join('');
}

// Hledané texty: sloupec „konstrukční část“ (cesta) a sloupec „závady a poškození“ (kontext, popis, poznámka)
const prepared = new WeakMap();
function prepare(catalog) {
  if (!prepared.has(catalog)) {
    prepared.set(catalog, catalog.map((c) => ({
      c,
      part: fold(c.cesta),
      text: fold([c.kontext, c.popis, c.poznamka].filter(Boolean).join(' ')),
    })));
  }
  return prepared.get(catalog);
}

export const queryTokens = (query) => fold(query).split(/[\s,;]+/).filter((t) => t.length > 0);

// Kmen slova kvůli skloňování: „ploché místo“ najde i „plochá místa“, „špalík“ i „špalíky“.
// U slov od 5 písmen se uříznou poslední 2 znaky, u 4písmenných 1; kmen se hledá jen na začátku slova.
const stemOf = (t) => (t.length >= 5 ? t.slice(0, -2) : t.length === 4 ? t.slice(0, -1) : t);
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function terms(query) {
  return queryTokens(query).map((full) => {
    const stem = stemOf(full);
    return { full, stem, re: new RegExp(`(^|[^a-z0-9])${escapeRe(stem)}`) };
  });
}
const has = (field, term) => field.includes(term.full) || term.re.test(field);

// Slova ke zvýraznění ve výsledcích (celá slova i jejich kmeny)
export const highlightTokens = (query) => [...new Set(terms(query).flatMap((t) => [t.full, t.stem]))];

// Kód začíná zadaným začátkem po celých úrovních; poslední zadaná úroveň může být rozepsaná („4.1“ najde 4.1 i 4.10).
function codeStartsWith(kod, q) {
  const want = q.replace(/\.$/, '').split('.');
  const have = kod.split('.');
  if (have.length < want.length) return false;
  return want.every((w, i) => (i < want.length - 1 || q.endsWith('.') ? have[i] === w : have[i].startsWith(w)));
}

/**
 * Hledání v katalogu jedním polem: číslo kódu, nebo slova z konstrukční části či popisu závady
 * (není potřeba volit sloupec). Vrací [{ c, inPart, inText }] seřazené podle shody a pořadí v katalogu.
 */
export function searchCodes(catalog, query, limit = 60) {
  const q = query.trim().replace(/,/g, '.');
  if (!q || !catalog?.length) return [];
  if (CODE_QUERY_RE.test(q)) {
    return catalog.filter((c) => codeStartsWith(c.kod, q)).slice(0, limit).map((c) => ({ c, code: true }));
  }
  const ts = terms(q);
  const hits = [];
  for (const p of prepare(catalog)) {
    let score = 0;
    let inPart = false;
    let inText = false;
    let ok = true;
    for (const t of ts) {
      const a = has(p.part, t);
      const b = has(p.text, t);
      if (!a && !b) { ok = false; break; }
      if (a) { inPart = true; score += 3; }
      if (b) { inText = true; score += 1; }
      // přesná shoda celého slova má přednost před shodou kmene
      if (p.part.includes(t.full) || p.text.includes(t.full)) score += 1;
    }
    if (ok) hits.push({ c: p.c, inPart, inText, score });
  }
  hits.sort((x, y) => y.score - x.score || x.c.poradi - y.c.poradi);
  return hits.slice(0, limit);
}

// Úseky textu, které odpovídají hledaným slovům: [[od, do], …] (bez ohledu na diakritiku)
export function matchRanges(text, tokens) {
  const f = fold(text);
  const ranges = [];
  for (const t of tokens) {
    let i = f.indexOf(t);
    while (i !== -1) {
      ranges.push([i, i + t.length]);
      i = f.indexOf(t, i + t.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

// ───── Pole pro kód: 4 políčka, tečky se doplňují samy podle katalogu ─────

// Hodnoty, které v katalogu následují za daným začátkem kódu: '' → {1,2,…,8}, '4' → {1,…,10}
function nextLevelValues(catalog, prefix) {
  const depth = prefix ? prefix.split('.').length : 0;
  const values = new Set();
  for (const c of catalog ?? []) {
    const parts = c.kod.split('.');
    if (parts.length > depth && (!prefix || parts.slice(0, depth).join('.') === prefix)) values.add(parts[depth]);
  }
  return values;
}

/**
 * Upraví text psaný do pole s kódem: povolí jen číslice a tečky (čárka/mezera = tečka),
 * max. 4 úrovně po 2 číslicích. Při psaní doplní tečku, jakmile je úroveň jednoznačně hotová:
 * po 2 číslicích, nebo po 1 číslici, když v katalogu na této úrovni neexistuje dvoumístná hodnota
 * začínající touto číslicí (např. po „4.1“ se čeká, protože existuje 4.10).
 */
export function typeCode(prev, raw, catalog) {
  let v = raw.replace(/[, ]/g, '.').replace(/[^\d.]/g, '').replace(/\.{2,}/g, '.').replace(/^\./, '');
  const parts = v.split('.');
  const fixed = [];
  for (const p of parts.slice(0, 4)) {
    if (p.length > 2) {
      // příliš dlouhá úroveň → rozdělit (např. vložené „4101“)
      fixed.push(p.slice(0, 2));
      if (fixed.length < 4) fixed.push(p.slice(2, 4));
    } else fixed.push(p);
  }
  v = fixed.slice(0, 4).join('.');
  const grew = v.length > prev.length && v.startsWith(prev.replace(/\.$/, ''));
  if (!grew) return v.replace(/\.$/, '');
  const segs = v.split('.');
  const last = segs.at(-1);
  if (!last || segs.length >= 4) return v;
  const prefix = segs.slice(0, -1).join('.');
  const finished = last.length === 2
    || (catalog?.length && ![...nextLevelValues(catalog, prefix)].some((x) => x.length === 2 && x.startsWith(last)));
  return finished ? `${v}.` : v;
}

export const codeOf = (typed) => typed.replace(/\.$/, '');
