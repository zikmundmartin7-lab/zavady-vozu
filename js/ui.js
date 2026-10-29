// Sdílené komponenty a pomocné funkce pro obrazovky.

import { html, createContext, useContext, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { can, compressImage, digitsOnly, foundAtOf, formatDateTime, formatNumber, plural, splitNumber } from './model.js';
import { matchRanges } from './codes.js';
import { outbox, syncOutbox } from './outbox.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// ───── Navigace a tlačítko Zpět ─────
// Každý záznam v historii prohlížeče dostane pořadí (history.state.navIdx) a aplikace si pamatuje, která
// obrazovka byla před ním. Šipka Zpět v aplikaci pak opravdu vrací (history.back), když míří na předchozí
// obrazovku – jinak ji jen nahradí. Dřív šipka přidávala do historie nové kroky a gesto Zpět v Androidu
// se pak vracelo do míst, odkud člověk odešel; z úvodní obrazovky se tak gestem nedalo odejít.
const NAV_KEY = 'zavady-nav';
let navStack = [];
try { navStack = JSON.parse(sessionStorage.getItem(NAV_KEY)) ?? []; } catch { /* nevadí */ }
let navIdx = history.state?.navIdx ?? -1;
function trackNav() {
  let idx = history.state?.navIdx;
  if (idx === undefined) { // nový záznam (odkaz, go)
    idx = navIdx + 1;
    navStack = navStack.slice(0, idx);
    history.replaceState({ ...history.state, navIdx: idx }, '');
  }
  navStack[idx] = location.hash || '#/';
  navIdx = idx;
  try { sessionStorage.setItem(NAV_KEY, JSON.stringify(navStack)); } catch { /* nevadí */ }
}
trackNav();
addEventListener('hashchange', trackNav);

export const go = (hash) => { location.hash = hash; };
// Nahradit obrazovku bez nového záznamu v historii (pořadí záznamu zůstane, viz trackNav)
export function replace(hash) {
  const oldURL = location.href;
  history.replaceState(history.state, '', hash);
  dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: location.href }));
}

/** Zpět na obrazovku hash: krokem zpět v historii, je-li to předchozí obrazovka, jinak jejím nahrazením. */
export function goBack(hash) {
  if (navIdx > 0 && navStack[navIdx - 1] === hash) {
    return new Promise((resolve) => {
      addEventListener('hashchange', () => resolve(), { once: true });
      setTimeout(resolve, 800);
      history.back();
    });
  }
  replace(hash);
  return Promise.resolve();
}

/**
 * Okno přes obrazovku (fotka, sdílení) jako krok v historii: tlačítko/gesto Zpět v telefonu ho zavře
 * a obrazovka pod ním zůstane. Zavřené jinak (křížek) krok z historie zase odebere.
 */
export function useBackClose(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const id = Math.random().toString(36).slice(2);
    history.pushState({ ...history.state, modal: id }, '');
    const onPop = () => { if (history.state?.modal !== id) closeRef.current(); };
    const onHash = () => closeRef.current(); // přechod na jinou obrazovku (odkaz v okně, upozornění)
    addEventListener('popstate', onPop);
    addEventListener('hashchange', onHash);
    return () => {
      removeEventListener('popstate', onPop);
      removeEventListener('hashchange', onHash);
      if (history.state?.modal === id) history.back();
    };
  }, []);
}

// Poslední známá data (skupiny, vozy, závady, komentáře, přehled) – zobrazí se hned, pak se obnoví ze sítě.
// Plní je i stahování na pozadí (offline.js), takže aplikace funguje i se slabým signálem.
// Při odhlášení se mažou (clearLocalCache).
const CACHE_PREFIX = 'zavady-cache:';
export const PHOTO_CACHE = 'zavady-foto'; // fotky závad v paměti telefonu (plní sw.js a offline.js)
const memoryCache = new Map();
function readStored(key) {
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)) ?? undefined; } catch { return undefined; }
}
// Závada, kterou ještě nikdo neotevřel, se najde v uloženém seznamu závad jejího vozu
function findCachedDefect(mode, id) {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(`${CACHE_PREFIX}${mode}:defects:`)) continue;
      const d = (JSON.parse(localStorage.getItem(k)) ?? []).find((x) => x.id === id);
      if (d) return d;
    }
  } catch { /* nevadí */ }
  return undefined;
}
function readCache(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  const v = readStored(key);
  if (v !== undefined) return v;
  const m = /^(\w+):defect:(.+)$/.exec(key);
  return m ? findCachedDefect(m[1], m[2]) : undefined;
}
function writeCache(key, data) {
  memoryCache.set(key, data);
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); } catch { /* plná paměť – nevadí */ }
}
export const readCached = (mode, key) => readCache(`${mode}:${key}`);
export const writeCached = (mode, key, data) => writeCache(`${mode}:${key}`, data);
export function clearLocalCache() {
  memoryCache.clear();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* nevadí */ }
  window.caches?.delete(PHOTO_CACHE).catch(() => {});
}

// Načte data a znovu je načte při změně závislostí nebo při živé změně v databázi (app.version).
// S cacheKey ukáže hned poslední známá data a obnoví je na pozadí.
export function useLoad(fn, deps, cacheKey) {
  const { api, version } = useApp();
  const key = cacheKey ? `${api.mode}:${cacheKey}` : null;
  const [state, setState] = useState(() => ({ loading: true, data: key ? readCache(key) : undefined, error: null }));
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => {
        if (!alive) return;
        if (key) writeCache(key, data);
        setState({ loading: false, data, error: null });
      },
      (error) => alive && setState((s) => ({ loading: false, data: s.data, error })),
    );
    return () => { alive = false; };
  }, [...deps, version]);
  return state;
}

// ───── Ikony ─────

