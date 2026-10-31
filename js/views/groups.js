// Úvodní obrazovka (skupiny vozů + hledání) a obrazovka jedné skupiny.

import { html, useState } from '../../vendor/preact-htm.js';
import { formatDay, plural } from '../model.js';
import {
  Badge, BottomNav, CameraOffer, CommentsFab, Empty, ErrorBox, Fab, GroupName, Icon, InstallOffer, Loading, NewBadge, OpenCount, OutboxBanner, PushOffer, TopBar,
  UserButton, WagonNumber, WagonSearch, useApp, useLoad,
} from '../ui.js';

// Úvodní obrazovka je v obou videonávodech (video/navod-android.mp4, video/zadani-zavady-android.mp4) – vzhled, pořadí a texty neměnit bez souhlasu uživatele (README → návod, videonávody).
export function HomeView() {
  const { api } = useApp();
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const [q, setQ] = useState('');

  return html`
    <${TopBar} title="Závady vozů"><${UserButton} /><//>
    <main class="page with-nav">
      <${OutboxBanner} />
      <div class="offers">
        <${InstallOffer} />
        <${PushOffer} />
        <${CameraOffer} />
      </div>
      <${WagonSearch} onQuery=${setQ} />
      ${!q && html`
        <${ErrorBox} error=${groups.error} />
        ${!groups.data && groups.loading && html`<${Loading} />`}
        <nav class="groups">
          ${groups.data?.map((g) => html`
            <a key=${g.id} class="group-tile" href="#/skupina/${g.id}">
              <span class="group-name"><${GroupName} g=${g} /></span>
              <span class="group-sub">${g.open_count
                ? plural(g.open_count, 'otevřená závada', 'otevřené závady', 'otevřených závad')
                : 'bez otevřených závad'}</span>
              <span class="tile-badges"><${NewBadge} n=${g.new_count} /><${Badge} n=${g.open_count} /></span>
            </a>`)}
        </nav>`}
    </main>
    <${CommentsFab} />
    <${Fab} href="#/nova" />
    <${BottomNav} active="vozy" />`;
}

// Kdy byla zapsaná nejnovější závada vozu: dnes / včera / 28. 10. (rok jen u starších než letošních)
function lastDefectDay(iso) {
  const day = formatDay(iso);
  if (day === 'Dnes' || day === 'Včera') return day.toLowerCase();
  const d = new Date(iso);
  return d.getFullYear() === new Date().getFullYear() ? `${d.getDate()}. ${d.getMonth() + 1}.` : day;
}

// showLast: pod číslem vozu, kdy byla zapsaná jeho nejnovější závada (podle toho je seznam seřazený)
function WagonList({ wagons, showLast = false }) {
  return html`
    <ul class="list">
      ${wagons.map((w) => html`
        <li key=${w.id}>
          <a class="list-row" href="#/vuz/${w.id}">
            ${showLast && w.last_defect_at
              ? html`<span class="wagon-col"><${WagonNumber} number=${w.number} />
                  <span class="last-defect">Nejnovější závada ${lastDefectDay(w.last_defect_at)}</span></span>`
              : html`<${WagonNumber} number=${w.number} />`}
            <${OpenCount} w=${w} />
            <${Icon} name="right" size=${18} class="muted" />
          </a>
        </li>`)}
    </ul>`;
}

export function GroupView({ id }) {
  const { api } = useApp();
  const groups = useLoad(() => api.listGroups(), [], 'groups');
  const wagons = useLoad(() => api.listWagons(id), [id], `wagons:${id}`);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const g = groups.data?.find((x) => x.id === id);
  // Vozy s nejnovější závadou nahoře (čas zápisu poslední závady vozu); stejný čas – pořadí ze serveru
  const lastAt = (w) => (w.last_defect_at ? Date.parse(w.last_defect_at) : 0);
  const withDefects = wagons.data?.filter((w) => w.open_count > 0).sort((a, b) => lastAt(b) - lastAt(a)) ?? [];
  const others = wagons.data?.filter((w) => !w.open_count) ?? [];

  return html`
    <${TopBar} back="#/" title=${g?.name ?? 'Skupina'}
      sub=${g && html`${g.slang && html`<b>${g.slang}</b> · `}${g.open_count
        ? plural(g.open_count, 'otevřená závada', 'otevřené závady', 'otevřených závad') : 'bez otevřených závad'}`}>
      <${NewBadge} n=${g?.new_count} class="badge-inline" />
      <${Badge} n=${g?.open_count} class="badge-inline" />
    <//>
    <main class="page with-nav">
      <${WagonSearch} groupId=${id} onQuery=${setQ} />
      ${!q && html`
        <${ErrorBox} error=${wagons.error} />
        ${!wagons.data && wagons.loading && html`<${Loading} />`}
        ${wagons.data && html`
          <h2 class="section-title">Vozy s otevřenými závadami (${withDefects.length})</h2>
          ${withDefects.length
            ? html`<${WagonList} wagons=${withDefects} showLast />`
            : html`<${Empty}>V této skupině nejsou žádné otevřené závady.<//>`}
          ${others.length > 0 && html`
            <button class="btn btn-ghost block toggle" onClick=${() => setShowAll(!showAll)} aria-expanded=${showAll}>
              Ostatní vozy ve skupině (${others.length})
              <${Icon} name="down" class=${showAll ? 'flip' : ''} />
            </button>
            ${showAll && html`<${WagonList} wagons=${others} />`}`}`}`}
    </main>
    <${CommentsFab} />
    <${Fab} href="#/nova?skupina=${id}" />
    <${BottomNav} active="vozy" />`;
}
