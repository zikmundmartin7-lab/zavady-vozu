// Popis záznamů historie (audit_log) česky: co se stalo a co se změnilo.

import { ROLES, formatDateTime, formatNumber, plural } from './model.js';

const short = (s, n = 90) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const quote = (s) => `„${short(s)}“`;
const kind = (row) => (row?.kind === 'video' ? 'video' : 'fotku');

function defectChanges(o, n) {
  const lines = [];
  let title = 'upravil(a) závadu';
  if (!o.resolved_at && n.resolved_at) {
    title = 'označil(a) závadu jako opravenou';
    if (n.resolution_note) lines.push(`poznámka k opravě: ${quote(n.resolution_note)}`);
  } else if (o.resolved_at && !n.resolved_at) {
    title = 'vrátil(a) závadu mezi neopravené';
  } else if (o.resolution_note !== n.resolution_note) {
    lines.push(`poznámka k opravě: ${quote(o.resolution_note || '—')} → ${quote(n.resolution_note || '—')}`);
  }
  if (o.description !== n.description) lines.push(`popis: ${quote(o.description)} → ${quote(n.description)}`);
  if ((o.defect_code ?? null) !== (n.defect_code ?? null)) lines.push(`kód závady: ${o.defect_code || '—'} → ${n.defect_code || '—'}`);
  if (o.found_at !== n.found_at && Date.parse(o.found_at) !== Date.parse(n.found_at)) {
    lines.push(`datum zjištění: ${formatDateTime(o.found_at)} → ${formatDateTime(n.found_at)}`);
  }
  return { title, lines };
}

/**
 * Vrací { title, lines } – title doplňuje jméno toho, kdo změnu udělal („Eva Svobodová: …“).
 * groups: volitelná mapa id skupiny → název (pro přesun vozu mezi skupinami).
 */
export function describe(e, groups) {
  const o = e.old_row ?? {};
  const n = e.new_row ?? {};
  const r = e.new_row ?? e.old_row ?? {};
  const restored = e.action === 'restore';
  switch (e.tbl) {
    case 'defects':
      if (e.action === 'insert') return { title: 'vložil(a) závadu', lines: [quote(n.description)] };
      if (e.action === 'delete') return { title: 'smazal(a) závadu', lines: [quote(o.description)] };
      if (restored) return { title: 'obnovil(a) závadu z koše', lines: [quote(n.description)] };
      return defectChanges(o, n);
    case 'attachments':
      if (e.action === 'insert') return { title: `přidal(a) ${kind(r)}`, lines: [] };
      if (e.action === 'delete') return { title: `odebral(a) ${kind(r)}`, lines: [] };
      if (restored) return { title: `obnovil(a) ${kind(r)} z koše`, lines: [] };
      break;
    case 'comments':
      if (e.action === 'insert') return { title: 'napsal(a) komentář', lines: [quote(r.body)] };
      if (e.action === 'delete') return { title: 'smazal(a) komentář', lines: [quote(r.body)] };
      if (restored) return { title: 'obnovil(a) komentář z koše', lines: [quote(r.body)] };
      break;
    case 'wagons':
      if (e.action === 'insert') return { title: `přidal(a) vůz ${formatNumber(r.number)}`, lines: [] };
      if (e.action === 'delete') return { title: `smazal(a) vůz ${formatNumber(r.number)}`, lines: [] };
      if (restored) return { title: `obnovil(a) vůz ${formatNumber(r.number)} z koše`, lines: [] };
      if (o.group_id !== n.group_id) {
        const g = (id) => groups?.get(id) ?? `skupina ${id}`;
        return { title: `přesunul(a) vůz ${formatNumber(r.number)} do jiné skupiny`, lines: [`${g(o.group_id)} → ${g(n.group_id)}`] };
      }
      return { title: `upravil(a) vůz ${formatNumber(r.number)}`, lines: [] };
    case 'profiles':
      if (e.action === 'insert') return { title: `zaregistroval(a) se: ${r.full_name || r.email}`, lines: [] };
      if (o.role !== n.role) {
        return { title: `změnil(a) roli uživatele ${n.full_name || n.email}`, lines: [`${ROLES[o.role] ?? o.role} → ${ROLES[n.role] ?? n.role}`] };
      }
      if (o.full_name !== n.full_name) return { title: 'změnil(a) jméno', lines: [`${o.full_name || '—'} → ${n.full_name || '—'}`] };
      return { title: 'upravil(a) profil', lines: [] };
    case 'regulations':
      if (e.action === 'insert') return { title: `nahrál(a) předpis ${quote(r.title)}`, lines: [] };
      if (e.action === 'delete') return { title: `smazal(a) předpis ${quote(r.title)}`, lines: [] };
      if (restored) return { title: `obnovil(a) předpis ${quote(r.title)} z koše`, lines: [] };
      return { title: `upravil(a) předpis ${quote(r.title)}`, lines: [] };
    default:
  }
  return { title: `${e.action} ${e.tbl}`, lines: [] };
}

export const actorName = (e) => e.actor_name
  || (e.tbl === 'profiles' && e.action === 'insert' ? (e.new_row?.full_name || 'nový uživatel') : 'systém');

/**
 * Koš: smazané záznamy seskupené podle akce (tx) – jedna položka = co se smazalo jedním klepnutím.
 * wagonNumbers: mapa id vozu → číslo (i u smazaných vozů z koše).
 */
export function groupTrash(entries, wagonNumbers) {
  const byTx = new Map();
  for (const e of entries) {
    if (!byTx.has(e.tx)) byTx.set(e.tx, []);
    byTx.get(e.tx).push(e);
  }
  const groups = [];
  for (const [tx, items] of byTx) {
    const pick = (tbl) => items.filter((x) => x.tbl === tbl);
    const wagons = pick('wagons');
    const defects = pick('defects');
    const comments = pick('comments');
    const atts = pick('attachments');
    const regs = pick('regulations');
    const num = (id) => (wagonNumbers?.get(id) ? formatNumber(wagonNumbers.get(id)) : 'neznámý vůz');
    let title;
    const lines = [];
    if (wagons.length) {
      title = `Vůz ${formatNumber(wagons[0].old_row.number)}`;
      if (defects.length) lines.push(`${plural(defects.length, 'závada', 'závady', 'závad')} včetně fotek a komentářů`);
    } else if (defects.length) {
      const d = defects[0].old_row;
      title = `Závada na voze ${num(d.wagon_id)}`;
      lines.push(quote(d.description));
      const parts = [
        atts.length && plural(atts.length, 'fotka/video', 'fotky/videa', 'fotek/videí'),
        comments.length && plural(comments.length, 'komentář', 'komentáře', 'komentářů'),
      ].filter(Boolean);
      if (parts.length) lines.push(parts.join(', '));
    } else if (comments.length) {
      const c = comments[0].old_row;
      title = `Komentář u závady na voze ${num(comments[0].wagon_id)}`;
      lines.push(quote(c.body));
    } else if (atts.length) {
      title = `${atts.length === 1 ? 'Fotka/video' : plural(atts.length, '', 'fotky/videa', 'fotek/videí')} u závady na voze ${num(atts[0].wagon_id)}`;
    } else if (regs.length) {
      title = `Předpis ${quote(regs[0].old_row.title)}`;
    } else {
      title = `Smazaný záznam (${items[0].tbl})`;
    }
    const first = items.reduce((a, b) => (a.at < b.at ? a : b));
    groups.push({ tx, title, lines, at: first.at, actor: actorName(first), count: items.length });
  }
  return groups.sort((a, b) => b.at.localeCompare(a.at));
}
