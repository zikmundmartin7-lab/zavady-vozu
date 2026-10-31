// Detail vozu: aktivní závady, skrytá historie oprav, správa vozu pro administrátora.
// Obrazovka vozu po uložení závady je ve videonávodu (video/zadani-zavady-android.mp4) – vzhled, pořadí a texty neměnit bez souhlasu uživatele (README → návod, videonávody).

import { html } from '../../vendor/preact-htm.js';
import { can, checkDigit, formatNumber, foundAtOf, groupLabel, isValidCheckDigit, plural } from '../model.js';
import {
  BottomNav, DefectCard, Empty, ErrorBox, Icon, Loading, TopBar, WagonNumber, backTarget, goBack, isNewDefect, useApp, useLoad,
  useScreenState, useWagonSeen,
} from '../ui.js';

export function WagonView({ id }) {
  const { api, me, refresh, toast } = useApp();
  const wagon = useLoad(() => api.getWagon(id), [id], `wagon:${id}`);
  const defects = useLoad(() => api.listDefects(id), [id], `defects:${id}`);
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const [showHistory, setShowHistory] = useScreenState('history', false);
  const w = wagon.data;

  // Otevřením vozu jsou jeho závady prohlédnuté, štítek „Nová“ mají ty vložené od minulé návštěvy
  const seenBefore = useWagonSeen(id);
  const isNew = (d) => isNewDefect(d, seenBefore, me);

  if (wagon.error) return html`<${TopBar} back="#/" title="Vůz" /><main class="page"><${ErrorBox} error=${wagon.error} /></main>`;
  if (!w) {
    return html`
      <${TopBar} back="#/" title="Vůz" />
      <main class="page">${wagon.loading ? html`<${Loading} />` : html`<${Empty}>Vůz nebyl nalezen (možná byl smazán).<//>`}</main>`;
  }

  const all = defects.data ?? [];
  const open = all.filter((d) => !d.resolved_at)
    .sort((a, b) => Date.parse(foundAtOf(b)) - Date.parse(foundAtOf(a)));
  const resolved = all.filter((d) => d.resolved_at).sort((a, b) => b.resolved_at.localeCompare(a.resolved_at));

  async function changeGroup(e) {
    try {
      await api.updateWagon(w.id, { group_id: Number(e.currentTarget.value) });
      toast('Skupina vozu změněna.');
      refresh();
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  async function removeWagon() {
    if (!confirm(`Smazat vůz ${formatNumber(w.number)} včetně všech závad, fotek a komentářů?`)) return;
    try {
      await api.deleteWagon(w.id);
      toast('Vůz smazán.');
      goBack(`#/skupina/${w.group_id}`);
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  return html`
    <${TopBar} back=${backTarget(`#/skupina/${w.group_id}`)} title=${formatNumber(w.number)} sub=${w.group_name} />
    <main class="page with-nav">
      <section class="card wagon-card">
        <${WagonNumber} number=${w.number} class="big" />
        <div class="wagon-meta">
          ${can.admin(me) && groups.data
            ? html`<label class="inline-select">Skupina:
                <select value=${w.group_id} onChange=${changeGroup}>
                  ${groups.data.map((g) => html`<option value=${g.id}>${groupLabel(g)}</option>`)}
                </select></label>`
            : html`<span class="muted">Skupina: <b>${w.group_name}</b></span>`}
        </div>
        ${!isValidCheckDigit(w.number) && html`
          <div class="warn"><${Icon} name="alert" size=${16} /> Kontrolní číslice nesedí (vychází ${checkDigit(w.number)}). Zkontrolujte číslo vozu.</div>`}
        <a class="btn btn-primary block" href="#/nova?vuz=${w.id}"><${Icon} name="plus" /> Přidat závadu</a>
      </section>

      <${ErrorBox} error=${defects.error} />
      ${!defects.data && defects.loading && html`<${Loading} />`}
      ${defects.data && html`
        <h2 class="section-title">Aktivní závady (${open.length})</h2>
        ${open.length
          ? open.map((d) => html`<${DefectCard} key=${d.id} d=${d} wagon=${w} isNew=${isNew(d)} />`)
          : html`<${Empty}><${Icon} name="check" /> Na voze nejsou žádné aktivní závady.<//>`}

        <button class="btn btn-ghost block toggle" onClick=${() => setShowHistory(!showHistory)}
          aria-expanded=${showHistory} disabled=${!resolved.length}>
          <${Icon} name="history" /> Historie oprav (${resolved.length})
          ${resolved.length > 0 && html`<${Icon} name="down" class=${showHistory ? 'flip' : ''} />`}
        </button>
        ${showHistory && resolved.map((d) => html`<${DefectCard} key=${d.id} d=${d} wagon=${w} />`)}`}

      ${can.admin(me) && html`
        <div class="danger-zone">
          <button class="btn btn-ghost danger" onClick=${removeWagon}><${Icon} name="trash" size=${18} /> Smazat vůz</button>
          <span class="muted small">${plural(all.length, 'závada', 'závady', 'závad')} celkem</span>
        </div>`}
    </main>
    <${BottomNav} active="vozy" />`;
}
