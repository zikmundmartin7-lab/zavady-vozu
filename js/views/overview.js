// Přehled závad napříč všemi vozy: filtry (stav, skupina, hledání, období, řazení) a export do Excelu.

import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { fold } from '../codes.js';
import { foundAtOf, formatDateTime, formatNumber, groupLabel, plural } from '../model.js';
import {
  BottomNav, DefectCard, Empty, ErrorBox, GroupName, Icon, Loading, OutboxBanner, TopBar, UserButton, WagonNumber, isNewDefect,
  useApp, useCatalog, useLoad, useScreenState, useWagonSeen,
} from '../ui.js';

const STATUS = { open: 'Neopravené', resolved: 'Opravené', all: 'Všechny' };
const PAGE = 150;

// Filtry platí, dokud je aplikace otevřená – i po návratu ze závady a přepnutí záložek (přání uživatele 31. 10.)
const FILTERS_KEY = 'zavady-prehled';
const FILTERS = { status: 'open', groupIds: [], q: '', from: '', to: '', sort: 'new', more: false };
function savedFilters() {
  try { return { ...FILTERS, ...JSON.parse(sessionStorage.getItem(FILTERS_KEY)) }; } catch { return FILTERS; }
}

/**
 * Export seznamu závad do Excelu (stejné sloupce jako pravidelný export ze serveru).
 * První list obsahuje všechny závady, pak má každá skupina vozů vlastní list (je-li jich víc).
 * chosen = vybrané skupiny (list mají vždy, i prázdný); bez výběru jen skupiny, kde jsou závady.
 */
export async function exportDefects(rows, catalog, label, groups = [], chosen = []) {
  const { buildXlsx, download } = await import('../xlsx.js');
  const parts = new Map((catalog ?? []).map((c) => [c.kod, c.cesta]));
  const date = (iso) => (iso ? new Date(iso) : '');
  const columns = [
    { header: 'Číslo vozu', width: 18, value: (r) => formatNumber(r.number) },
    { header: 'Skupina', width: 16, value: (r) => r.group_name },
    { header: 'Kód závady', width: 11, value: (r) => r.defect_code ?? '' },
    { header: 'Konstrukční část (dle kódu)', width: 34, value: (r) => (r.defect_code ? parts.get(r.defect_code) ?? '' : '') },
    { header: 'Popis závady', width: 50, value: (r) => r.description },
    { header: 'Zjištěno', width: 16, value: (r) => date(foundAtOf(r)) },
    { header: 'Vložil(a)', width: 18, value: (r) => r.created_by_name ?? '' },
    { header: 'Vloženo', width: 16, value: (r) => date(r.created_at) },
    { header: 'Stav', width: 12, value: (r) => (r.resolved_at ? 'Opraveno' : 'Neopravená') },
    { header: 'Opraveno', width: 16, value: (r) => date(r.resolved_at) },
    { header: 'Opravil(a)', width: 18, value: (r) => r.resolved_by_name ?? '' },
    { header: 'Poznámka k opravě', width: 30, value: (r) => r.resolution_note ?? '' },
    { header: 'Komentářů', width: 11, value: (r) => r.comment_count ?? 0 },
    { header: 'Fotek a videí', width: 13, value: (r) => r.attachment_count ?? 0 },
  ];
  const present = chosen.length ? chosen : groups.filter((g) => rows.some((r) => r.group_id === g.id));
  const sheets = present.length === 1
    ? [{ name: groupLabel(present[0]), rows }]
    : [{ name: 'Všechny závady', rows },
      ...present.map((g) => ({ name: groupLabel(g), rows: rows.filter((r) => r.group_id === g.id) }))];
  const blob = buildXlsx(sheets.map((sh) => ({ ...sh, columns })));
  const day = new Date().toISOString().slice(0, 10);
  download(blob, `zavady-${label}-${day}.xlsx`);
}

