// Skupina nového vozu podle čísla: 5.–8. číslice čísla vozu určují řadu (např. 6937 → Faccnpps).
// 1) Když už v evidenci jsou vozy se stejnými číslicemi, převezme se skupina, do které jich patří nejvíc
//    (rozhodli o ní vozmistři, takže platí přednostně). Bez signálu z vozů uložených v telefonu (js/offline.js).
// 2) Jinak podle písmen řady z tabulek ERA (data/rady.json převzaté z aplikace Výkaz vozů, js/series.js tam;
//    zdroj ERA Appendix 6 Part 9). Ostatní řady se nepředvyplňují.

import { digitsOnly } from './model.js';
import { readCached } from './ui.js';

let table = null;
function loadSeries() {
  table ??= fetch(new URL('../data/rady.json', import.meta.url)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return table;
}

/** Písmenné označení řady (např. „Faccnpps“), nebo null. */
export async function seriesName(number) {
  const d = digitsOnly(number);
  return d.length < 8 ? null : (await loadSeries())[d.slice(4, 8)] ?? null;
}

// Skupiny aplikace podle písmen řady (klíč = wagon_groups.name). Tabulky ERA dávají plné označení,
// proto se porovnává začátek a typická písmena (Faccpp = Facc… s pp, ostatní Facc… = Faccs).
const GROUP_RULES = [
  ['Faccpp', (s) => /^Facc/.test(s) && /pp/.test(s)],
  ['Faccs', (s) => /^Facc/.test(s)],
  ['Fals', (s) => /^Fal/.test(s)],
  ['Ua', (s) => /^Ua/.test(s)],
  ['Uk, Gbgs', (s) => /^(Uk|Gbg)/.test(s)],
  ['Res, Smmp', (s) => /^(Res|Smm)/.test(s)],
];

async function sameSeriesWagons(api, code) {
  try {
    return await api.listSeriesWagons(code);
  } catch {
    // bez signálu: vozy uložené v telefonu při stahování na pozadí
    const groups = readCached(api.mode, 'groups') ?? [];
    return groups.flatMap((g) => readCached(api.mode, `wagons:${g.id}`) ?? [])
      .filter((w) => w.number.slice(4, 8) === code);
  }
}

/**
 * Návrh skupiny pro nový vůz: { groupId, series, count } – count = kolik vozů stejné řady v evidenci tu skupinu má
 * (0 = podle písmen řady); groupId null = skupinu nejde odhadnout. null = číslo není celé.
 */
export async function suggestGroup(api, number, groups) {
  const d = digitsOnly(number);
  if (d.length !== 12) return null;
  const [series, similar] = await Promise.all([seriesName(d), sameSeriesWagons(api, d.slice(4, 8))]);
  const counts = new Map();
  for (const w of similar) if (w.number !== d) counts.set(w.group_id, (counts.get(w.group_id) ?? 0) + 1);
  const [top] = [...counts].sort((a, b) => b[1] - a[1]);
  if (top && groups.some((g) => g.id === top[0])) return { groupId: top[0], series, count: top[1] };
  const name = series && GROUP_RULES.find(([, rule]) => rule(series))?.[0];
  return { groupId: groups.find((g) => g.name === name)?.id ?? null, series, count: 0 };
}
