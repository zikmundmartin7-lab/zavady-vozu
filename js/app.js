// Vstupní bod: přihlášení, směrování (#/...), živé aktualizace, upozornění, service worker.

import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import { api } from './api/index.js';
import { can, formatNumber } from './model.js';
import { AppCtx, Lightbox, Loading, ShareDialog, Toasts, clearLocalCache } from './ui.js';
import { AccountView, LoginView, PendingView, RecoveryView, UsersView } from './views/account.js';
import { DefectView } from './views/defect.js';
import { syncOutbox } from './outbox.js';
import { AuditView, ExportsView, TrashView } from './views/admin.js';
import { CodesView } from './views/codes.js';
import { OverviewView } from './views/overview.js';
import { DefectFormView } from './views/form.js';
import { RegulationsView } from './views/regulations.js';
import { GroupView, HomeView } from './views/groups.js';
import { WagonView } from './views/wagon.js';

// Poslední přihlášený uživatel (jen pro rychlé spuštění; oprávnění vždy hlídá databáze)
const ME_KEY = `zavady-me:${api.mode}`;
function readMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY)) ?? undefined; } catch { return undefined; }
}
function saveMe(p) {
  try {
    if (p) {
      localStorage.setItem(ME_KEY, JSON.stringify(p));
      localStorage.setItem('zavady-had-account', '1'); // příště rovnou přihlášení (account.js)
    }
    else { localStorage.removeItem(ME_KEY); clearLocalCache(); }
  } catch { /* nevadí */ }
}

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
    case 'vuz': return html`<${WagonView} id=${route.id} params=${route.params} />`;
    case 'zavada': return html`<${DefectView} id=${route.id} />`;
    case 'nova': return html`<${DefectFormView} params=${route.params} />`;
    case 'upravit': return html`<${DefectFormView} editId=${route.id} params=${route.params} />`;
    case 'kody': return html`<${CodesView} params=${route.params} />`;
    case 'prehled': return html`<${OverviewView} />`;
    case 'kos': return html`<${TrashView} />`;
    case 'historie': return html`<${AuditView} />`;
    case 'exporty': return html`<${ExportsView} />`;
    case 'predpisy': return html`<${RegulationsView} />`;
    case 'ucet': return html`<${AccountView} />`;
    case 'uzivatele': return html`<${UsersView} />`;
    default: return html`<${HomeView} />`;
  }
}

let toastSeq = 0;

function App() {
  const route = useRoute();
  // Poslední přihlášený uživatel z paměti telefonu → aplikace se ukáže hned, ověření proběhne na pozadí
  const [me, setMe] = useState(() => readMe()); // undefined = načítám, null = nepřihlášen
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [media, setMedia] = useState(null);
  const [sharing, setSharing] = useState(null); // { id, afterSave } – okno pro sdílení závady
  const [recovery, setRecovery] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [tabReset, setTabReset] = useState(0);
  const [pendingUsers, setPendingUsers] = useState(0);

  const reloadMe = () => api.getProfile().then(
    (p) => { setMe(p); saveMe(p); },
    // chyba sítě: nechat uživatele z paměti (data se načtou, až bude signál); bez něj zobrazit přihlášení.
    // Vypršelé přihlášení vrací null (větev výše), takže tady se nikdo neodhlásí jen kvůli výpadku.
    (e) => { console.warn(e); setMe((cur) => (cur === undefined ? null : cur)); },
  );
  const refresh = () => setVersion((v) => v + 1);
  const dismiss = (id) => setToasts((t) => t.filter((x) => x.id !== id));
  const toast = (message, opts = {}) => {
    const id = ++toastSeq;
    setToasts((t) => [...t.slice(-2), { id, message, ...opts }]);
    setTimeout(() => dismiss(id), opts.sticky ? 30000 : opts.kind === 'error' ? 7000 : opts.href ? 8000 : 3500);
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

  // Správce: počet uživatelů čekajících na schválení (tečka u ikony účtu)
  useEffect(() => {
    if (!can.admin(me)) { setPendingUsers(0); return; }
    api.listProfiles().then((p) => setPendingUsers(p.filter((u) => u.role === 'pending').length), () => {});
  }, [me?.id, me?.role, version]);

  // Zápis bez signálu: čekající závady odeslat po spuštění, po návratu signálu a pak každou minutu
  useEffect(() => {
    if (!can.use(me)) return undefined;
    const send = () => navigator.onLine && syncOutbox(api).then((n) => {
      if (n) { toast(`Odesláno ze zápisu bez signálu: ${n}.`); setVersion((v) => v + 1); }
    }, () => {});
    send();
    addEventListener('online', send);
    const timer = setInterval(send, 60000);
    return () => { removeEventListener('online', send); clearInterval(timer); };
  }, [me?.id, me?.role]);

  // Nová verze aplikace (service worker ji stáhl na pozadí) → nabídnout načtení
  useEffect(() => {
    const onUpdate = () => toast('Klepněte sem pro načtení nové verze.', {
      title: 'Je k dispozici nová verze aplikace', action: () => location.reload(), sticky: true,
    });
    addEventListener('app-updated', onUpdate);
    return () => removeEventListener('app-updated', onUpdate);
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
    share: (id, opts = {}) => setSharing({ id, ...opts }),
    resetTab: () => { setTabReset((n) => n + 1); scrollTo(0, 0); },
    pendingUsers,
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
      ${sharing && me && html`<${ShareDialog} key=${sharing.id} ...${sharing} onClose=${() => setSharing(null)} />`}
    <//>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  // updateViaCache: 'none' → novou verzi service workeru prohlížeč hledá vždy na serveru
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch((e) => console.warn('Service worker:', e));
  // Kliknutí na upozornění, když je aplikace otevřená → přejít na vůz
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && e.data.url) location.hash = e.data.url.replace(/^[^#]*/, '');
    if (e.data?.type === 'updated') dispatchEvent(new Event('app-updated'));
  });
}
