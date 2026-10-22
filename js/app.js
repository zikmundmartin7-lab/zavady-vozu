// Vstupní bod: přihlášení, směrování (#/...), živé aktualizace, upozornění, service worker.

import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import { api } from './api/index.js';
import { can, formatNumber } from './model.js';
import { AppCtx, Lightbox, Loading, Toasts } from './ui.js';
import { AccountView, LoginView, PendingView, RecoveryView, UsersView } from './views/account.js';
import { DefectView } from './views/defect.js';
import { CodesView } from './views/codes.js';
import { DefectFormView } from './views/form.js';
import { RegulationsView } from './views/regulations.js';
import { GroupView, HomeView } from './views/groups.js';
import { WagonView } from './views/wagon.js';

function parseRoute(hash) {
  const [path, query] = hash.replace(/^#/, '').split('?');
  const [name = '', id] = path.split('/').filter(Boolean);
  return { name, id, params: new URLSearchParams(query ?? ''), key: hash };
}

function useRoute() {
  const [route, setRoute] = useState(parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => { setRoute(parseRoute(location.hash)); scrollTo(0, 0); };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Page({ route }) {
  switch (route.name) {
    case 'skupina': return html`<${GroupView} id=${Number(route.id)} />`;
    case 'vuz': return html`<${WagonView} id=${route.id} />`;
    case 'zavada': return html`<${DefectView} id=${route.id} />`;
    case 'nova': return html`<${DefectFormView} params=${route.params} />`;
    case 'upravit': return html`<${DefectFormView} editId=${route.id} params=${route.params} />`;
    case 'kody': return html`<${CodesView} params=${route.params} />`;
    case 'predpisy': return html`<${RegulationsView} />`;
    case 'ucet': return html`<${AccountView} />`;
    case 'uzivatele': return html`<${UsersView} />`;
    default: return html`<${HomeView} />`;
  }
}

let toastSeq = 0;

function App() {
  const route = useRoute();
  const [me, setMe] = useState(undefined); // undefined = načítám, null = nepřihlášen
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [media, setMedia] = useState(null);
  const [recovery, setRecovery] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [tabReset, setTabReset] = useState(0);

  const reloadMe = () => api.getProfile().then(setMe, () => setMe(null));
  const refresh = () => setVersion((v) => v + 1);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = (message, opts = {}) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, message, ...opts }]);
    setTimeout(() => dismiss(id), opts.kind === 'error' ? 7000 : opts.href ? 8000 : 3500);
  };

  useEffect(() => {
    reloadMe();
    const off = api.onAuthChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      reloadMe();
    });
    const onInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    addEventListener('beforeinstallprompt', onInstall);
    return () => { off(); removeEventListener('beforeinstallprompt', onInstall); };
  }, []);

  // Živé změny z databáze → překreslit; nová závada od někoho jiného → upozornění v aplikaci.
  useEffect(() => {
    if (!can.use(me)) return undefined;
    return api.subscribeChanges(async ({ newDefect }) => {
      refresh();
      if (!newDefect) return;
      const w = await api.getWagon(newDefect.wagon_id).catch(() => null);
      const title = `Nová závada${w ? ` · ${formatNumber(w.number)}` : ''}`;
      toast(newDefect.description, { title, href: `#/vuz/${newDefect.wagon_id}` });
      // V demu neexistuje server, který by posílal push – upozornění ukáže přímo prohlížeč.
      if (api.mode === 'demo' && document.hidden && window.Notification?.permission === 'granted') {
        const reg = await navigator.serviceWorker?.getRegistration();
        reg?.showNotification(title, {
          body: newDefect.description, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png',
          data: { url: `#/vuz/${newDefect.wagon_id}` }, tag: newDefect.id,
        });
      }
    });
  }, [me?.id, me?.role]);

  const ctx = {
    api, me, version, refresh, toast, reloadMe, installPrompt,
    openMedia: (items, index) => setMedia({ items, index }),
    resetTab: () => { setTabReset((n) => n + 1); scrollTo(0, 0); },
  };

  let content;
  if (me === undefined) content = html`<main class="page"><${Loading} /></main>`;
  else if (recovery && me) content = html`<${RecoveryView} onDone=${() => setRecovery(false)} />`;
  else if (!me) content = html`<${LoginView} />`;
  else if (!can.use(me)) content = html`<${PendingView} />`;
  else content = html`<${Page} key=${`${route.key}|${tabReset}`} route=${route} />`;

  return html`
    <${AppCtx.Provider} value=${ctx}>
      ${api.mode === 'demo' && html`<div class="demo-banner">Ukázkový režim – data jsou jen v tomto prohlížeči</div>`}
      ${content}
      <${Toasts} items=${toasts} dismiss=${dismiss} />
      ${media && html`<${Lightbox} ...${media} onClose=${() => setMedia(null)} />`}
    <//>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker:', e));
  // Kliknutí na upozornění, když je aplikace otevřená → přejít na vůz
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && e.data.url) location.hash = e.data.url.replace(/^[^#]*/, '');
  });
}
