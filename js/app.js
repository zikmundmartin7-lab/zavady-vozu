// Vstupní bod: přihlášení, směrování (#/...), živé aktualizace, upozornění, service worker.

import { html, render, useCallback, useEffect, useState } from '../vendor/preact-htm.js';
import { api } from './api/index.js';
import { can, formatNumber } from './model.js';
import {
  AppCtx, Lightbox, Loading, PullToRefresh, ShareDialog, Toasts, clearLocalCache, isPushOff, readCached, reloadApp,
  writeCached,
} from './ui.js';
import { lastPrefetchAt, prefetchAll } from './offline.js';
import { AccountView, LoginView, PendingView, RecoveryView, UsersView } from './views/account.js';
import { CommentInboxView, DefectView } from './views/defect.js';
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
    case 'vuz': return html`<${WagonView} id=${route.id} />`;
    case 'zavada': return html`<${DefectView} id=${route.id} />`;
    case 'komentare': return html`<${CommentInboxView} />`;
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

// Nové závady od ostatních ve všech skupinách (součet group_overview.new_count)
const countNew = (groups) => (groups ?? []).reduce((n, g) => n + (g.new_count ?? 0), 0);

// Klávesnice nesmí vyskočit sama. iPhone při spuštění nebo návratu do aplikace někdy sám vrátí kurzor
// do posledního políčka (hledání vozu). Krátce po spuštění a po návratu se proto políčko, do kterého
// uživatel neklepl, hned opustí; při odchodu z aplikace se kurzor z políčka zruší.
const GUARD_MS = 2000;
function useNoAutoKeyboard() {
  useEffect(() => {
    let guardUntil = Date.now() + GUARD_MS;
    let lastUserAt = 0;
    const isField = (el) => !!el?.matches?.('input, textarea, select, [contenteditable="true"]');
    const unwanted = () => Date.now() < guardUntil && Date.now() - lastUserAt > 1000;
    const onUser = () => { lastUserAt = Date.now(); };
    const onFocusIn = (e) => { if (unwanted() && isField(e.target)) e.target.blur(); };
    const onShow = () => {
      guardUntil = Date.now() + GUARD_MS;
      lastUserAt = 0; // klepnutí z doby před odchodem z aplikace se nepočítají
      if (unwanted() && isField(document.activeElement)) document.activeElement.blur();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') onShow();
      else if (isField(document.activeElement)) document.activeElement.blur();
    };
    const userEvents = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    userEvents.forEach((t) => addEventListener(t, onUser, { capture: true, passive: true }));
    addEventListener('focusin', onFocusIn, true);
    addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      userEvents.forEach((t) => removeEventListener(t, onUser, { capture: true }));
      removeEventListener('focusin', onFocusIn, true);
      removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}

function App() {
  const route = useRoute();
  useNoAutoKeyboard();
  // Poslední přihlášený uživatel z paměti telefonu → aplikace se ukáže hned, ověření proběhne na pozadí
  const [me, setMe] = useState(() => readMe()); // undefined = načítám, null = nepřihlášen
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [media, setMedia] = useState(null);
  const [sharing, setSharing] = useState(null); // { id, afterSave } – okno pro sdílení závady
  const [recovery, setRecovery] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null); // výzva Chromu k instalaci na plochu (jde použít jen jednou)
  const [installed, setInstalled] = useState(false);
  const [tabReset, setTabReset] = useState(0);
  const [pendingUsers, setPendingUsers] = useState(0);
  const [newDefects, setNewDefects] = useState(() => countNew(readCached(api.mode, 'groups')));
  const [seenWagons, setSeenWagons] = useState(() => new Map()); // vůz → kdy ho uživatel otevřel (v této relaci)
  // Nové komentáře u mých závad a závad, které jsem komentoval (odznak s číslem nahoře, seznam #/komentare)
  const [commentInbox, setCommentInbox] = useState(() => readCached(api.mode, 'comment-inbox') ?? []);
  const [inboxTick, setInboxTick] = useState(0);

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
    setTimeout(() => dismiss(id), opts.duration ?? (opts.sticky ? 30000 : opts.kind === 'error' ? 7000 : opts.href ? 8000 : 3500));
  };

  useEffect(() => {
    reloadMe();
    const off = api.onAuthChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      reloadMe();
    });
    const onInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    const onInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
      toast('Aplikaci najdete na ploše jako ikonu Závady vozů – od teď ji otevírejte z ní.', { title: 'Aplikace je na ploše', duration: 10000 });
    };
    addEventListener('beforeinstallprompt', onInstall);
    addEventListener('appinstalled', onInstalled);
    return () => {
      off();
      removeEventListener('beforeinstallprompt', onInstall);
      removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Správce: počet uživatelů čekajících na schválení (tečka u ikony účtu)
  useEffect(() => {
    if (!can.admin(me)) { setPendingUsers(0); return; }
    api.listProfiles().then((p) => setPendingUsers(p.filter((u) => u.role === 'pending').length), () => {});
  }, [me?.id, me?.role, version]);

  // Počet nových závad pro červený odznak u záložky Přehled; přepočítá se i po otevření vozu
  // (otevřením jsou jeho závady přečtené)
  useEffect(() => {
    if (!can.use(me)) { setNewDefects(0); return; }
    api.listGroups().then((g) => { writeCached(api.mode, 'groups', g); setNewDefects(countNew(g)); }, () => {});
  }, [me?.id, me?.role, version, seenWagons]);

  // Nové komentáře: při spuštění, při živé změně (nový komentář) a po přečtení. Bez úpravy databáze
  // (migrace 07) se jen nic neukáže.
  useEffect(() => {
    if (!can.use(me)) { setCommentInbox([]); return; }
    api.listCommentInbox().then((rows) => { writeCached(api.mode, 'comment-inbox', rows); setCommentInbox(rows); }, () => {});
  }, [me?.id, me?.role, version, inboxTick]);

  // Upozornění: když je telefon už dřív povolil (nové přihlášení, přeinstalace), obnovit je bez ptaní.
  // Ručně vypnutá (Můj účet) ne.
  useEffect(() => {
    if (!can.use(me) || !navigator.onLine || isPushOff(me.id)) return;
    api.push.resume().catch(() => {});
  }, [me?.id, me?.role]);

  // Účet se základním heslem: jednou na zařízení nabídnout (nepovinnou) změnu hesla
  useEffect(() => {
    if (!me?.temp_password || !can.use(me)) return;
    const key = `zavady-temp-pw-tip:${me.id}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch { return; }
    toast('Přihlašujete se základním heslem. Pokud chcete, změňte si ho v Můj účet.', { title: 'Heslo', href: '#/ucet' });
  }, [me?.id, me?.temp_password]);

  // Zápis bez signálu: čekající závady odeslat po spuštění, po návratu signálu, po návratu do aplikace
  // a pak každou minutu. Stahování na pozadí: po spuštění, po návratu signálu a po návratu do aplikace
  // (nejvýš jednou za 15 minut), ať je v telefonu vše potřebné i pro chvíle bez signálu.
  const sendOutbox = () => syncOutbox(api).then((n) => {
    if (n) { toast(`Odesláno ze zápisu bez signálu: ${n}.`); setVersion((v) => v + 1); }
  }, () => {});
  const prefetch = () => prefetchAll(api).catch(() => {});
  useEffect(() => {
    if (!can.use(me)) return undefined;
    const send = () => navigator.onLine && sendOutbox();
    const fetchAllData = () => navigator.onLine && prefetch();
    const onOnline = () => { send(); fetchAllData(); };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      send();
      if (Date.now() - lastPrefetchAt() > 15 * 60000) fetchAllData();
    };
    send();
    const first = setTimeout(fetchAllData, 4000); // až po načtení první obrazovky
    addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(send, 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [me?.id, me?.role]);

  // Stažení dolů (na začátku stránky): odeslat čekající závady, stáhnout vše znovu, zkontrolovat novou verzi
  const pullRefresh = useCallback(async () => {
    navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    if (can.use(me) && navigator.onLine) await Promise.all([sendOutbox(), prefetch()]);
    setVersion((v) => v + 1);
  }, [me?.id, me?.role]);

  // Nová verze: při návratu do aplikace (nejvýš jednou za 10 minut) se zeptat webu. Když je novější,
  // service worker ji stáhne na pozadí a ozve se níže (app-updated) – nemusí se čekat na nové spuštění.
  useEffect(() => {
    let lastCheck = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 10 * 60000) return;
      lastCheck = Date.now();
      navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Nová verze aplikace (service worker ji stáhl na pozadí) → nabídnout načtení
  useEffect(() => {
    const onUpdate = () => toast('Klepněte sem pro načtení nové verze.', {
      title: 'Je k dispozici nová verze aplikace', action: reloadApp, sticky: true,
    });
    addEventListener('app-updated', onUpdate);
    return () => removeEventListener('app-updated', onUpdate);
  }, []);

  // Živé změny z databáze → překreslit; nová závada od někoho jiného → upozornění v aplikaci.
  // Nový komentář → upozornění autorovi závady a těm, kdo ji už komentovali (ne na otevřené závadě).
  useEffect(() => {
    if (!can.use(me)) return undefined;
    // V demu neexistuje server, který by posílal push – upozornění ukáže přímo prohlížeč.
    const demoNotify = async (title, body, url, tag) => {
      if (api.mode !== 'demo' || !document.hidden || window.Notification?.permission !== 'granted') return;
      const reg = await navigator.serviceWorker?.getRegistration();
      reg?.showNotification(title, { body, icon: 'icons/icon-192.png?v=2', badge: 'icons/badge-96.png?v=2', data: { url }, tag });
    };
    return api.subscribeChanges(async ({ newDefect, newComment }) => {
      refresh();
      if (newDefect) {
        const w = await api.getWagon(newDefect.wagon_id).catch(() => null);
        const title = `Nová závada${w ? ` · ${formatNumber(w.number)}` : ''}`;
        toast(newDefect.description, { title, href: `#/vuz/${newDefect.wagon_id}` });
        demoNotify(title, newDefect.description, `#/vuz/${newDefect.wagon_id}`, newDefect.id);
      }
      if (newComment && location.hash !== `#/zavada/${newComment.defect_id}`) {
        const [d, comments] = await Promise.all([
          api.getDefect(newComment.defect_id).catch(() => null), api.listComments(newComment.defect_id).catch(() => []),
        ]);
        const mine = d?.created_by === me.id || comments.some((c) => c.author_id === me.id && c.id !== newComment.id);
        if (!mine) return;
        const w = await api.getWagon(d.wagon_id).catch(() => null);
        const author = comments.find((c) => c.id === newComment.id)?.author_name || 'Někdo';
        const title = `Nový komentář${w ? ` · ${formatNumber(w.number)}` : ''}`;
        const url = `#/zavada/${newComment.defect_id}`;
        toast(`${author}: ${newComment.body}`, { title, href: url });
        demoNotify(title, `${author}: ${newComment.body}`, url, `comment-${newComment.id}`);
      }
    });
  }, [me?.id, me?.role]);

  const ctx = {
    api, me, version, refresh, toast, reloadMe, installPrompt, installed,
    // Instalace na plochu: systémové okno Chromu, uživatel jen potvrdí
    install: async () => {
      if (!installPrompt) return 'unavailable';
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      setInstallPrompt(null);
      return outcome;
    },
    openMedia: (items, index) => setMedia({ items, index }),
    share: (id, opts = {}) => setSharing({ id, ...opts }),
    resetTab: () => { setTabReset((n) => n + 1); scrollTo(0, 0); },
    pendingUsers, newDefects, seenWagons, commentInbox,
    // Komentáře závady jsou přečtené (otevřená závada) – hned zmizí z odznaku, databáze se dozví na pozadí
    commentsSeen: (defectId) => {
      setCommentInbox((rows) => rows.filter((r) => r.defect_id !== defectId));
      return api.markCommentsSeen(defectId).catch(() => {}).finally(() => setInboxTick((n) => n + 1));
    },
    wagonSeen: (id) => setSeenWagons((m) => new Map(m).set(id, Date.now())),
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
      ${me && html`<${PullToRefresh} onRefresh=${pullRefresh} />`}
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
