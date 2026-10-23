// Obrazovky pro správce: koš (obnovení smazaného), historie všech změn, pravidelné exporty na e-mail.

import { html, useState } from '../../vendor/preact-htm.js';
import { actorName, describe, groupTrash } from '../history.js';
import { can, formatDateTime } from '../model.js';
import { Empty, ErrorBox, Icon, Loading, TopBar, useApp, useLoad } from '../ui.js';

const AdminOnly = ({ title }) => html`
  <${TopBar} back="#/ucet" title=${title} /><main class="page"><${Empty}>Jen pro správce.<//></main>`;

// ───── Koš ─────

export function TrashView() {
  const { api, me, toast, refresh } = useApp();
  const data = useLoad(async () => {
    const [entries, numbers] = await Promise.all([api.listTrash(), api.listWagonNumbers()]);
    return groupTrash(entries, numbers);
  }, []);
  const [busy, setBusy] = useState(null);
  if (!can.admin(me)) return html`<${AdminOnly} title="Koš" />`;

  async function restore(g) {
    if (!confirm(`Obnovit: ${g.title}?`)) return;
    setBusy(g.tx);
    try {
      const n = await api.restoreDeleted(g.tx);
      toast(`Obnoveno (${n} ${n === 1 ? 'záznam' : n < 5 ? 'záznamy' : 'záznamů'}).`);
      refresh();
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return html`
    <${TopBar} back="#/ucet" title="Koš" sub="Smazané záznamy zůstávají navždy" />
    <main class="page narrow">
      <p class="muted">Vše smazané (vozy, závady, fotky, komentáře, předpisy) se dá obnovit. Obnoví se vždy celá akce –
        např. smazaný vůz i se všemi jeho závadami.</p>
      <${ErrorBox} error=${data.error} />
      ${!data.data && data.loading && html`<${Loading} />`}
      ${data.data?.length === 0 && html`<${Empty}>Koš je prázdný.<//>`}
      <ul class="list">
        ${data.data?.map((g) => html`
          <li key=${g.tx} class="list-row trash-row">
            <div class="trash-info">
              <b>${g.title}</b>
              ${g.lines.map((l) => html`<span class="small">${l}</span>`)}
              <span class="muted small">Smazal(a) ${g.actor} · ${formatDateTime(g.at)}</span>
            </div>
            <button class="btn" disabled=${busy === g.tx} onClick=${() => restore(g)}><${Icon} name="undo" size=${18} /> Obnovit</button>
          </li>`)}
      </ul>
    </main>`;
}

// ───── Historie všech změn ─────

export function AuditView() {
  const { api, me } = useApp();
  const [limit, setLimit] = useState(200);
  const data = useLoad(async () => {
    const [entries, groups] = await Promise.all([api.listAudit(limit), api.listGroups()]);
    return { entries, groups: new Map(groups.map((g) => [g.id, g.name])) };
  }, [limit]);
  const [q, setQ] = useState('');
  if (!can.admin(me)) return html`<${AdminOnly} title="Historie změn" />`;

  const rows = (data.data?.entries ?? []).map((e) => ({ e, d: describe(e, data.data.groups), who: actorName(e) }));
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? rows.filter((r) => `${r.who} ${r.d.title} ${r.d.lines.join(' ')}`.toLowerCase().includes(needle))
    : rows;

  return html`
    <${TopBar} back="#/ucet" title="Historie změn" sub="Kdo, kdy a co změnil" />
    <main class="page narrow">
      <label class="search-box">
        <${Icon} name="search" />
        <input type="search" placeholder="Hledat jméno, vůz, text…" value=${q} onInput=${(e) => setQ(e.currentTarget.value)} />
      </label>
      <${ErrorBox} error=${data.error} />
      ${!data.data && data.loading && html`<${Loading} />`}
      ${data.data && rows.length === 0 && html`<${Empty}>Zatím žádné změny.<//>`}
      ${rows.length > 0 && shown.length === 0 && html`<${Empty}>Nic nenalezeno.<//>`}
      <ul class="history-list">
        ${shown.map(({ e, d, who }) => html`
          <li key=${e.id} class="history-item">
            <div class="history-head">
              <span class="muted small">${formatDateTime(e.at)}</span>
              ${e.wagon_id && e.action !== 'delete' && html`<a class="small" href="#/vuz/${e.wagon_id}">vůz →</a>`}
            </div>
            <div><b>${who}</b> ${d.title}${e.restored_at ? ' (obnoveno)' : ''}</div>
            ${d.lines.map((l) => html`<div class="small history-line">${l}</div>`)}
          </li>`)}
      </ul>
      ${data.data && data.data.entries.length >= limit && html`
        <button class="btn btn-ghost block toggle" onClick=${() => setLimit(limit + 300)}>Načíst starší</button>`}
    </main>`;
}

// ───── Pravidelné exporty na e-mail ─────

const WEEKDAYS = ['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'];
const REPORTS = { open: 'Neopravené závady', all: 'Všechny závady' };

function describeSchedule(s, groups) {
  const when = s.frequency === 'daily' ? 'každý den'
    : s.frequency === 'weekly' ? `každý týden v ${WEEKDAYS[(s.weekday ?? 1) - 1]}`
      : `každý měsíc ${s.monthday ?? 1}. den`;
  const which = s.group_ids?.length
    ? s.group_ids.map((id) => groups?.find((g) => g.id === id)?.name ?? `skupina ${id}`).join(', ')
    : 'všechny skupiny';
  return `${REPORTS[s.report]} (${which}) · ${when} v ${s.hour}:00`;
}

function ScheduleForm({ initial, groups, onDone }) {
  const { api, toast } = useApp();
  const [f, setF] = useState(initial ?? { recipient: '', report: 'open', frequency: 'weekly', weekday: 1, monthday: 1, hour: 7, group_ids: null });
  const allGroups = !f.group_ids;
  const toggleGroup = (id) => {
    const ids = f.group_ids ?? [];
    setF({ ...f, group_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] });
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.currentTarget.type === 'number' || /day|hour/.test(k) ? Number(e.currentTarget.value) : e.currentTarget.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.recipient.trim())) throw new Error('Zadejte platný e-mail.');
      if (f.group_ids && !f.group_ids.length) throw new Error('Vyberte aspoň jednu skupinu vozů.');
      await api.saveExportSchedule({
        id: f.id, recipient: f.recipient.trim(), report: f.report, frequency: f.frequency, hour: f.hour,
        group_ids: f.group_ids?.length ? [...f.group_ids].sort((a, b) => a - b) : null,
        weekday: f.frequency === 'weekly' ? f.weekday : null, monthday: f.frequency === 'monthly' ? f.monthday : null,
        active: f.active ?? true,
      });
      toast('Pravidelný export uložen.');
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card form" onSubmit=${submit}>
      <h2>${f.id ? 'Upravit export' : 'Nový pravidelný export'}</h2>
      <label class="field">Komu poslat (e-mail)
        <input type="email" required value=${f.recipient} onInput=${set('recipient')} placeholder="např. vedouci@firma.cz" /></label>
      <label class="field">Co poslat
        <select value=${f.report} onChange=${set('report')}>
          ${Object.entries(REPORTS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select></label>
      <fieldset class="field">
        <legend>Skupiny vozů</legend>
        <label class="check-row">
          <input type="checkbox" checked=${allGroups} onChange=${(e) => setF({ ...f, group_ids: e.currentTarget.checked ? null : [] })} />
          Všechny skupiny
        </label>
        ${!allGroups && groups?.map((g) => html`
          <label key=${g.id} class="check-row">
            <input type="checkbox" checked=${f.group_ids.includes(g.id)} onChange=${() => toggleGroup(g.id)} /> ${g.name}
          </label>`)}
        <span class="muted small">V Excelu bude list se všemi závadami a k tomu list pro každou skupinu.</span>
      </fieldset>
      <label class="field">Jak často
        <select value=${f.frequency} onChange=${set('frequency')}>
          <option value="daily">Každý den</option>
          <option value="weekly">Každý týden</option>
          <option value="monthly">Každý měsíc</option>
        </select></label>
      ${f.frequency === 'weekly' && html`
        <label class="field">Den v týdnu
          <select value=${f.weekday} onChange=${set('weekday')}>
            ${WEEKDAYS.map((d, i) => html`<option value=${i + 1}>${d}</option>`)}
          </select></label>`}
      ${f.frequency === 'monthly' && html`
        <label class="field">Den v měsíci
          <select value=${f.monthday} onChange=${set('monthday')}>
            ${Array.from({ length: 28 }, (_, i) => html`<option value=${i + 1}>${i + 1}.</option>`)}
          </select></label>`}
      <label class="field">V kolik hodin
        <select value=${f.hour} onChange=${set('hour')}>
          ${Array.from({ length: 24 }, (_, i) => html`<option value=${i}>${i}:00</option>`)}
        </select></label>
      <${ErrorBox} error=${error} />
      <div class="row">
        <button class="btn btn-primary" disabled=${busy}>Uložit</button>
        <button type="button" class="btn" onClick=${onDone}>Zrušit</button>
      </div>
    </form>`;
}

export function ExportsView() {
  const { api, me, toast, refresh } = useApp();
  const list = useLoad(() => (can.admin(me) ? api.listExportSchedules() : Promise.resolve([])), []);
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const [editing, setEditing] = useState(null); // null = nic, {} = nový, objekt = úprava
  if (!can.admin(me)) return html`<${AdminOnly} title="Pravidelné exporty" />`;

  const done = () => { setEditing(null); refresh(); };
  async function toggle(s) {
    try { await api.saveExportSchedule({ id: s.id, active: !s.active }); refresh(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
  async function remove(s) {
    if (!confirm(`Zrušit export pro ${s.recipient}?`)) return;
    try { await api.deleteExportSchedule(s.id); refresh(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  return html`
    <${TopBar} back="#/ucet" title="Pravidelné exporty" sub="Excel se závadami na e-mail" />
    <main class="page narrow">
      <p class="muted">Server pošle na zadaný e-mail soubor Excel se závadami v nastavený den a hodinu (čas v Česku).
        ${api.mode === 'demo' ? ' V ukázkovém režimu se exporty jen ukládají, nerozesílají.' : ''}</p>
      <${ErrorBox} error=${list.error} />
      ${list.data?.length === 0 && !editing && html`<${Empty}>Zatím žádný pravidelný export.<//>`}
      <ul class="list">
        ${list.data?.map((s) => html`
          <li key=${s.id} class="list-row schedule-row ${s.active ? '' : 'inactive'}">
            <div class="trash-info">
              <b>${s.recipient}</b>
              <span class="small">${describeSchedule(s, groups.data)}</span>
              <span class="muted small">${s.last_sent_at ? `naposledy odesláno ${formatDateTime(s.last_sent_at)}` : 'zatím neodesláno'}${s.active ? '' : ' · pozastaveno'}</span>
              ${s.last_error && html`<span class="small error-text">Chyba: ${s.last_error}</span>`}
            </div>
            <div class="row">
              <button class="btn btn-ghost" title="Upravit" onClick=${() => setEditing(s)}><${Icon} name="edit" size=${18} /></button>
              <button class="btn btn-ghost" title=${s.active ? 'Pozastavit' : 'Zapnout'} onClick=${() => toggle(s)}>${s.active ? 'Pozastavit' : 'Zapnout'}</button>
              <button class="btn btn-ghost danger" title="Zrušit" onClick=${() => remove(s)}><${Icon} name="trash" size=${18} /></button>
            </div>
          </li>`)}
      </ul>
      ${editing
        ? html`<${ScheduleForm} key=${editing.id ?? 'new'} initial=${editing.id ? editing : null} groups=${groups.data} onDone=${done} />`
        : html`<button class="btn btn-primary block" onClick=${() => setEditing({})}><${Icon} name="plus" /> Přidat pravidelný export</button>`}
    </main>`;
}
