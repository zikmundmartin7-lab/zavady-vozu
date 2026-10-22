// Sdílené komponenty a pomocné funkce pro obrazovky.

import { html, createContext, useContext, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { can, digitsOnly, foundAtOf, formatDateTime, plural, splitNumber } from './model.js';
import { matchRanges } from './codes.js';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export const go = (hash) => { location.hash = hash; };
export const replace = (hash) => { location.replace(hash); };

// Poslední známá data (např. skupiny s počty závad) – zobrazí se hned při spuštění, pak se obnoví.
// Při odhlášení se mažou (clearLocalCache).
const CACHE_PREFIX = 'zavady-cache:';
const memoryCache = new Map();
function readCache(key) {
  if (memoryCache.has(key)) return memoryCache.get(key);
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key)) ?? undefined; } catch { return undefined; }
}
function writeCache(key, data) {
  memoryCache.set(key, data);
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data)); } catch { /* plná paměť – nevadí */ }
}
export function clearLocalCache() {
  memoryCache.clear();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* nevadí */ }
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
};
export const Icon = ({ name, size = 20, class: cls = '' }) => html`
  <svg class="icon ${cls}" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONS[name]} /></svg>`;

// ───── Drobné prvky ─────

export const Badge = ({ n, class: cls = '' }) =>
  n > 0 ? html`<span class="badge ${cls}" aria-label=${plural(n, 'otevřená závada', 'otevřené závady', 'otevřených závad')}>${n > 99 ? '99+' : n}</span>` : null;

export const WagonNumber = ({ number, class: cls = '' }) => {
  const [head, tail] = splitNumber(number);
  return html`<span class="wagon-number ${cls}">${head}<b>${tail}</b></span>`;
};

export function OpenCount({ w }) {
  if (!w.open_count) return html`<span class="count count-ok"><${Icon} name="check" size=${14} /> bez závad</span>`;
  return html`<span class="count count-open">${plural(w.open_count, 'závada', 'závady', 'závad')}</span>`;
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
export function BottomNav({ active }) {
  const { resetTab } = useApp();
  const tab = (key, href, icon, label) => html`
    <a href=${href} class=${active === key ? 'active' : ''}
      onClick=${(e) => { if ((location.hash || '#/') === href) { e.preventDefault(); resetTab(); } }}>
      <${Icon} name=${icon} size=${22} /><span>${label}</span></a>`;
  return html`
    <nav class="bottom-nav" aria-label="Hlavní nabídka">
      ${tab('vozy', '#/', 'wagon', 'Vozy')}
      ${tab('kody', '#/kody', 'codes', 'Kódy závad')}
      ${tab('predpisy', '#/predpisy', 'book', 'Předpisy')}
    </nav>`;
}

export const Loading = () => html`<div class="loading"><span class="spinner"></span> Načítám…</div>`;
export const ErrorBox = ({ error }) => error ? html`<div class="error-box"><${Icon} name="alert" /> ${error.message ?? String(error)}</div>` : null;
export const Empty = ({ children }) => html`<div class="empty">${children}</div>`;

export function TopBar({ title, back, children, sub }) {
  return html`
    <header class="topbar">
      ${back && html`<a class="icon-btn" href=${back} aria-label="Zpět"><${Icon} name="back" size=${24} /></a>`}
      <div class="topbar-title">
        <h1>${title}</h1>
        ${sub && html`<div class="topbar-sub">${sub}</div>`}
      </div>
      <div class="topbar-right">${children}</div>
    </header>`;
}

export const Fab = ({ href, label = 'Nová závada' }) => html`
  <a class="fab" href=${href}><${Icon} name="plus" size=${22} /> ${label}</a>`;

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

export function DefectCard({ d, showComments = true }) {
  const { api, me, refresh, toast, openMedia } = useApp();
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
        ${resolved
          ? html`<span class="chip chip-ok"><${Icon} name="check" size=${14} /> Opraveno</span>`
          : html`<span class="chip chip-open">Neopravená</span>`}
        ${d.defect_code && html`<span class="chip chip-code" title="Kód závady dle přílohy 9 VSP">kód ${d.defect_code}</span>`}
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
            <button key=${a.id} class="media-thumb" onClick=${() => openMedia(d.attachments, i)}
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
            ${d.comment_count ? plural(d.comment_count, 'komentář', 'komentáře', 'komentářů') : 'Komentovat'}</a>`}
        <span class="spacer"></span>
        ${resolved && can.resolve(me, d) && html`
          <button class="btn btn-ghost" disabled=${busy} onClick=${reopen} title="Vrátit mezi neopravené"><${Icon} name="undo" size=${18} /></button>`}
        ${can.edit(me, d) && html`
          <a class="btn btn-ghost" href="#/upravit/${d.id}" title="Upravit"><${Icon} name="edit" size=${18} /></a>
          <button class="btn btn-ghost danger" disabled=${busy} onClick=${remove} title="Smazat"><${Icon} name="trash" size=${18} /></button>`}
      </div>
      ${!resolved && !resolving && can.resolve(me, d) && html`
        <button class="btn btn-ok block resolve-btn" disabled=${busy} onClick=${() => setResolving(true)}>
          <${Icon} name="check" size=${18} /> Označit jako opravené</button>`}
    </article>`;
}

// ───── Prohlížeč fotek a videí ─────

export function Lightbox({ items, index, onClose }) {
  const [i, setI] = useState(index);
  const a = items[i];
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
