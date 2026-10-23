// Přehled závad napříč všemi vozy: filtry (stav, skupina, hledání, období, řazení) a export do Excelu.

import { html, useMemo, useState } from '../../vendor/preact-htm.js';
import { fold } from '../codes.js';
import { foundAtOf, formatDateTime, formatNumber, plural } from '../model.js';
import {
  BottomNav, Empty, ErrorBox, Icon, Loading, OutboxBanner, TopBar, UserButton, WagonNumber, useApp, useCatalog, useLoad,
} from '../ui.js';

const STATUS = { open: 'Neopravené', resolved: 'Opravené', all: 'Všechny' };
const PAGE = 150;

/** Export seznamu závad do Excelu (stejné sloupce jako pravidelný export ze serveru). */
export async function exportDefects(rows, catalog, label) {
  const { buildXlsx, download } = await import('../xlsx.js');
  const parts = new Map((catalog ?? []).map((c) => [c.kod, c.cesta]));
  const date = (iso) => (iso ? new Date(iso) : '');
  const blob = buildXlsx('Závady', [
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
  ], rows);
  const day = new Date().toISOString().slice(0, 10);
  download(blob, `zavady-${label}-${day}.xlsx`);
}

export function OverviewView() {
  const { api, toast } = useApp();
  const catalog = useCatalog();
  const [status, setStatus] = useState('open');
  const data = useLoad(() => api.listOverview(status), [status]);
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const [groupId, setGroupId] = useState(null);
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('new');
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const list = data.data ?? [];
    const tokens = fold(q).split(/\s+/).filter(Boolean);
    const fromT = from ? Date.parse(`${from}T00:00`) : null;
    const toT = to ? Date.parse(`${to}T23:59:59`) : null;
    const out = list.filter((r) => {
      if (groupId && r.group_id !== groupId) return false;
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
  }, [data.data, groupId, q, from, to, sort]);

  async function doExport() {
    setBusy(true);
    try {
      await exportDefects(rows, catalog, { open: 'neopravene', resolved: 'opravene', all: 'vsechny' }[status]);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const filtersActive = groupId || q || from || to;

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
        <button type="button" class="chip-btn ${!groupId ? 'active' : ''}" onClick=${() => setGroupId(null)}>Všechny skupiny</button>
        ${groups.data?.map((g) => html`
          <button type="button" key=${g.id} class="chip-btn ${groupId === g.id ? 'active' : ''}" onClick=${() => setGroupId(g.id)}>${g.name}</button>`)}
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
          ${filtersActive && html`<button type="button" class="btn" onClick=${() => { setGroupId(null); setQ(''); setFrom(''); setTo(''); }}>Zrušit filtry</button>`}
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
        ${rows.slice(0, limit).map((r) => html`
          <a key=${r.id} class="overview-row ${r.resolved_at ? 'resolved' : ''}" href="#/vuz/${r.wagon_id}">
            <div class="overview-head">
              <${WagonNumber} number=${r.number} />
              <span class="muted small">${r.group_name}</span>
              <span class="spacer"></span>
              ${r.defect_code && html`<span class="chip chip-code">kód ${r.defect_code}</span>`}
              ${r.resolved_at && html`<span class="chip chip-ok">Opraveno</span>`}
            </div>
            <div class="overview-text">${r.description}</div>
            <div class="muted small">
              zjištěno ${formatDateTime(foundAtOf(r))} · ${r.created_by_name || 'neznámý'}
              ${r.comment_count ? ` · ${plural(r.comment_count, 'komentář', 'komentáře', 'komentářů')}` : ''}
              ${r.attachment_count ? ` · ${r.attachment_count} 📎` : ''}
              ${r.resolved_at ? ` · opraveno ${formatDateTime(r.resolved_at)}` : ''}
            </div>
          </a>`)}
      </div>
      ${rows.length > limit && html`
        <button class="btn btn-ghost block toggle" onClick=${() => setLimit(limit + PAGE)}>Zobrazit další (${rows.length - limit})</button>`}
    </main>
    <${BottomNav} active="prehled" />`;
}