export function OverviewView() {
  const { api, toast, seenWagons } = useApp();
  const catalog = useCatalog();
  const [saved] = useState(savedFilters);
  const [status, setStatus] = useState(saved.status);
  const data = useLoad(() => api.listOverview(status), [status], `overview:${status}`);
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const [groupIds, setGroupIds] = useState(saved.groupIds); // prázdné = všechny skupiny
  const [q, setQ] = useState(saved.q);
  const [from, setFrom] = useState(saved.from);
  const [to, setTo] = useState(saved.to);
  const [sort, setSort] = useState(saved.sort);
  const [more, setMore] = useState(saved.more);
  const [limit, setLimit] = useScreenState('limit', PAGE);
  const [opened, setOpened] = useScreenState('opened', []); // rozbalené závady (id)
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ status, groupIds, q, from, to, sort, more })); } catch { /* nevadí */ }
  }, [status, groupIds, q, from, to, sort, more]);

  const rows = useMemo(() => {
    const list = data.data ?? [];
    const tokens = fold(q).split(/\s+/).filter(Boolean);
    const fromT = from ? Date.parse(`${from}T00:00`) : null;
    const toT = to ? Date.parse(`${to}T23:59:59`) : null;
    const out = list.filter((r) => {
      if (groupIds.length && !groupIds.includes(r.group_id)) return false;
      const t = Date.parse(foundAtOf(r));
      if (fromT && t < fromT) return false;
      if (toT && t > toT) return false;
      if (tokens.length) {
        const hay = fold(`${r.number} ${formatNumber(r.number)} ${r.defect_code ?? ''} ${r.description} ${r.created_by_name ?? ''} ${r.resolved_by_name ?? ''} ${r.group_name}`);
        if (!tokens.every((tok) => hay.includes(tok))) return false;
      }
      return true;
    });
    const by = {
      new: (a, b) => Date.parse(foundAtOf(b)) - Date.parse(foundAtOf(a)),
      old: (a, b) => Date.parse(foundAtOf(a)) - Date.parse(foundAtOf(b)),
      wagon: (a, b) => a.number.slice(-4).localeCompare(b.number.slice(-4)) || a.number.localeCompare(b.number),
    }[sort];
    return out.sort(by);
  }, [data.data, groupIds, q, from, to, sort]);

  async function doExport() {
    setBusy(true);
    try {
      const chosen = (groups.data ?? []).filter((g) => groupIds.includes(g.id));
      const slug = (t) => fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const label = [{ open: 'neopravene', resolved: 'opravene', all: 'vsechny' }[status],
        chosen.length > 3 ? `${chosen.length}-skupin` : chosen.map((g) => slug(g.name)).join('-')].filter(Boolean).join('-');
      await exportDefects(rows, catalog, label, groups.data ?? [], chosen);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  // Nepřečtená = nová závada od ostatních, jejíž vůz uživatel od jejího vložení neotevřel (je tučně).
  // Otevření vozu v této relaci platí hned, i než se přehled znovu načte ze sítě.
  const unread = (r) => r.is_new && !(seenWagons.get(r.wagon_id) > Date.parse(r.created_at));
  const filtersActive = groupIds.length || q || from || to;
  const toggleGroup = (id) => setGroupIds(groupIds.includes(id) ? groupIds.filter((x) => x !== id) : [...groupIds, id]);
  const toggleRow = (id) => setOpened(opened.includes(id) ? opened.filter((x) => x !== id) : [...opened, id]);

  return html`
    <${TopBar} title="Přehled závad" sub="Všechny vozy"><${UserButton} /><//>
    <main class="page with-nav">
      <${OutboxBanner} />
      <div class="segmented" role="group" aria-label="Stav závad">
        ${Object.entries(STATUS).map(([k, v]) => html`
          <button type="button" aria-pressed=${status === k} onClick=${() => { setStatus(k); setLimit(PAGE); }}>${v}</button>`)}
      </div>
      <label class="search-box">
        <${Icon} name="search" />
        <input type="search" placeholder="Hledat: číslo vozu, kód, popis, jméno" value=${q}
          onInput=${(e) => { setQ(e.currentTarget.value); setLimit(PAGE); }} />
      </label>
      <div class="chips-select">
        <button type="button" class="chip-btn ${!groupIds.length ? 'active' : ''}" aria-pressed=${!groupIds.length}
          onClick=${() => setGroupIds([])}>Všechny skupiny</button>
        ${groups.data?.map((g) => html`
          <button type="button" key=${g.id} class="chip-btn ${groupIds.includes(g.id) ? 'active' : ''}"
            aria-pressed=${groupIds.includes(g.id)} onClick=${() => toggleGroup(g.id)}><${GroupName} g=${g} /></button>`)}
      </div>
      <button type="button" class="link-btn" onClick=${() => setMore(!more)}>${more ? 'Skrýt další filtry' : 'Další filtry (období, řazení)'}</button>
      ${more && html`
        <div class="card filters">
          <label class="field">Zjištěno od<input type="date" value=${from} onInput=${(e) => setFrom(e.currentTarget.value)} /></label>
          <label class="field">Zjištěno do<input type="date" value=${to} onInput=${(e) => setTo(e.currentTarget.value)} /></label>
          <label class="field">Řazení
            <select value=${sort} onChange=${(e) => setSort(e.currentTarget.value)}>
              <option value="new">Nejnovější nahoře</option>
              <option value="old">Nejstarší nahoře</option>
              <option value="wagon">Podle posledního čtyřčíslí vozu</option>
            </select></label>
          ${filtersActive && html`<button type="button" class="btn" onClick=${() => { setGroupIds([]); setQ(''); setFrom(''); setTo(''); }}>Zrušit filtry</button>`}
        </div>`}

      <div class="overview-bar">
        <span class="muted">${data.data ? plural(rows.length, 'závada', 'závady', 'závad') : ''}</span>
        <span class="spacer"></span>
        <button class="btn" disabled=${busy || !rows.length} onClick=${doExport}><${Icon} name="download" size=${18} /> Export do Excelu</button>
      </div>

      <${ErrorBox} error=${data.error} />
      ${!data.data && data.loading && html`<${Loading} />`}
      ${data.data && rows.length === 0 && html`<${Empty}>Žádné závady neodpovídají filtru.<//>`}
      <div class="overview-list">
        ${rows.slice(0, limit).map((r) => {
          // Klepnutím se závada rozbalí přímo v seznamu (přání uživatele 31. 10. – jako pohyby v internetovém
          // bankovnictví), ostatní zůstanou vidět; dalším klepnutím na hlavičku se zase zabalí.
          const isOpen = opened.includes(r.id);
          return html`
          <div key=${r.id} class="overview-row ${r.resolved_at ? 'resolved' : ''} ${unread(r) ? 'unread' : ''} ${isOpen ? 'open' : ''}">
            <button type="button" class="overview-toggle" aria-expanded=${isOpen} onClick=${() => toggleRow(r.id)}>
              <div class="overview-head">
                ${unread(r) && html`<span class="unread-dot" title="Nová závada – vůz jste od jejího zapsání neotevřeli"></span>`}
                <${WagonNumber} number=${r.number} />
                <span class="muted small">${r.group_name}</span>
                <span class="spacer"></span>
                ${!isOpen && r.defect_code && html`<span class="chip chip-code">kód ${r.defect_code}</span>`}
                ${!isOpen && r.resolved_at && html`<span class="chip chip-ok">Opraveno</span>`}
                <${Icon} name="down" size=${18} class=${`muted ${isOpen ? 'flip' : ''}`} />
              </div>
              ${!isOpen && html`
                <div class="overview-text">${r.description}</div>
                <div class="muted small">
                  zjištěno ${formatDateTime(foundAtOf(r))} · ${r.created_by_name || 'neznámý'}
                  ${r.comment_count ? ` · ${plural(r.comment_count, 'komentář', 'komentáře', 'komentářů')}` : ''}
                  ${r.attachment_count ? ` · ${r.attachment_count} 📎` : ''}
                  ${r.resolved_at ? ` · opraveno ${formatDateTime(r.resolved_at)}` : ''}
                </div>`}
            </button>
            ${isOpen && html`<${OverviewDefect} r=${r} />`}
          </div>`;
        })}
      </div>
      ${rows.length > limit && html`
        <button class="btn btn-ghost block toggle" onClick=${() => setLimit(limit + PAGE)}>Zobrazit další (${rows.length - limit})</button>`}
    </main>
    <${BottomNav} active="prehled" />`;
}

// Rozbalená závada v Přehledu: celá karta jako na obrazovce vozu (fotky, komentáře, WhatsApp, oprava) a odkaz na vůz.
// Bere se ze závad vozu (stejná zásoba jako obrazovka vozu – funguje i bez signálu); rozbalením je vůz prohlédnutý.
function OverviewDefect({ r }) {
  const { api, me } = useApp();
  const defects = useLoad(() => api.listDefects(r.wagon_id), [r.wagon_id], `defects:${r.wagon_id}`);
  const seenBefore = useWagonSeen(r.wagon_id);
  const d = defects.data?.find((x) => x.id === r.id);
  return html`
    <div class="overview-detail">
      <${ErrorBox} error=${defects.error} />
      ${d
        ? html`<${DefectCard} d=${d} wagon=${{ id: r.wagon_id, number: r.number }} isNew=${isNewDefect(d, seenBefore, me)} />`
        : defects.loading ? html`<${Loading} />` : html`<${Empty}>Závada nebyla nalezena (možná byla smazána).<//>`}
      <a class="btn btn-ghost open-wagon" href="#/vuz/${r.wagon_id}">Otevřít vůz ${formatNumber(r.number)} <${Icon} name="right" size=${18} /></a>
    </div>`;
}
