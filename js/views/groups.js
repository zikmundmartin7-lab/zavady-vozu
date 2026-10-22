// Úvodní obrazovka (skupiny vozů + hledání) a obrazovka jedné skupiny.

import { html, useState } from '../../vendor/preact-htm.js';
import { plural } from '../model.js';
import {
  Badge, BottomNav, Empty, ErrorBox, Fab, Icon, Loading, OpenCount, TopBar, UserButton, WagonNumber, WagonSearch,
  useApp, useLoad,
} from '../ui.js';

export function HomeView() {
  const { api } = useApp();
  const groups = useLoad(() => api.listGroups(), []);
  const [q, setQ] = useState('');

  return html`
    <${TopBar} title="Závady vozů"><${UserButton} /><//>
    <main class="page with-nav">
      <${WagonSearch} onQuery=${setQ} />
      ${!q && html`
        <${ErrorBox} error=${groups.error} />
        ${!groups.data && groups.loading && html`<${Loading} />`}
        <nav class="groups">
          ${groups.data?.map((g) => html`
            <a key=${g.id} class="group-tile" href="#/skupina/${g.id}">
              <span class="group-name">${g.name}</span>
              <span class="group-sub">${g.open_count
                ? plural(g.open_count, 'otevřená závada', 'otevřené závady', 'otevřených závad')
                : 'bez otevřených závad'}</span>
              <${Badge} n=${g.open_count} />
            </a>`)}
        </nav>`}
    </main>
    <${Fab} href="#/nova" />
    <${BottomNav} active="vozy" />`;
}

function WagonList({ wagons }) {
  return html`
    <ul class="list">
      ${wagons.map((w) => html`
        <li key=${w.id}>
          <a class="list-row" href="#/vuz/${w.id}">
            <${WagonNumber} number=${w.number} />
            <${OpenCount} w=${w} />
            <${Icon} name="right" size=${18} class="muted" />
          </a>
        </li>`)}
    </ul>`;
}

export function GroupView({ id }) {
  const { api } = useApp();
  const groups = useLoad(() => api.listGroups(), []);
  const wagons = useLoad(() => api.listWagons(id), [id]);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const g = groups.data?.find((x) => x.id === id);
  const withDefects = wagons.data?.filter((w) => w.open_count > 0) ?? [];
  const others = wagons.data?.filter((w) => !w.open_count) ?? [];

  return html`
    <${TopBar} back="#/" title=${g?.name ?? 'Skupina'}
      sub=${g && (g.open_count ? plural(g.open_count, 'otevřená závada', 'otevřené závady', 'otevřených závad') : 'bez otevřených závad')}>
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
            ? html`<${WagonList} wagons=${withDefects} />`
            : html`<${Empty}>V této skupině nejsou žádné otevřené závady.<//>`}
          ${others.length > 0 && html`
            <button class="btn btn-ghost block toggle" onClick=${() => setShowAll(!showAll)} aria-expanded=${showAll}>
              Ostatní vozy ve skupině (${others.length})
              <${Icon} name="down" class=${showAll ? 'flip' : ''} />
            </button>
            ${showAll && html`<${WagonList} wagons=${others} />`}`}`}`}
    </main>
    <${Fab} href="#/nova?skupina=${id}" />
    <${BottomNav} active="vozy" />`;
}