const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ICONS = {
  back: 'M15 18l-6-6 6-6',
  search: `${circle(11, 11, 7)}M21 21l-5.2-5.2`,
  plus: 'M12 5v14M5 12h14',
  camera: `M3 8h3.5l2-3h7l2 3H21v12H3z${circle(12, 13.5, 3.8)}`,
  video: 'M2 7h13v10H2zM15 11l7-4v10l-7-4',
  image: `M3 3h18v18H3z${circle(8.5, 8.5, 1.5)}M21 15l-5-5L5 21`,
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  check: 'M20 6L9 17l-5-5',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  down: 'M6 9l6 6 6-6',
  user: `${circle(12, 8, 4)}M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1`,
  users: `${circle(9, 8, 3.5)}M2 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M16 4.3a3.5 3.5 0 0 1 0 7M22 20v-1a5 5 0 0 0-3-4.6`,
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  undo: 'M3 7v6h6M3.5 13A9 9 0 1 0 6 6.3L3 9',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  play: 'M7 4l13 8-13 8z',
  left: 'M15 18l-6-6 6-6',
  right: 'M9 18l6-6-6-6',
  history: `M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2`,
  wagon: `M3 6h18v9H3zM2 15h20M7 7v7M12 7v7M17 7v7${circle(7, 18, 1.8)}${circle(17, 18, 1.8)}`,
  codes: 'M4 6h2M4 12h2M4 18h2M9 6h11M9 12h11M9 18h11',
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5zM4 4.5v18M8 7h8M8 11h6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  clipboard: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M8.5 12.5l2 2 4.5-4.5M8.5 17.5h7',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  cloud: 'M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 7.97zM12 11v6M9.5 14.5 12 17l2.5-2.5',
  share: `${circle(18, 5, 3)}${circle(6, 12, 3)}${circle(18, 19, 3)}M8.6 13.5l6.8 4M15.4 6.5l-6.8 4`,
  'ios-share': 'M12 3v12M8 7l4-4 4 4M5 11v9h14v-9',
  eye: `M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z${circle(12, 12, 3)}`,
  light: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  sun: `${circle(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  'eye-off': 'M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2',
};
export const Icon = ({ name, size = 20, class: cls = '' }) => html`
  <svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;

// ───── Drobné prvky ─────

export const Badge = ({ n, class: cls = '' }) =>
  n > 0 ? html`<span class="badge ${cls}" aria-label=${plural(n, 'otevřená závada', 'otevřené závady', 'otevřených závad')}>${n > 99 ? '99+' : n}</span>` : null;

// Počet závad, které uživatel ještě neviděl (od jeho poslední návštěvy vozu)
export const NewBadge = ({ n, class: cls = '' }) =>
  n > 0 ? html`<span class="new-badge ${cls}" aria-label=${plural(n, 'nová závada', 'nové závady', 'nových závad')}>${plural(n > 99 ? 99 : n, 'nová', 'nové', 'nových')}</span>` : null;

/** Pole pro heslo s okem: klepnutím se tečky změní na znaky hesla a zpět. visible = na začátku zobrazené. */
export function PasswordInput({ value, onInput, visible = false, ...props }) {
  const [shown, setShown] = useState(visible);
  return html`
    <span class="password-field">
      <input ...${props} type=${shown ? 'text' : 'password'} autocapitalize="off" spellcheck="false"
        value=${value} onInput=${onInput} />
      <button type="button" class="icon-btn password-toggle" aria-pressed=${shown}
        aria-label=${shown ? 'Skrýt heslo' : 'Zobrazit heslo'} title=${shown ? 'Skrýt heslo' : 'Zobrazit heslo'}
        onMouseDown=${(e) => e.preventDefault()} onClick=${() => setShown(!shown)}>
        <${Icon} name=${shown ? 'eye-off' : 'eye'} />
      </button>
    </span>`;
}

export const WagonNumber = ({ number, class: cls = '' }) => {
  const [head, tail] = splitNumber(number);
  return html`<span class="wagon-number ${cls}">${head}<b>${tail}</b></span>`;
};

export function OpenCount({ w }) {
  if (!w.open_count) return html`<span class="count count-ok"><${Icon} name="check" size=${14} /> bez závad</span>`;
  return html`
    <${NewBadge} n=${w.new_count} class="small" />
    <span class="count count-open">${plural(w.open_count, 'závada', 'závady', 'závad')}</span>`;
}

// Zvýrazní v textu hledaná slova (bez ohledu na diakritiku)
export function Highlight({ text, tokens }) {
  if (!text || !tokens?.length) return text ?? '';
  const out = [];
  let pos = 0;
  for (const [a, b] of matchRanges(text, tokens)) {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(html`<mark>${text.slice(a, b)}</mark>`);
    pos = b;
  }
  out.push(text.slice(pos));
  return out;
}

// ───── Katalog kódů závad (příloha 9 VSP) ─────

// Katalog se načte jednou (api si ho pamatuje) a sdílí ho všechny obrazovky
export function useCatalog() {
  const { api } = useApp();
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    let alive = true;
    api.listCodes().then((c) => alive && setCatalog(c), () => alive && setCatalog([]));
    return () => { alive = false; };
  }, []);
  return catalog;
}

// Obrázky z katalogu (Map kód → obrázky); načtou se jednou, po nahrání nových se obnoví
export function useCodeImages() {
  const { api } = useApp();
  return useLoad(() => api.listCodeImages(), []).data ?? null;
}

// Krátké shrnutí kódu z katalogu: „Pojezd › Nalisované obruče kol – Tloušťka menší než …“
export function CodeSummary({ code, catalog }) {
  const c = catalog?.find((x) => x.kod === code);
  if (!c) return null;
  const text = [c.kontext, c.popis].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return html`<div class="code-summary">${c.cesta && html`<b>${c.cesta}</b>`}${c.cesta && text ? ' – ' : ''}${text}</div>`;
}

// Spodní lišta se záložkami hlavní obrazovky
// Klepnutí na záložku, která je už otevřená na své úvodní obrazovce, ji vrátí na začátek
// (vymaže hledání, posune nahoru). Z vnořené stránky (skupina, vůz, část katalogu) vede na úvod záložky.
// Červený odznak u záložky Přehled = počet nových (nepřečtených) závad od ostatních.
// Přepínání mezi záložkami se v historii nehromadí (jako v aplikacích pro Android): Zpět z kterékoli
// záložky vede na Vozy a odtud z aplikace ven.
const TABS = ['#/', '#/prehled', '#/kody', '#/predpisy'];
export function BottomNav({ active }) {
  const { resetTab, newDefects } = useApp();
  const onTab = (e, href) => {
    const here = location.hash || '#/';
    if (here === href) { e.preventDefault(); resetTab(); return; }
    if (here !== '#/' && TABS.includes(here)) { e.preventDefault(); goBack(href); }
  };
  const tab = (key, href, icon, label, unread = 0) => html`
    <a href=${href} class=${active === key ? 'active' : ''} onClick=${(e) => onTab(e, href)}>
      <span class="nav-icon"><${Icon} name=${icon} size=${22} />
        ${unread > 0 && html`<span class="nav-badge" aria-label=${plural(unread, 'nová závada', 'nové závady', 'nových závad')}>
          ${unread > 99 ? '99+' : unread}</span>`}</span>
      <span>${label}</span></a>`;
  return html`
    <nav class="bottom-nav" aria-label="Hlavní nabídka">
      ${tab('vozy', '#/', 'wagon', 'Vozy')}
      ${tab('prehled', '#/prehled', 'clipboard', 'Přehled', newDefects)}
      ${tab('kody', '#/kody', 'codes', 'Kódy závad')}
      ${tab('predpisy', '#/predpisy', 'book', 'Předpisy')}
    </nav>`;
}

// Název skupiny na dva řádky: odborný nahoře, slangový menším písmem pod ním
export const GroupName = ({ g }) => html`${g.name}${g.slang && html`<small class="group-slang">${g.slang}</small>`}`;

export const Loading = () => html`<div class="loading"><span class="spinner"></span> Načítám…</div>`;
export const ErrorBox = ({ error }) => error ? html`<div class="error-box"><${Icon} name="alert" /> ${error.message ?? String(error)}</div>` : null;
export const Empty = ({ children }) => html`<div class="empty">${children}</div>`;

export function TopBar({ title, back, children, sub }) {
  return html`
    <header class="topbar">
      ${back && html`<a class="icon-btn" href=${back} aria-label="Zpět"
        onClick=${(e) => { e.preventDefault(); goBack(back); }}><${Icon} name="back" size=${24} /></a>`}
      <div class="topbar-title">
        <h1>${title}</h1>
        ${sub && html`<div class="topbar-sub">${sub}</div>`}
      </div>
      <div class="topbar-right">${children}</div>
    </header>`;
}

export const Fab = ({ href, label = 'Nová závada' }) => html`
  <a class="fab" href=${href}><${Icon} name="plus" size=${22} /> ${label}</a>`;

// Kulaté tlačítko nad „Nová závada“ (pevně na místě i při posunu stránky): nové komentáře s červeným počtem
export function CommentsFab() {
  const { commentInbox } = useApp();
  const unread = (commentInbox ?? []).reduce((n, r) => n + r.unread, 0);
  return html`
    <a class="fab-comments" href="#/komentare"
      aria-label=${unread ? plural(unread, 'nový komentář', 'nové komentáře', 'nových komentářů') : 'Komentáře'}>
      <${Icon} name="chat" size=${40} />
      ${unread > 0 && html`<span class="nav-badge">${unread > 99 ? '99+' : unread}</span>`}
    </a>`;
}

