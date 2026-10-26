// Kódy závad podle přílohy 9 VSP: záložka s hledáním v katalogu a pole pro kód ve formuláři závady.

import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import {
  IMAGE_NAME, catalogPathTo, catalogTree, codeOf, highlightTokens, imagesFor, searchCodes, typeCode,
} from '../codes.js';
import { can, plural } from '../model.js';
import {
  BottomNav, Empty, Highlight, Icon, Loading, TopBar, UserButton, useApp, useCatalog, useCodeImages,
} from '../ui.js';

const isCodeQuery = (q) => /^\d/.test(q.trim());

// Obrázky z katalogu u kódu; v klikací položce (výběr kódu) jen náhled, jinak se dají zvětšit
function CodeImages({ kod, images, interactive }) {
  const { openMedia } = useApp();
  const { list, from } = imagesFor(images, kod);
  if (!list.length) return null;
  return html`
    <div class="code-images">
      ${list.map((m, i) => (interactive
        ? html`<button type="button" key=${m.id} class="code-img-btn" onClick=${() => openMedia(list, i)}
            aria-label="Zvětšit obrázek"><img src=${m.url} alt="" loading="lazy" /></button>`
        : html`<img key=${m.id} src=${m.url} alt="" loading="lazy" />`))}
      ${from && html`<span class="code-img-from">obrázek ke kódu ${from}</span>`}
    </div>`;
}

// Jedna položka katalogu: kód, konstrukční část, závada / kritéria, obrázky, opatření a třída
export function CodeItem({ c, tokens = [], onPick, picked, images }) {
  const body = html`
    <div class="code-item-head">
      <span class="code-no">${c.kod}</span>
      <span class="code-path"><${Highlight} text=${c.cesta} tokens=${tokens} /></span>
    </div>
    ${c.kontext && html`<div class="code-context"><${Highlight} text=${c.kontext} tokens=${tokens} /></div>`}
    ${c.popis && html`<div class="code-text"><${Highlight} text=${c.popis} tokens=${tokens} /></div>`}
    ${c.poznamka && html`<div class="code-note">Pozn.: <${Highlight} text=${c.poznamka} tokens=${tokens} /></div>`}
    <${CodeImages} kod=${c.kod} images=${images} interactive=${!onPick} />
    ${(c.opatreni || c.trida) && html`
      <div class="code-meta">
        ${c.opatreni && html`<span>Opatření: <b>${c.opatreni}</b></span>`}
        ${c.trida && html`<span>Třída závady: <b>${c.trida}</b></span>`}
      </div>`}`;
  if (!onPick) return html`<article class="code-item">${body}</article>`;
  return html`<button type="button" class="code-item ${picked ? 'picked' : ''}" onClick=${() => onPick(c.kod)}>${body}</button>`;
}

// Popis pole je vlastní text místo placeholderu: placeholder má jen jeden řádek a v telefonu by se uřízl
function CodeTextSearch({ value, onInput, placeholder }) {
  return html`
    <label class="search-box">
      <${Icon} name="search" />
      <span class="search-field">
        <input type="search" autocomplete="off" enterkeyhint="search" aria-label=${placeholder}
          value=${value} onInput=${(e) => onInput(e.currentTarget.value)} />
        ${!value && html`<span class="search-placeholder" aria-hidden="true">${placeholder}</span>`}
      </span>
      ${value && html`<button type="button" class="icon-btn small" onClick=${(e) => { e.preventDefault(); onInput(''); }}
        aria-label="Vymazat"><${Icon} name="x" size=${18} /></button>`}
    </label>`;
}

// Nahrání obrázků katalogu (jen správce): soubory pojmenované kód_pořadí.png
function ImageUpload({ count }) {
  const { api, toast, refresh } = useApp();
  const [busy, setBusy] = useState('');

  async function pick(e) {
    const files = [...e.currentTarget.files];
    e.currentTarget.value = '';
    const ok = files.filter((f) => IMAGE_NAME.test(f.name));
    const skipped = files.length - ok.length;
    if (!ok.length) {
      toast('Vyberte obrázky pojmenované podle kódu, např. 1.3.3_1.png.', { kind: 'error' });
      return;
    }
    try {
      await api.uploadCodeImages(ok, (i, n) => setBusy(`Nahrávám ${i}/${n}…`));
      toast(`Nahráno obrázků: ${ok.length}${skipped ? ` (přeskočeno ${skipped} s jiným názvem)` : ''}.`);
      refresh();
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy('');
    }
  }

  return html`
    <section class="card upload-card">
      <h2><${Icon} name="upload" /> Obrázky katalogu</h2>
      <p class="muted">${count ? `Nahráno obrázků: ${count}.` : 'Zatím nejsou nahrané žádné obrázky.'}
        Vyberte najednou všechny soubory ze složky s obrázky katalogu (názvy jako 1.3.3_1.png).
        Stejně pojmenované obrázky se přepíšou.</p>
      <label class="btn btn-primary block">
        <${Icon} name="image" /> ${busy || 'Nahrát obrázky katalogu'}
        <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled=${!!busy} onChange=${pick} />
      </label>
    </section>`;
}