export function UserButton() {
  const { me, pendingUsers: pending } = useApp();
  return html`
    <a class="avatar" href="#/ucet" aria-label="Můj účet" title=${me?.full_name}>
      ${(me?.full_name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
      ${pending > 0 && html`<span class="dot" title="Noví uživatelé čekají na schválení"></span>`}
    </a>`;
}

// ───── Vyhledávání vozu podle posledního čtyřčíslí ─────
// Uživatel píše jen 4 číslice, pomlčka před kontrolní číslicí je pevně předvyplněná: [0][1][7]-[4].
// Skutečné pole je průhledné přes políčka, takže na telefonu funguje běžná číselná klávesnice.

export function WagonSearch({ groupId, onQuery }) {
  const { api } = useApp();
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  useEffect(() => { onQuery?.(q); }, [q]);
  useEffect(() => {
    if (!q) { setResults(null); return; }
    let alive = true;
    const t = setTimeout(() => api.searchWagons(q, groupId).then(
      (r) => alive && (setResults(r), setError(null)),
      (e) => alive && setError(e),
    ), 120);
    return () => { alive = false; clearTimeout(t); };
  }, [q, groupId]);

  function onInput(e) {
    const d = digitsOnly(e.currentTarget.value);
    // Vložené celé číslo vozu → vezme se poslední čtyřčíslí; pátá napsaná číslice se ignoruje.
    const next = d.length > 5 ? d.slice(-4) : d.slice(0, 4);
    e.currentTarget.value = next;
    setQ(next);
  }

  function clear(e) {
    e.preventDefault();
    setQ('');
    inputRef.current?.focus();
  }

  const active = focused && q.length < 4 ? q.length : -1;
  const box = (i) => html`<span class="code-box ${i === active ? 'active' : ''}">${q[i] ?? ''}</span>`;
  const shown = q.length === 4 ? `${q.slice(0, 3)}-${q[3]}` : q;

  return html`
    <div class="search">
      <label class="search-box code-search">
        <${Icon} name="search" />
        <span class="code" aria-hidden="true">${box(0)}${box(1)}${box(2)}<span class="code-dash">-</span>${box(3)}</span>
        <span class="code-hint">${q ? '' : 'poslední 4 číslice vozu'}</span>
        <input ref=${inputRef} class="code-input" type="text" inputmode="numeric" pattern="[0-9]*"
          autocomplete="off" enterkeyhint="search" aria-label="Hledat vůz podle posledních 4 číslic"
          value=${q} onInput=${onInput} onFocus=${() => setFocused(true)} onBlur=${() => setFocused(false)} />
        ${q && html`<button class="icon-btn small clear" onClick=${clear} aria-label="Vymazat"><${Icon} name="x" size=${18} /></button>`}
      </label>
      ${q && html`
        <div class="search-results">
          <${ErrorBox} error=${error} />
          ${results === null && !error && html`<${Loading} />`}
          ${results?.length > 0 && html`
            <table class="table">
              <thead><tr><th>Číslo vozu</th><th>Otevřené závady</th></tr></thead>
              <tbody>
                ${results.map((w) => html`
                  <tr key=${w.id} onClick=${() => go(`#/vuz/${w.id}`)}>
                    <td>
                      <a href="#/vuz/${w.id}"><${WagonNumber} number=${w.number} /></a>
                      ${!groupId && html`<div class="muted small">${w.group_name}</div>`}
                    </td>
                    <td><${OpenCount} w=${w} /></td>
                  </tr>`)}
              </tbody>
            </table>
            ${results.length === 50 && html`<div class="hint">Zobrazeno prvních 50 shod – dopište další číslice.</div>`}`}
          ${results?.length === 0 && html`
            <${Empty}>
              Žádný vůz${groupId ? ' v této skupině' : ''} nekončí na ${shown}${q.length < 4 ? '…' : '.'}
              <a class="btn btn-primary block" href="#/nova${groupId ? `?skupina=${groupId}` : ''}">
                <${Icon} name="plus" /> Přidat závadu na nový vůz</a>
            <//>`}
        </div>`}
    </div>`;
}

// ───── Karta závady ─────

export function DefectCard({ d, wagon = null, showComments = true, isNew = false }) {
  const { api, me, refresh, toast, openMedia, share, commentInbox } = useApp();
  const unreadComments = commentInbox?.find((r) => r.defect_id === d.id)?.unread ?? 0;
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const catalog = useCatalog();
  const resolved = !!d.resolved_at;
  const color = resolved ? 'ok' : 'open';
  const foundAt = foundAtOf(d);
  const backdated = Date.parse(d.created_at) - Date.parse(foundAt) > 15 * 60 * 1000;

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast(okMsg);
      refresh();
      return true;
    } catch (e) {
      toast(e.message, { kind: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const resolve = () => run(() => api.resolveDefect(d.id, note), 'Závada označena jako opravená.')
    .then((ok) => { if (ok) { setResolving(false); setNote(''); } });
  const reopen = () => confirm('Vrátit závadu mezi neopravené?')
    && run(() => api.reopenDefect(d.id), 'Závada vrácena mezi aktivní.');
  const remove = () => confirm('Opravdu smazat tuto závadu včetně fotek a komentářů?')
    && run(() => api.deleteDefect(d.id), 'Závada smazána.');

  return html`
    <article class="defect defect-${color}">
      <div class="defect-head">
        ${isNew && html`<span class="chip chip-new" title="Vložená od vaší poslední návštěvy vozu">Nová</span>`}
        ${resolved
          ? html`<span class="chip chip-ok"><${Icon} name="check" size=${14} /> Opraveno</span>`
          : html`<span class="chip chip-open">Neopravená</span>`}
        ${d.defect_code && html`<span class="chip chip-code" title="Kód závady dle přílohy 9 VSP">kód ${d.defect_code}</span>`}
        ${resolved && html`<span class="chip chip-lock" title="Opravená závada je zamčená – upravit ji může jen administrátor"><${Icon} name="lock" size=${13} /> zamčeno</span>`}
        <span class="spacer"></span>
        <span class="muted small" title="Datum a čas zjištění">zjištěno ${formatDateTime(foundAt)}</span>
      </div>
      ${d.defect_code && html`<${CodeSummary} code=${d.defect_code} catalog=${catalog} />`}
      <p class="defect-text">${d.description}</p>
      <div class="muted small">
        Vložil(a) ${d.created_by_name || 'neznámý uživatel'}${backdated ? ` · zapsáno ${formatDateTime(d.created_at)}` : ''}${d.updated_at ? ' · upraveno' : ''}
      </div>

      ${d.attachments?.length > 0 && html`
        <div class="media-grid">
          ${d.attachments.map((a, i) => html`
            <button key=${a.id} class="media-thumb" onClick=${() => openMedia(d.attachments, i, { download: ['zavada', (wagon?.number ?? d.number ?? '').slice(-4)].filter(Boolean).join('-') })}
              aria-label=${a.kind === 'video' ? 'Přehrát video' : 'Zobrazit fotku'}>
              ${a.kind === 'video'
                ? html`<video src=${a.url} preload="none" muted playsinline></video><span class="play"><${Icon} name="play" size=${22} /></span>`
                : html`<img src=${a.url} alt="" loading="lazy" />`}
            </button>`)}
        </div>`}

      ${resolved && html`
        <div class="resolution">
          <${Icon} name="check" size=${16} />
          <div>
            <b>Opraveno ${formatDateTime(d.resolved_at)}</b> – ${d.resolved_by_name || 'neznámý uživatel'}
            ${d.resolution_note && html`<div>${d.resolution_note}</div>`}
          </div>
        </div>`}

      ${resolving && html`
        <div class="resolve-form">
          <textarea rows="2" placeholder="Poznámka k opravě (nepovinné)" value=${note}
            onInput=${(e) => setNote(e.currentTarget.value)}></textarea>
          <div class="row">
            <button class="btn btn-ok" disabled=${busy} onClick=${resolve}><${Icon} name="check" /> Potvrdit opravu</button>
            <button class="btn" onClick=${() => setResolving(false)}>Zrušit</button>
          </div>
        </div>`}

      <div class="defect-actions">
        ${showComments && html`
          <a class="btn btn-ghost" href="#/zavada/${d.id}"><${Icon} name="chat" size=${18} />
            ${d.comment_count ? plural(d.comment_count, 'komentář', 'komentáře', 'komentářů') : 'Komentovat'}
            ${unreadComments > 0 && html`<span class="new-badge small">${plural(unreadComments, 'nový', 'nové', 'nových')}</span>`}</a>`}
        <button class="btn btn-whatsapp" title="Poslat do WhatsAppu" aria-label="Poslat závadu do WhatsAppu"
          onClick=${() => quickShare({
            d, w: wagon, openDialog: (prepared) => share(d.id, { prepared }), onShared: () => praise(toast),
          })}>
          <${Icon} name="share" size=${18} /> WhatsApp</button>
        <span class="defect-tools">
          ${resolved && can.resolve(me, d) && html`
            <button class="btn btn-ghost" disabled=${busy} onClick=${reopen} title="Vrátit mezi neopravené"><${Icon} name="undo" size=${18} /></button>`}
          ${can.editDefect(me, d) && html`
            <a class="btn btn-ghost" href="#/upravit/${d.id}" title="Upravit"><${Icon} name="edit" size=${18} /></a>
            <button class="btn btn-ghost danger" disabled=${busy} onClick=${remove} title="Smazat"><${Icon} name="trash" size=${18} /></button>`}
        </span>
      </div>
      ${!resolved && !resolving && can.resolve(me, d) && html`
        <button class="btn btn-ok block resolve-btn" disabled=${busy} onClick=${() => setResolving(true)}>
          <${Icon} name="check" size=${18} /> Označit jako opravené</button>`}
    </article>`;
}

// ───── Sdílení závady do WhatsAppu (nebo jinam přes nabídku sdílení telefonu) ─────

// Pochvala po zapsání nebo sdílení závady. Po uložení se hned nabízí sdílení – tam se už znovu neukáže.
const PRAISE = 'Děkuji za zapsání závady, super, že jste dali vědět kolegům 👍';
let praisedAt = 0;
export function praise(toast, { title, always = false } = {}) {
  if (!always && Date.now() - praisedAt < 3 * 60000) return;
  praisedAt = Date.now();
  toast(PRAISE, { title, duration: 6000 });
}

// Text zprávy: jen číslo vozu a popis (přání uživatele 29. 10.), fotky jdou s ním; *hvězdičky* = tučně ve WhatsAppu
export function defectShareText(d, w) {
  return `*Vůz ${formatNumber(w.number)}*\n${d.description.trim()}`;
}

// Fotky závady jako soubory pro sdílení (videa ne – bývají velká). Fotky z paměti telefonu jsou hned.
async function photoFiles(d, w) {
  const out = [];
  const photos = (d.attachments ?? []).filter((a) => a.kind !== 'video' && a.url);
  for (const a of photos) {
    try {
      out.push(shareFile(await (await fetch(a.url)).blob(), w, out.length));
    } catch { /* fotku se nepodařilo stáhnout – sdílí se bez ní */ }
  }
  return out;
}

function shareFile(blob, w, i) {
  const type = blob.type || 'image/jpeg';
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return new File([blob], `zavada-${w.number.slice(-4)}-${i + 1}.${ext}`, { type });
}

/**
 * Fotky z formuláře (sdílení hned po uložení) jako zmenšené kopie v paměti. Soubory přímo z fotoaparátu
 * nebo galerie Chrome v Androidu do sdílení nepředal – nabídka sdílení se vůbec neotevřela (28. 10.).
 * Kopie v paměti se sdílí stejně jako fotky stažené z aplikace (tlačítko WhatsApp u závady), které fungují.
 */
export async function sharePhotoCopies(files, w) {
  const out = [];
  for (const f of files.filter((x) => x.type.startsWith('image/'))) {
    try {
      const small = await compressImage(f);
      out.push(shareFile(new Blob([await small.arrayBuffer()], { type: small.type }), w, out.length));
    } catch { /* fotku se nepodařilo připravit – sdílí se bez ní */ }
  }
  return out;
}

const shareable = (files) => (files?.length && navigator.canShare?.({ files }) ? files : []);

/**
 * Android: WhatsApp připíše sdílený text ke každé fotce zvlášť (4 fotky = 4× celý popis závady) a webová
 * aplikace to ovlivnit neumí. Víc fotek se proto posílá ve dvou krocích (přání uživatele 29. 10.): 1. fotky bez
 * textu (ve WhatsAppu jako album), 2. text do stejné skupiny – přijde pod fotky jen jednou. Na iPhonu odejdou
 * fotky i text jedním sdílením a text přijde pod fotky – tak to fungovalo od začátku.
 */
const twoSteps = (photoCount) => isAndroid() && photoCount > 1;

// ───── Víc fotek jako jeden obrázek (Android, „Jiné možnosti“) ─────
// Fotky pod sebou, text u obrázku jen jednou, vše jedním sdílením. WhatsApp obrázek zmenší podle delší strany
// (běžná kvalita ~1600 px, HD 4096 px), takže čím víc fotek, tím je každá užší.
const COLLAGE_W = 1600; // nejvíc (fotky z aplikace mají delší stranu nejvýš 1920 px)
const COLLAGE_MAX_H = 4096; // vyšší obrázek by WhatsApp stejně zmenšil
const COLLAGE_GAP = 8;
const COLLAGE_MAX = 12;

async function collageFile(files, w) {
  const imgs = (await Promise.all(files.slice(0, COLLAGE_MAX).map((f) => createImageBitmap(f).catch(() => null))))
    .filter(Boolean);
  if (imgs.length < 2) return null;
  // všechny fotky stejně široké, nic se neořízne; šířka podle toho, aby se vešly do COLLAGE_MAX_H
  const gaps = COLLAGE_GAP * (imgs.length - 1);
  const tall = imgs.reduce((s, b) => s + b.height / b.width, 0);
  const width = Math.floor(Math.min(COLLAGE_W, (COLLAGE_MAX_H - gaps) / tall));
  const heights = imgs.map((b) => Math.round((width * b.height) / b.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = heights.reduce((s, h) => s + h, 0) + gaps;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const r0 = Math.round(width / 30); // číslo fotky v rohu, ať se na ni dá v debatě odkázat
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(r0 * 1.2)}px sans-serif`;
  let y = 0;
  imgs.forEach((b, i) => {
    g.drawImage(b, 0, y, width, heights[i]);
    g.fillStyle = 'rgba(0, 0, 0, .6)';
    g.beginPath();
    g.arc(r0 * 1.5, y + r0 * 1.5, r0, 0, 2 * Math.PI);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(String(i + 1), r0 * 1.5, y + r0 * 1.5 + 1);
    y += heights[i] + COLLAGE_GAP;
  });
  imgs.forEach((b) => b.close?.());
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return blob ? new File([blob], `zavada-${w.number.slice(-4)}-fotky.jpg`, { type: 'image/jpeg' }) : null;
}

// Fotky pro sdílení (jen ty, které telefon sdílet umí)
export async function prepareShare(filesOrPromise) {
  return shareable(await filesOrPromise);
}

// Obrázek s fotkami pod sebou se skládá až po klepnutí (sdílení musí začít do pár sekund – to stihne)
async function collageShare(text, files, w) {
  const one = await collageFile(files, w).catch(() => null);
  if (!one) throw new Error('obrázek z fotek se nepodařilo připravit.');
  await nativeShare(text, shareable([one]));
}

async function nativeShare(text, files) {
  // WhatsApp na iPhonu k fotkám text někdy nepřipojí – ať je aspoň ve schránce. Na Androidu ne: telefon
  // ukáže „Zkopírováno do schránky“ a vypadá to, jako by se místo odeslání jen zkopíroval text.
  if (text && files.length && isIos()) navigator.clipboard?.writeText(text).catch(() => {});
  const data = files.length ? { files } : {};
  if (text) data.text = text;
  const started = Date.now();
  try {
    await navigator.share(data);
  } catch (e) {
    // Zrušení i selhání hlásí prohlížeč stejně (AbortError). Okamžité „zrušení“ znamená, že se nabídka
    // sdílení vůbec neotevřela – to je chyba telefonu, ne rozhodnutí uživatele, a musí být vidět.
    if (e.name === 'AbortError' && Date.now() - started < 1000) {
      throw new Error(files.length ? 'telefon nabídku sdílení s fotkami neotevřel.' : 'telefon nabídku sdílení neotevřel.');
    }
    throw e;
  }
}

/**
 * Sdílení na jedno klepnutí: rovnou otevře nabídku sdílení telefonu (text + fotky). Na Androidu s víc fotkami
 * otevře okno se dvěma kroky (twoSteps). Když to nejde (počítač, fotky se stahují dlouho, telefon sdílení
 * odmítne), otevře okno s jedním tlačítkem.
 */
export async function quickShare({ d, w, openDialog, onShared }) {
  if (!w || typeof navigator.share !== 'function') { openDialog({}); return; }
  const ready = prepareShare(photoFiles(d, w));
  if (twoSteps((d.attachments ?? []).filter((a) => a.kind !== 'video' && a.url).length)) {
    openDialog({ d, w, ready });
    return;
  }
  const files = await Promise.race([ready, new Promise((res) => setTimeout(() => res(null), 2500))]);
  if (files === null) { openDialog({ d, w, ready }); return; }
  try {
    await nativeShare(defectShareText(d, w), files);
    onShared?.();
  } catch (e) {
    if (e.name !== 'AbortError') openDialog({ d, w, files, error: new Error(`Sdílení se nepovedlo: ${e.message}`) });
  }
}

/**
 * Okno pro sdílení: náhled zprávy a jedno velké tlačítko, na Androidu s víc fotkami dvě (fotky, pak text).
 * prepared = { d, w, files | ready (prepareShare), error } (bez sítě).
 */
export function ShareDialog({ id, afterSave = false, prepared = {}, onClose }) {
  const { api, toast } = useApp();
  const [data, setData] = useState(prepared.d && prepared.w ? { d: prepared.d, w: prepared.w } : null);
  const [files, setFiles] = useState(prepared.files ?? null); // null = připravuji fotky
  const [error, setError] = useState(prepared.error ?? null);
  const [photosSent, setPhotosSent] = useState(false);
  useBackClose(onClose);

  useEffect(() => {
    let alive = true;
    (async () => {
      let { d, w } = prepared;
      if (!d || !w) {
        d = await api.getDefect(id);
        if (!d) throw new Error('Závada nebyla nalezena (možná byla smazána).');
        w = await api.getWagon(d.wagon_id);
        if (alive) setData({ d, w });
      }
      if (!prepared.files) {
        const f = await (prepared.ready ?? prepareShare(photoFiles(d, w)));
        if (alive) setFiles(f);
      }
    })().catch((e) => alive && setError(e));
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => { alive = false; removeEventListener('keydown', onKey); };
  }, [id]);

  const count = files?.length ?? 0;
  const two = twoSteps(count);
  const text = data ? defectShareText(data.d, data.w) : '';
  const canNative = typeof navigator.share === 'function';
  const preparing = canNative && files === null && !error;
  const waLink = `https://wa.me/?text=${encodeURIComponent(text)}`;

  // done = false: okno zůstane otevřené (po fotkách se ještě posílá text)
  async function send(share, done = true) {
    setError(null);
    try {
      await share();
      if (!done) return;
      praise(toast);
      onClose();
    } catch (e) {
      if (e.name !== 'AbortError') setError(new Error(`Sdílení se nepovedlo: ${e.message}`));
    }
  }
  // Text se při tom zkopíruje – ve WhatsAppu ho jde hned vložit pod fotky, bez návratu do aplikace (krok 2)
  const sendPhotos = () => send(async () => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    await nativeShare('', files);
    setPhotosSent(true);
  }, false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast('Text zprávy je zkopírovaný.');
    } catch {
      toast('Kopírování se nepovedlo.', { kind: 'error' });
    }
  }

  const what = !count ? '' : count === 1 ? ' (text + fotka)' : ` (text + ${plural(count, 'fotka', 'fotky', 'fotek')})`;
  return html`
    <div class="dialog-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="dialog-head">
          <h2 id="share-title">${afterSave ? 'Závada uložena – poslat do WhatsAppu?' : 'Poslat do WhatsAppu'}</h2>
          <button class="icon-btn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="x" /></button>
        </div>
        <${ErrorBox} error=${error} />
        ${!data && !error && html`<${Loading} />`}
        ${data && html`
          ${!canNative
            ? html`<a class="btn btn-whatsapp block big-btn" href=${waLink} target="_blank" rel="noopener"
                onClick=${() => praise(toast)}>Otevřít WhatsApp</a>
              <p class="muted small">Otevře se WhatsApp s připraveným textem, vyberete jen skupinu. Fotky pošlete z telefonu.</p>`
            : two
              ? html`<button class="btn ${photosSent ? '' : 'btn-whatsapp'} block big-btn" onClick=${sendPhotos}>
                  ${photosSent && html`<${Icon} name="check" />`} 1. Poslat ${plural(count, 'fotka', 'fotky', 'fotek')}</button>
                <button class="btn ${photosSent ? 'btn-whatsapp' : ''} block big-btn" onClick=${() => send(() => nativeShare(text, []))}>
                  2. Poslat text</button>
                <p class="muted small">Text zprávy se při kroku 1 zkopíruje: po odeslání fotek ho ve WhatsAppu vložte pod ně
                  (podržet prst v poli pro zprávu → Vložit). Nebo se vraťte sem a klepněte na 2. Poslat text – do stejné skupiny.</p>`
              : html`<button class="btn btn-whatsapp block big-btn" disabled=${preparing} onClick=${() => send(() => nativeShare(text, files ?? []))}>
                  ${preparing ? 'Připravuji fotky…' : `Poslat do WhatsAppu${what}`}</button>
                <p class="muted small">V nabídce klepněte na WhatsApp a vyberte skupinu.</p>`}
          <div class="share-preview">${text}</div>
          <details class="share-more" open=${!!error}>
            <summary>Jiné možnosti</summary>
            ${canNative && two && html`<button class="btn block" onClick=${() => send(() => collageShare(text, files, data.w))}>
              Fotky pod sebou v jednom obrázku i s textem</button>`}
            ${canNative && !two && html`<a class="btn block" href=${waLink} target="_blank" rel="noopener"
              onClick=${() => praise(toast)}>WhatsApp jen s textem</a>`}
            <button class="btn block" onClick=${copy}><${Icon} name="clipboard" size=${18} /> Kopírovat text</button>
          </details>
          ${afterSave && html`<button class="btn btn-ghost block" onClick=${onClose}>Teď ne</button>`}`}
      </div>
    </div>`;
}

// ───── Obnovení stažením dolů (když je stránka nahoře) ─────

const PULL_MAX = 110;
const PULL_TRIGGER = 70;

export function PullToRefresh({ onRefresh }) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const state = useRef({ startY: null, pull: 0, busy: false });

  useEffect(() => {
    const st = state.current;
    // Ne v okně sdílení, prohlížeči fotek ani v textových polích
    const blocked = (target) => document.querySelector('.lightbox, .dialog-backdrop')
      || target.closest?.('textarea, input, select, .composer');
    const onStart = (e) => {
      st.startY = !st.busy && scrollY <= 0 && e.touches.length === 1 && !blocked(e.target) ? e.touches[0].clientY : null;
    };
    const onMove = (e) => {
      if (st.startY === null) return;
      const dy = e.touches[0].clientY - st.startY;
      st.pull = dy > 0 && scrollY <= 0 ? Math.min(dy * 0.5, PULL_MAX) : 0;
      setPull(st.pull);
    };
    const onEnd = async () => {
      if (st.startY === null) return;
      const go = st.pull >= PULL_TRIGGER;
      st.startY = null; st.pull = 0;
      setPull(0);
      if (!go) return;
      st.busy = true; setBusy(true);
      try {
        await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 600))]);
      } finally {
        st.busy = false; setBusy(false);
      }
    };
    addEventListener('touchstart', onStart, { passive: true });
    addEventListener('touchmove', onMove, { passive: true });
    addEventListener('touchend', onEnd);
    addEventListener('touchcancel', onEnd);
    return () => {
      removeEventListener('touchstart', onStart);
      removeEventListener('touchmove', onMove);
      removeEventListener('touchend', onEnd);
      removeEventListener('touchcancel', onEnd);
    };
  }, [onRefresh]);

  if (!pull && !busy) return null;
  const ready = pull >= PULL_TRIGGER;
  return html`
    <div class="ptr" style=${`transform: translate(-50%, ${busy ? 64 : pull - 10}px)`} role="status">
      ${busy
        ? html`<span class="spinner"></span> Obnovuji…`
        : html`<${Icon} name="down" class=${ready ? 'flip' : ''} /> ${ready ? 'Pusťte pro obnovení' : 'Táhněte dolů'}`}
    </div>`;
}