// ───── Záložka „Kódy závad“ ─────

// Jedna část katalogu (např. 1 Pojezd) jako samostatná stránka – má šipku zpět,
// protože na iPhonu v aplikaci z plochy chybí tlačítko Zpět prohlížeče.
function CodeSectionView({ section }) {
  const catalog = useCatalog();
  const images = useCodeImages();
  const head = catalog?.find((c) => c.kod === section);
  const list = (catalog ?? []).filter((c) => c.kod === section || c.kod.startsWith(`${section}.`));
  return html`
    <${TopBar} back="#/kody" title=${head ? `${head.kod} ${head.cesta}` : `Část ${section}`}
      sub=${catalog ? `${list.length} kódů` : ''}><${UserButton} /><//>
    <main class="page with-nav">
      ${!catalog && html`<${Loading} />`}
      ${catalog && list.length === 0 && html`<${Empty}>Tato část katalogu neexistuje.<//>`}
      <div class="code-list">
        ${list.map((c) => html`<${CodeItem} key=${c.kod} c=${c} images=${images} />`)}
      </div>
      ${catalog && list.length > 0 && html`<a class="btn btn-ghost block toggle" href="#/kody"><${Icon} name="back" /> Zpět na kódy závad</a>`}
    </main>
    <${BottomNav} active="kody" />`;
}

export function CodesView({ params }) {
  const section = params?.get('sekce');
  if (section) return html`<${CodeSectionView} section=${section} />`;
  return html`<${CodesSearchView} />`;
}

function CodesSearchView() {
  const { api, me } = useApp();
  const catalog = useCatalog();
  const images = useCodeImages();
  const imageCount = images ? [...images.values()].reduce((n, l) => n + l.length, 0) : 0;
  const [q, setQ] = useState('');
  const results = useMemo(() => searchCodes(catalog, q, isCodeQuery(q) ? 400 : 150), [catalog, q]);
  const tokens = isCodeQuery(q) ? [] : highlightTokens(q);
  const sections = (catalog ?? []).filter((c) => !c.kod.includes('.'));

  return html`
    <${TopBar} title="Kódy závad" sub="Příloha 9 VSP – katalog závad a poškození"><${UserButton} /><//>
    <main class="page with-nav">
      ${api.mode === 'demo' && html`
        <div class="warn"><${Icon} name="alert" size=${16} /> Ukázkový režim: jen pár vymyšlených kódů. V ostré verzi je zde celý katalog přílohy 9 VSP.</div>`}
      <${CodeTextSearch} value=${q} onInput=${setQ} placeholder="Hledat kód, konstrukční část nebo závadu" />
      <p class="hint">Hledá se zároveň v konstrukční části i v popisu závady. Můžete zadat i číslo kódu, např. 1.2.</p>
      ${!catalog && html`<${Loading} />`}
      ${catalog && catalog.length === 0 && html`<${Empty}>Katalog kódů zatím není nahraný.<//>`}
      ${catalog && !q.trim() && sections.length > 0 && html`
        <h2 class="section-title">Části katalogu</h2>
        <ul class="list">
          ${sections.map((s) => html`
            <li key=${s.kod}>
              <a class="list-row list-btn" href="#/kody?sekce=${s.kod}">
                <span class="code-no">${s.kod}</span><span class="spacer">${s.cesta}</span>
                <${Icon} name="right" size=${18} class="muted" />
              </a>
            </li>`)}
        </ul>`}
      ${q.trim() && catalog && html`
        <div class="hint">${results.length ? `Nalezeno: ${results.length}${results.length >= 150 && !isCodeQuery(q) ? '+ (upřesněte hledání)' : ''}` : ''}</div>
        ${results.length === 0 && html`<${Empty}>Nic nenalezeno. Zkuste jiné slovo nebo jen jeho začátek.<//>`}
        <div class="code-list">
          ${results.map((r) => html`<${CodeItem} key=${r.c.kod} c=${r.c} tokens=${tokens} images=${images} />`)}
        </div>`}
      ${!q.trim() && can.admin(me) && api.mode !== 'demo' && html`<${ImageUpload} count=${imageCount} />`}
    </main>
    <${BottomNav} active="kody" />`;
}

// ───── Výběr kódu procházením katalogu (okno ve formuláři závady) ─────

// Konstrukční část bez úvodu, který je už vidět u nadřazeného kódu („Pojezd › Kolo“ → „Kolo“)
function relativePath(c, parent) {
  const base = parent?.cesta;
  if (!base) return c.cesta;
  if (c.cesta === base) return '';
  return c.cesta.startsWith(`${base} › `) ? c.cesta.slice(base.length + 3) : c.cesta;
}

// Kód s podřízenými kódy: klepnutí otevře další úroveň
function CatalogNode({ c, parent, count, picked, onOpen }) {
  const path = relativePath(c, parent);
  const text = [c.kontext, c.popis].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  return html`
    <button type="button" class="catalog-node ${picked ? 'picked' : ''}" onClick=${() => onOpen(c.kod)}>
      <span class="catalog-node-main">
        <span class="code-item-head">
          <span class="code-no">${c.kod}</span>
          ${path && html`<span class="code-path">${path}</span>`}
        </span>
        ${text && html`<span class="catalog-node-text">${text}</span>`}
      </span>
      <span class="catalog-node-count">${plural(count, 'kód', 'kódy', 'kódů')}<${Icon} name="right" size=${18} /></span>
    </button>`;
}

/**
 * Katalog po úrovních: části katalogu → podrobnější kódy → konkrétní závada; klepnutím na závadu se vybere.
 * Každý krok je záznam v historii se stejnou adresou, takže tlačítko Zpět v telefonu vrací o krok
 * a nakonec zavře katalog – formulář s rozepsanou závadou zůstane.
 */
function CatalogDialog({ catalog, images, value, onPick, onClose }) {
  const [path, setPath] = useState(() => (catalog?.length ? catalogPathTo(catalog, value) : []));
  const bodyRef = useRef();

  useEffect(() => {
    history.pushState({ katalog: path, krok: 0 }, '');
    const onPop = (e) => (e.state?.katalog ? setPath(e.state.katalog) : onClose());
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('popstate', onPop);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('popstate', onPop); removeEventListener('keydown', onKey); };
  }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [path.join('|')]);

  function open(next) {
    history.pushState({ katalog: next, krok: (history.state?.krok ?? 0) + 1 }, '');
    setPath(next);
  }
  // Zavřít a vrátit historii tam, kde byla před otevřením katalogu
  function close() {
    const krok = history.state?.krok;
    onClose();
    if (krok !== undefined) history.go(-(krok + 1));
  }
  function pick(kod) {
    onPick(kod);
    close();
  }

  const tree = catalog?.length ? catalogTree(catalog) : null;
  const current = path.at(-1) ?? '';
  const node = current ? catalog.find((c) => c.kod === current) : null;
  const items = tree?.children.get(current) ?? [];
  const countOf = (kod) => catalog.reduce((n, c) => n + (c.kod.startsWith(`${kod}.`) ? 1 : 0), 0);
  const inside = (kod) => value === kod || value.startsWith(`${kod}.`);

  return html`
    <div class="dialog-backdrop" onClick=${(e) => e.target === e.currentTarget && close()}>
      <div class="dialog catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
        <div class="dialog-head">
          ${path.length > 0 && html`
            <button type="button" class="icon-btn" onClick=${() => open(path.slice(0, -1))} aria-label="O úroveň výš">
              <${Icon} name="back" /></button>`}
          <h2 id="catalog-title">Katalog závad</h2>
          <button type="button" class="icon-btn" onClick=${close} aria-label="Zavřít"><${Icon} name="x" /></button>
        </div>
        ${path.length > 0 && html`
          <nav class="catalog-crumbs" aria-label="Úrovně katalogu">
            <button type="button" class="link-btn" onClick=${() => open([])}>Všechny části</button>
            ${path.map((k, i) => html`
              <span class="muted">›</span>
              <button type="button" class="link-btn" disabled=${i === path.length - 1}
                onClick=${() => open(path.slice(0, i + 1))}>${k}</button>`)}
          </nav>`}
        <div class="catalog-body" ref=${bodyRef}>
          ${!catalog && html`<${Loading} />`}
          ${catalog && !catalog.length && html`<${Empty}>Katalog kódů zatím není nahraný.<//>`}
          ${tree && !node && html`<p class="hint">Vyberte část vozu a pak konkrétní závadu. Klepnutím na závadu ji vyberete.</p>`}
          ${node && (node.popis || node.opatreni
            ? html`<div class="code-list compact">
                <${CodeItem} c=${node} images=${images} picked=${value === node.kod} onPick=${pick} />
              </div>`
            : html`<h3 class="catalog-title"><span class="code-no">${node.kod}</span> ${node.cesta}</h3>`)}
          ${node && items.length > 0 && html`<p class="hint">Podrobnější kódy:</p>`}
          <div class="code-list compact">
            ${items.map((c) => (tree.children.has(c.kod)
              ? html`<${CatalogNode} key=${c.kod} c=${c} parent=${node} count=${countOf(c.kod)}
                  picked=${inside(c.kod)} onOpen=${(kod) => open([...path, kod])} />`
              : html`<${CodeItem} key=${c.kod} c=${c} images=${images} picked=${value === c.kod} onPick=${pick} />`))}
          </div>
        </div>
      </div>
    </div>`;
}

// ───── Pole pro kód ve formuláři závady ─────

/**
 * Kód závady: 4 políčka (úrovně kódu, každá 1–2 číslice), tečky se doplňují samy.
 * Pod polem nabídka kódů, které odpovídají rozepsanému kódu, hledání podle textu a výběr procházením katalogu.
 */
export function CodePicker({ value, onChange }) {
  const catalog = useCatalog();
  const images = useCodeImages();
  const [typed, setTyped] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const inputRef = useRef();

  // Hodnota nastavená zvenku (předvyplnění při úpravě závady)
  useEffect(() => {
    if (codeOf(typed) !== (value ?? '')) setTyped(value ?? '');
  }, [value]);

  const code = codeOf(typed);
  const segs = typed ? typed.split('.') : [''];
  const active = focused ? Math.min(segs.length - 1, 3) : -1;
  const exact = catalog?.find((c) => c.kod === code);
  const suggestions = useMemo(
    () => (code && catalog ? searchCodes(catalog, typed, 8).filter((r) => r.c.kod !== code) : []),
    [catalog, typed],
  );
  const textResults = useMemo(() => (text.trim() ? searchCodes(catalog, text, 30) : []), [catalog, text]);
  const tokens = isCodeQuery(text) ? [] : highlightTokens(text);

  function set(next) {
    setTyped(next);
    onChange(codeOf(next));
  }
  function onInput(e) {
    const next = typeCode(typed, e.currentTarget.value, catalog);
    e.currentTarget.value = next;
    set(next);
  }
  function pick(kod) {
    set(kod);
    setText('');
  }

  return html`
    <div class="code-picker">
      <label class="search-box code-search code-entry">
        <span class="code" aria-hidden="true">
          ${[0, 1, 2, 3].map((i) => html`
            ${i > 0 && html`<span class="code-dot">.</span>`}
            <span class="code-box ${i === active ? 'active' : ''}">${segs[i] ?? ''}</span>`)}
        </span>
        <span class="code-hint">${typed ? '' : 'např. 1.2.2.1'}</span>
        <input ref=${inputRef} class="code-input" type="text" inputmode="decimal" autocomplete="off"
          aria-label="Kód závady podle přílohy 9 VSP" value=${typed} onInput=${onInput}
          onFocus=${() => setFocused(true)} onBlur=${() => setFocused(false)} />
        ${typed && html`<button type="button" class="icon-btn small clear" aria-label="Smazat kód"
          onClick=${(e) => { e.preventDefault(); set(''); inputRef.current?.focus(); }}><${Icon} name="x" size=${18} /></button>`}
      </label>

      ${exact && html`<div class="code-picked"><${CodeItem} c=${exact} images=${images} /></div>`}
      ${code && !exact && catalog?.length > 0 && suggestions.length === 0 && html`
        <div class="warn"><${Icon} name="alert" size=${16} /> Kód ${code} v katalogu přílohy 9 VSP není.</div>`}
      ${suggestions.length > 0 && html`
        <div class="hint">${exact ? 'Podrobnější kódy:' : 'Pokračujte v psaní, nebo vyberte:'}</div>
        <div class="code-list compact">
          ${suggestions.map((r) => html`<${CodeItem} key=${r.c.kod} c=${r.c} onPick=${pick} images=${images} />`)}
        </div>`}

      <div class="code-text-search">
        <${CodeTextSearch} value=${text} onInput=${setText} placeholder="Najít kód podle konstrukční části nebo závady" />
      </div>
      <button type="button" class="btn block catalog-open" onClick=${() => setBrowsing(true)}>
        <${Icon} name="codes" /> Vybrat z katalogu závad
      </button>
      ${text.trim() && catalog && html`
        ${textResults.length === 0 && html`<${Empty}>Nic nenalezeno.<//>`}
        <div class="code-list compact">
          ${textResults.map((r) => html`<${CodeItem} key=${r.c.kod} c=${r.c} tokens=${tokens} onPick=${pick} picked=${r.c.kod === code} images=${images} />`)}
        </div>`}
      ${browsing && html`<${CatalogDialog} catalog=${catalog} images=${images} value=${code} onPick=${pick}
        onClose=${() => setBrowsing(false)} />`}
    </div>`;
}