// ───── Nová verze aplikace ─────

/** Verze, kterou má service worker stažená (sw.js → CACHE 'zavady-vNN'); 0 = nevíme. */
export function swVersion(worker = navigator.serviceWorker?.controller) {
  if (!worker) return Promise.resolve(0);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(Number(String(e.data ?? '').replace(/^zavady-v/, '')) || 0);
    worker.postMessage({ type: 'version' }, [ch.port2]);
    setTimeout(() => resolve(0), 3000);
  });
}

/**
 * Znovunačtení aplikace (nová verze): nové razítko v adresách souborů (viz index.html), jinak by iPhone
 * spustil znovu staré skripty ze své paměti, dokud se aplikace úplně nezavře.
 */
export function reloadApp() {
  try { localStorage.setItem('app-reload', String(Date.now())); } catch {}
  location.reload();
}

/**
 * Aktualizace bez zavírání aplikace: zeptá se webu na novou verzi, počká, až se stáhne, a aplikaci
 * načte znovu. Vrací 'reload' (načítá se nová verze), 'latest' (novější není), 'offline' nebo 'error'.
 */
export async function updateApp(current) {
  if (!navigator.onLine) return 'offline';
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'latest';
  try {
    await reg.update();
    const sw = reg.installing ?? reg.waiting;
    if (sw) {
      await new Promise((resolve, reject) => {
        const check = () => {
          if (sw.state === 'activated') resolve();
          else if (sw.state === 'redundant') reject(new Error('Stažení nové verze selhalo.'));
        };
        sw.addEventListener('statechange', check);
        check();
        setTimeout(() => reject(new Error('Stažení nové verze trvá příliš dlouho.')), 60000);
      });
    }
  } catch {
    return 'error';
  }
  if ((await swVersion(reg.active)) > current) {
    reloadApp();
    return 'reload';
  }
  return 'latest';
}

// ───── Prohlížeč fotek a videí ─────

// Stažení fotky nebo videa do telefonu (Stažené soubory; galerie je ukáže v albu Download)
async function downloadMedia(a, name) {
  const blob = await (await fetch(a.url)).blob();
  const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('quicktime', 'mov');
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: `${name}.${ext}` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Prohlížeč fotek a videí. download = začátek názvu staženého souboru (bez něj se stahovat nedá – katalog). */
export function Lightbox({ items, index, download, onClose }) {
  const { toast } = useApp();
  const [i, setI] = useState(index);
  const [busy, setBusy] = useState(false);
  const a = items[i];
  useBackClose(onClose);
  async function save(list) {
    setBusy(true);
    try {
      for (const [k, item] of list.entries()) {
        if (k) await new Promise((r) => setTimeout(r, 400)); // telefon jinak některá stažení zahodí
        await downloadMedia(item, `${download}-${items.indexOf(item) + 1}`);
      }
      toast(`Staženo do telefonu: ${list.length === 1 ? (list[0].kind === 'video' ? 'video' : 'fotka')
        : plural(list.length, 'soubor', 'soubory', 'souborů')} (Stažené soubory).`);
    } catch (e) {
      toast(`Stažení se nepovedlo: ${e.message}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      if (e.key === 'ArrowRight') setI((x) => Math.min(items.length - 1, x + 1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="lightbox" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <button class="icon-btn lb-close" onClick=${onClose} aria-label="Zavřít"><${Icon} name="x" size=${28} /></button>
      ${download && html`
        <div class="lb-tools">
          <button disabled=${busy} onClick=${() => save([a])}><${Icon} name="download" size=${18} /> Stáhnout</button>
          ${items.length > 1 && html`<button disabled=${busy} onClick=${() => save(items)}>Vše (${items.length})</button>`}
        </div>`}
      ${a.kind === 'video'
        ? html`<video key=${a.id} src=${a.url} controls autoplay playsinline></video>`
        : html`<img key=${a.id} src=${a.url} alt="" />`}
      ${items.length > 1 && html`
        <button class="icon-btn lb-prev" disabled=${i === 0} onClick=${() => setI(i - 1)} aria-label="Předchozí"><${Icon} name="left" size=${32} /></button>
        <button class="icon-btn lb-next" disabled=${i === items.length - 1} onClick=${() => setI(i + 1)} aria-label="Další"><${Icon} name="right" size=${32} /></button>
        <div class="lb-count">${i + 1} / ${items.length}</div>`}
    </div>`;
}

export function Toasts({ items, dismiss }) {
  return html`
    <div class="toasts" role="status" aria-live="polite">
      ${items.map((t) => html`
        <div key=${t.id} class="toast toast-${t.kind ?? 'info'}"
          onClick=${() => { if (t.action) t.action(); else if (t.href) go(t.href); dismiss(t.id); }}>
          ${t.title && html`<b>${t.title}</b>`}
          <div>${t.message}</div>
        </div>`)}
    </div>`;
}

// ───── Upozornění: nabídka po přihlášení, zapnutí se zkušebním upozorněním ─────

const flag = (key) => { try { return !!localStorage.getItem(key); } catch { return false; } };
const setFlag = (key, on) => {
  try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch { /* nevadí */ }
};
// Ručně vypnutá upozornění (Můj účet) se sama znovu nezapínají ani nenabízejí
export const isPushOff = (userId) => flag(`zavady-push-off:${userId}`);
export const setPushOff = (userId, on) => setFlag(`zavady-push-off:${userId}`, on);

// iPhone/iPad (iPad se hlásí jako Mac s dotykovým displejem) a aplikace spuštěná z ikony na ploše
export const isIos = () => !/Android/.test(navigator.userAgent)
  && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const isStandalone = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;

/** Zapnout upozornění (telefon se zeptá) a hned poslat zkušební, ať je vidět, že chodí. */
export async function enablePush(api, toast, userId) {
  await api.push.enable();
  setPushOff(userId, false);
  try {
    await api.push.test();
    toast('Upozornění zapnuta. Za pár sekund přijde zkušební upozornění.');
  } catch (e) {
    toast(`Upozornění jsou zapnutá, zkušební se ale nepodařilo poslat: ${e.message}`, { kind: 'error' });
  }
}

/** Karta na úvodní obrazovce: zapnutí upozornění jedním klepnutím (+ Povolit v telefonu). */
export function PushOffer() {
  const { api, me, toast } = useApp();
  const [state, setState] = useState(null); // null = nic | 'offer' | 'denied'
  const [busy, setBusy] = useState(false);
  const hiddenKey = `zavady-push-offer-hidden:${me.id}`;

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let next = null;
      // na iPhonu v Safari upozornění nejdou – přidání na plochu nabízí karta InstallOffer
      if (flag(hiddenKey) || isPushOff(me.id) || (isIos() && !isStandalone())) next = null;
      else if (api.push.supported() && (await api.push.status().catch(() => 'off')) !== 'on') {
        // už povolené (třeba po novém přihlášení) → zapnout bez ptaní; jinak nabídnout
        if (api.push.permission() === 'denied') next = 'denied';
        else if ((await api.push.resume().catch(() => 'off')) !== 'on') next = 'offer';
      }
      if (alive) setState(next);
    };
    check();
    // po návratu z nastavení telefonu (povolení upozornění) se karta sama aktualizuje
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [me.id]);

  if (!state) return null;
  const hide = () => { setFlag(hiddenKey, true); setState(null); };
  async function enable() {
    setBusy(true);
    try {
      await enablePush(api, toast, me.id);
      setState(null);
    } catch (e) {
      if (api.push.permission() === 'denied') setState('denied');
      else toast(e.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <section class="card push-offer">
      <h2><${Icon} name="bell" /> Upozornění na nové závady</h2>
      ${state === 'offer' && html`
        <p>Když někdo zapíše novou závadu, přijde vám upozornění i při zavřené aplikaci.</p>
        <div class="row">
          <button class="btn btn-primary" disabled=${busy} onClick=${enable}>${busy ? 'Zapínám…' : 'Zapnout'}</button>
          <button class="btn" onClick=${hide}>Teď ne</button>
        </div>
        <p class="hint">Telefon se pak zeptá – klepněte na <b>Povolit</b>.</p>`}
      ${state === 'denied' && html`
        <p>Upozornění jsou v telefonu zakázaná. Povolíte je v nastavení telefonu:</p>
        <p><b>${isIos()
          ? 'Nastavení → Oznámení → Závady vozů → Povolit oznámení'
          : 'Nastavení → Aplikace → Závady vozů (případně Chrome) → Oznámení'}</b></p>
        <button class="btn" onClick=${hide}>Rozumím</button>`}
    </section>`;
}

// ───── Fotoaparát: povolení předem (jen Android) ─────
// Vyfotit/Natočit otevírají fotoaparát telefonu a ten potřebuje povolení pro prohlížeč. Když je zakázané
// (často v nastavení Androidu pro celý Chrome), klepnutí tiše nic neudělá – Galerie přitom funguje.
// Proto si aplikace o fotoaparát řekne předem (karta na úvodní obrazovce) a zákaz ukáže i ve formuláři.

const CAMERA_DENIED = 'zavady-camera-denied'; // zkouška fotoaparátu skončila zákazem (prohlížeč to nemusí hlásit)
const CAMERA_OK = 'zavady-camera-ok'; // zkouška prošla (pro prohlížeče, které stav povolení neprozradí)
const CAMERA_OFFER_HIDDEN = 'zavady-camera-offer-hidden';

const isSamsungBrowser = () => /SamsungBrowser/.test(navigator.userAgent);
const browserName = () => (isSamsungBrowser() ? 'Samsung Internet' : 'Chrome');

/** Stav fotoaparátu: 'granted' | 'prompt' | 'denied', nebo null (nejde o Android nebo to nejde zjistit). */
export async function cameraPermission() {
  if (!isAndroid() || !navigator.mediaDevices?.getUserMedia) return null;
  let state = null;
  try { state = (await navigator.permissions.query({ name: 'camera' })).state; } catch { /* prohlížeč neumí */ }
  if (state === 'denied' || flag(CAMERA_DENIED)) return 'denied';
  if (state === 'granted' || flag(CAMERA_OK)) return 'granted';
  return 'prompt';
}

/** Krátce zapne fotoaparát (telefon se zeptá na povolení) a hned ho vypne. Vrací 'granted' | 'denied' | 'error'. */
export async function requestCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      setFlag(CAMERA_DENIED, true);
      setFlag(CAMERA_OK, false);
      return 'denied';
    }
    // NotReadableError = fotoaparát právě používá jiná aplikace, povolení je ale v pořádku
    if (e.name !== 'NotReadableError' && e.name !== 'AbortError') return 'error';
  }
  setFlag(CAMERA_DENIED, false);
  setFlag(CAMERA_OK, true);
  return 'granted';
}

/** Hlídá stav fotoaparátu, po návratu z nastavení telefonu ho zjistí znovu. */
export function useCameraPermission() {
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    const check = () => cameraPermission().then((s) => alive && setState(s), () => {});
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return [state, setState];
}

/** Postup, jak fotoaparát povolit (Android, podle prohlížeče). */
export function CameraSteps() {
  const b = browserName();
  return html`
    <ol class="camera-steps">
      <li><b>Nastavení telefonu → Aplikace → ${b} → Oprávnění → Fotoaparát → Povolit</b>.</li>
      ${isSamsungBrowser()
        ? html`<li>Když to nepomůže: v Samsung Internet <b>≡ → Nastavení → Stránky a stahování → Oprávnění webu</b> a povolit fotoaparát.</li>`
        : html`<li>Když to nepomůže: v Chromu <b>⋮ → Nastavení → Nastavení webu → Fotoaparát</b> a povolit tuto stránku.</li>`}
      <li>Na Samsungu ještě zkontrolujte, že v horní liště není vypnutý <b>Přístup k fotoaparátu</b>.</li>
    </ol>`;
}

/** Karta na úvodní obrazovce: povolit fotoaparát předem, ať Vyfotit a Natočit u vozu fungují napoprvé. */
export function CameraOffer() {
  const { toast } = useApp();
  const [state, setState] = useCameraPermission();
  const [hidden, setHidden] = useState(() => flag(CAMERA_OFFER_HIDDEN));
  const [busy, setBusy] = useState(false);

  if (hidden || (state !== 'prompt' && state !== 'denied')) return null;
  const hide = () => { setFlag(CAMERA_OFFER_HIDDEN, true); setHidden(true); };
  async function allow() {
    setBusy(true);
    try {
      const r = await requestCamera();
      setState(r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : null);
      if (r === 'granted') toast('Fotoaparát povolen – Vyfotit a Natočit budou fungovat.');
      else if (r === 'error') toast('Fotoaparát se nepodařilo spustit. Fotky půjde přidat z galerie.', { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <section class="card camera-offer">
      <h2><${Icon} name="camera" /> Fotoaparát pro fotky závad</h2>
      ${state === 'prompt' && html`
        <p>Povolte aplikaci fotoaparát už teď, ať u vozu tlačítka <b>Vyfotit</b> a <b>Natočit</b> fungují napoprvé.</p>
        <div class="row">
          <button class="btn btn-primary" disabled=${busy} onClick=${allow}>${busy ? 'Ověřuji…' : 'Povolit'}</button>
          <button class="btn" onClick=${hide}>Teď ne</button>
        </div>
        <p class="hint">Telefon se zeptá – klepněte na <b>Povolit</b> (případně <b>Při používání aplikace</b>).</p>`}
      ${state === 'denied' && html`
        <p>Fotoaparát je pro aplikaci zakázaný, takže nepůjde <b>Vyfotit</b> ani <b>Natočit</b> (z galerie ano). Povolíte ho takto:</p>
        <${CameraSteps} />
        <div class="row">
          <button class="btn btn-primary" disabled=${busy} onClick=${allow}>${busy ? 'Ověřuji…' : 'Zkontrolovat znovu'}</button>
          <button class="btn" onClick=${hide}>Rozumím</button>
        </div>`}
    </section>`;
}

// ───── Aplikace na plochu: karta na přihlášení, při čekání na schválení a na úvodní obrazovce ─────

// Android; tablet (a telefon s „Verzí pro počítač“) se hlásí jako počítač s Linuxem – pozná se podle
// dotykového displeje (počítače s Linuxem a dotykem jsou vzácné, Chromebook má v userAgent CrOS)
export const isAndroid = () => /Android/.test(navigator.userAgent) || navigator.userAgentData?.platform === 'Android'
  || (/Linux/.test(navigator.userAgent) && !/CrOS/.test(navigator.userAgent) && navigator.maxTouchPoints > 0);
// Prohlížeč uvnitř jiné aplikace (WhatsApp, Messenger, Instagram…) – odtud instalace nejde
const isInApp = () => /; wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\//.test(navigator.userAgent);
// Chrome (ne Samsung Internet, Edge, Firefox…) podle značky prohlížeče, starší verze podle userAgent
function isChrome() {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  if (brands.length) return brands.includes('Google Chrome');
  return /Chrome\/\d/.test(navigator.userAgent)
    && !/SamsungBrowser|EdgA|OPR\/|YaBrowser|MiuiBrowser|HuaweiBrowser|UCBrowser|Firefox/.test(navigator.userAgent);
}
// Odkaz, který aplikaci otevře v Chrome; když v telefonu Chrome není, nabídne ho Google Play
const chromeLink = () => `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;`
  + `package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=com.android.chrome')};end`;

// „Teď ne“ platí pro toto zařízení (instaluje se do zařízení, ne k účtu); po týdnu se karta nabídne znovu
const INSTALL_HIDDEN = 'zavady-install-offer-hidden';
const INSTALL_AGAIN_AFTER = 7 * 864e5;
const installHiddenAt = () => { try { return Number(localStorage.getItem(INSTALL_HIDDEN)) || 0; } catch { return 0; } };

/**
 * Nabídka přidat aplikaci na plochu (jen telefon a tablet, ne v nainstalované aplikaci):
 * Chrome → tlačítko Instalovat (systémové okno, stačí potvrdit); Android mimo Chrome → Otevřít v Chrome;
 * iPhone → postup Sdílet → Přidat na plochu (sama se nainstalovat nedá, jen tak tam chodí upozornění).
 */
export function InstallOffer() {
  const { installPrompt, install, installed } = useApp();
  const [hiddenAt, setHiddenAt] = useState(installHiddenAt);
  const [busy, setBusy] = useState(false);

  if (installed || isStandalone() || Date.now() - hiddenAt < INSTALL_AGAIN_AFTER) return null;
  let state = null; // 'prompt' | 'android-other' | 'ios' | 'ios-in-app'
  if (isIos()) state = isInApp() ? 'ios-in-app' : 'ios';
  else if (isAndroid()) state = installPrompt ? 'prompt' : isInApp() || !isChrome() ? 'android-other' : null;
  if (!state) return null; // Chrome bez výzvy k instalaci = aplikace už na ploše je (nebo instalace nejde)

  const hide = () => {
    try { localStorage.setItem(INSTALL_HIDDEN, String(Date.now())); } catch { /* nevadí */ }
    setHiddenAt(Date.now());
  };
  async function doInstall() {
    setBusy(true);
    try { await install(); } finally { setBusy(false); }
  }

  return html`
    <section class="card install-offer">
      <h2><${Icon} name="download" /> Aplikace na plochu</h2>
      ${state === 'prompt' && html`
        <p>Přidejte si aplikaci na plochu – bude mít vlastní ikonu, otevře se rychleji a budou chodit upozornění na nové závady.</p>
        <div class="row">
          <button class="btn btn-primary" disabled=${busy} onClick=${doInstall}>Instalovat</button>
          <button class="btn" onClick=${hide}>Teď ne</button>
        </div>
        <p class="hint">Telefon se zeptá – klepněte znovu na <b>Instalovat</b>.</p>`}
      ${state === 'android-other' && html`
        <p>${isInApp()
          ? 'Aplikaci máte otevřenou uvnitř jiné aplikace (WhatsApp, Messenger…). Na plochu ji přidáte z Chromu.'
          : 'Na plochu se aplikace přidává z prohlížeče Chrome.'}</p>
        <div class="row">
          <a class="btn btn-primary" href=${chromeLink()}>Otevřít v Chrome</a>
          <button class="btn" onClick=${hide}>Teď ne</button>
        </div>`}
      ${state === 'ios' && html`
        <p>Na iPhonu ji přidáte ručně: dole klepněte na <b>Sdílet</b> <${Icon} name="ios-share" size=${18} class="inline-icon" />
          a pak na <b>Přidat na plochu</b>. Jen tak vám budou chodit upozornění na nové závady.</p>
        <div class="row">
          <a class="btn btn-primary" href="navod.html">Návod s obrázky</a>
          <button class="btn" onClick=${hide}>Teď ne</button>
        </div>`}
      ${state === 'ios-in-app' && html`
        <p>Aplikaci máte otevřenou uvnitř jiné aplikace (WhatsApp, Messenger…). Otevřete ji v <b>Safari</b>
          (nabídka <b>⋯</b> → <b>Otevřít v Safari</b>) a tam ji přidejte na plochu.</p>
        <button class="btn" onClick=${hide}>Teď ne</button>`}
    </section>`;
}

// ───── Zápis bez signálu: banner s frontou závad čekajících na odeslání ─────

export function useOutbox() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const load = () => outbox.list().then(setItems, () => setItems([]));
    load();
    return outbox.subscribe(load);
  }, []);
  return items;
}

export function OutboxBanner() {
  const { api, toast, refresh } = useApp();
  const items = useOutbox();
  const [busy, setBusy] = useState(false);
  if (!items.length) return null;
  const failed = items.filter((i) => i.error);

  async function sendNow() {
    setBusy(true);
    try {
      const n = await syncOutbox(api);
      if (n) { toast(`Odesláno: ${plural(n, 'závada', 'závady', 'závad')}.`); refresh(); }
      else if (!navigator.onLine) toast('Pořád bez připojení – odešle se samo, až bude signál.');
    } finally {
      setBusy(false);
    }
  }
  async function discard(item) {
    if (confirm(`Zahodit neodeslanou závadu „${item.description.slice(0, 60)}“?`)) await outbox.remove(item.id);
  }

  return html`
    <section class="outbox">
      <div class="outbox-head">
        <${Icon} name="cloud" />
        <b>Čeká na odeslání: ${plural(items.length, 'závada', 'závady', 'závad')}</b>
        <span class="spacer"></span>
        <button class="btn btn-primary" disabled=${busy} onClick=${sendNow}>${busy ? 'Odesílám…' : 'Odeslat teď'}</button>
      </div>
      <div class="small">Zapsáno bez signálu. Odešle se samo, jakmile bude připojení.</div>
      ${failed.map((i) => html`
        <div key=${i.id} class="outbox-error small">
          <b>Nepodařilo se odeslat:</b> ${i.description.slice(0, 80)} – ${i.error}
          <button class="link-btn" onClick=${() => discard(i)}>Zahodit</button>
        </div>`)}
    </section>`;
}
