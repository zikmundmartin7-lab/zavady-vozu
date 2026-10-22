// Formulář nové závady / úpravy závady (číslo vozu, kód závady, popis, datum zjištění, fotky a videa).

import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { CODE_RE } from '../codes.js';
import {
  MAX_VIDEO_MB, can, checkDigit, checkFoundAt, digitsOnly, foundAtOf, formatNumber, isCompleteNumber,
  isValidCheckDigit, toLocalInput,
} from '../model.js';
import { Empty, ErrorBox, Icon, Loading, TopBar, WagonNumber, replace, useApp, useLoad } from '../ui.js';
import { CodePicker } from './codes.js';

function FilePicker({ onFiles }) {
  const pick = (e) => {
    onFiles([...e.currentTarget.files]);
    e.currentTarget.value = '';
  };
  return html`
    <div class="file-buttons">
      <label class="btn"><${Icon} name="camera" /> Vyfotit
        <input type="file" accept="image/*" capture="environment" hidden onChange=${pick} /></label>
      <label class="btn"><${Icon} name="video" /> Natočit
        <input type="file" accept="video/*" capture="environment" hidden onChange=${pick} /></label>
      <label class="btn"><${Icon} name="image" /> Z galerie
        <input type="file" accept="image/*,video/*" multiple hidden onChange=${pick} /></label>
    </div>`;
}

function Preview({ kind, url, onRemove }) {
  return html`
    <div class="media-thumb">
      ${kind === 'video' ? html`<video src=${url} preload="metadata" muted playsinline></video>` : html`<img src=${url} alt="" />`}
      ${kind === 'video' && html`<span class="play"><${Icon} name="play" size=${22} /></span>`}
      <button type="button" class="remove" onClick=${onRemove} aria-label="Odebrat"><${Icon} name="x" size=${16} /></button>
    </div>`;
}

export function DefectFormView({ editId, params }) {
  const { api, me, toast } = useApp();
  const presetWagonId = params.get('vuz');
  const existingDefect = useLoad(() => (editId ? api.getDefect(editId) : Promise.resolve(null)), [editId]);
  const fixedWagonId = editId ? existingDefect.data?.wagon_id : presetWagonId;
  const fixedWagon = useLoad(() => (fixedWagonId ? api.getWagon(fixedWagonId) : Promise.resolve(null)), [fixedWagonId]);
  const groups = useLoad(() => api.listGroups(), []);

  const [number, setNumber] = useState(digitsOnly(params.get('cislo') ?? ''));
  const [found, setFound] = useState(undefined); // undefined = nehledáno, null = nový vůz
  const [groupId, setGroupId] = useState(Number(params.get('skupina')) || null);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [foundAt, setFoundAt] = useState(() => toLocalInput(new Date()));
  const [initialFoundAt, setInitialFoundAt] = useState(null); // při úpravě: původní hodnota
  const [files, setFiles] = useState([]);
  const [removeIds, setRemoveIds] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);

  // Při úpravě předvyplnit hodnoty
  useEffect(() => {
    const d = existingDefect.data;
    if (d) {
      setCode(d.defect_code ?? '');
      setDescription(d.description);
      setFoundAt(toLocalInput(foundAtOf(d)));
      setInitialFoundAt(toLocalInput(foundAtOf(d)));
    }
  }, [existingDefect.data?.id]);

  // Po zadání celého čísla zjistit, jestli vůz už existuje
  useEffect(() => {
    if (fixedWagonId || !isCompleteNumber(number)) { setFound(undefined); return; }
    let alive = true;
    api.findWagon(number).then((w) => alive && setFound(w), (e) => alive && setError(e));
    return () => { alive = false; };
  }, [number, fixedWagonId]);

  const previews = useMemo(() => files.map((f) => ({
    file: f, url: URL.createObjectURL(f), kind: f.type.startsWith('video/') ? 'video' : 'image',
  })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  function addFiles(list) {
    const ok = [];
    for (const f of list) {
      if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) {
        toast(`Soubor ${f.name} není fotka ani video.`, { kind: 'error' });
      } else if (f.type.startsWith('video/') && f.size > MAX_VIDEO_MB * 1024 * 1024) {
        toast(`Video je větší než ${MAX_VIDEO_MB} MB – zkraťte ho nebo natočte v nižším rozlišení.`, { kind: 'error' });
      } else {
        ok.push(f);
      }
    }
    setFiles((prev) => [...prev, ...ok]);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      let wagon = fixedWagon.data;
      if (!fixedWagonId) {
        if (!isCompleteNumber(number)) throw new Error('Zadejte celé číslo vozu (12 číslic).');
        if (!isValidCheckDigit(number)
          && !confirm(`Kontrolní číslice nesedí – pro toto číslo by měla být ${checkDigit(number)}. Přesto pokračovat?`)) return;
        if (found === undefined) throw new Error('Ověřuji číslo vozu, zkuste to za okamžik znovu.');
        if (!found && !groupId) throw new Error('Vyberte skupinu, do které nový vůz patří.');
      }
      if (code && !CODE_RE.test(code)) throw new Error('Kód závady má tvar např. 1.2 nebo 1.2.2.1 (až 4 úrovně).');
      if (!description.trim()) throw new Error('Popište závadu.');
      const foundProblem = checkFoundAt(foundAt, editId ? existingDefect.data.resolved_at : null);
      if (foundProblem) throw new Error(foundProblem);
      // Při úpravě se datum posílá, jen když ho někdo změnil (jinak by se ztratily sekundy a závada by byla „upravená“).
      const found_at = editId && foundAt === initialFoundAt ? undefined : new Date(foundAt).toISOString();

      if (editId) {
        setBusy('Ukládám…');
        await api.updateDefect(editId, { description, found_at, defect_code: code }, files, removeIds,
          (i, n) => setBusy(`Nahrávám přílohu ${i}/${n}…`));
        toast('Závada upravena.');
        replace(`#/vuz/${existingDefect.data.wagon_id}`);
        return;
      }
      setBusy('Ukládám…');
      if (!wagon) wagon = found ?? await api.createWagon(number, groupId);
      await api.createDefect({ wagon_id: wagon.id, description, found_at, defect_code: code }, files,
        (i, n) => setBusy(`Nahrávám přílohu ${i}/${n}…`));
      toast('Závada uložena. Ostatní uživatelé dostanou upozornění.');
      replace(`#/vuz/${wagon.id}`);
    } catch (err) {
      setError(err);
      setBusy('');
    }
  }

  if (editId && existingDefect.data === null) {
    return html`<${TopBar} back="#/" title="Upravit závadu" /><main class="page"><${Empty}>Závada nebyla nalezena.<//></main>`;
  }
  if (editId && existingDefect.data && !can.edit(me, existingDefect.data)) {
    return html`<${TopBar} back="#/vuz/${existingDefect.data.wagon_id}" title="Upravit závadu" />
      <main class="page"><${ErrorBox} error=${new Error('Závadu může upravit jen ten, kdo ji vložil, nebo správce.')} /></main>`;
  }
  if ((editId && !existingDefect.data) || (fixedWagonId && !fixedWagon.data)) {
    return html`<${TopBar} back="#/" title="Závada" /><main class="page"><${Loading} /></main>`;
  }

  const back = fixedWagonId ? `#/vuz/${fixedWagonId}` : groupId && params.get('skupina') ? `#/skupina/${groupId}` : '#/';
  const existingAtts = (existingDefect.data?.attachments ?? []).filter((a) => !removeIds.includes(a.id));
  const complete = isCompleteNumber(number);

  return html`
    <${TopBar} back=${back} title=${editId ? 'Upravit závadu' : 'Nová závada'} />
    <main class="page">
      <form class="form" onSubmit=${submit}>
        <section class="card">
          <h2 class="field-label">Vůz</h2>
          ${fixedWagon.data
            ? html`<div><${WagonNumber} number=${fixedWagon.data.number} class="big" />
                <div class="muted">Skupina: ${fixedWagon.data.group_name}</div></div>`
            : html`
              <input class="number-input" inputmode="numeric" autocomplete="off" placeholder="XX XX XXXX XXX-X"
                value=${formatNumber(number)} onInput=${(e) => setNumber(digitsOnly(e.currentTarget.value).slice(0, 12))} />
              <div class="hint">${number.length}/12 číslic</div>
              ${complete && !isValidCheckDigit(number) && html`
                <div class="warn"><${Icon} name="alert" size=${16} /> Kontrolní číslice nesedí – pro toto číslo by měla být ${checkDigit(number)}.</div>`}
              ${complete && found && html`
                <div class="ok-note"><${Icon} name="check" size=${16} /> Vůz už je v evidenci – skupina <b>${found.group_name}</b>.</div>`}
              ${complete && found === null && html`
                <div class="hint">Nový vůz – vyberte skupinu:</div>
                <div class="chips-select">
                  ${groups.data?.map((g) => html`
                    <button type="button" class="chip-btn ${groupId === g.id ? 'active' : ''}" onClick=${() => setGroupId(g.id)}>${g.name}</button>`)}
                </div>`}`}
        </section>

        <section class="card">
          <h2 class="field-label">Kód závady dle přílohy 9 VSP <span class="optional">nepovinné</span></h2>
          <${CodePicker} value=${code} onChange=${setCode} />
        </section>

        <section class="card">
          <h2 class="field-label">Popis závady</h2>
          <textarea rows="4" placeholder="Co je špatně, kde přesně na voze…" value=${description}
            onInput=${(e) => setDescription(e.currentTarget.value)}></textarea>
        </section>

        <section class="card">
          <h2 class="field-label">Datum a čas zjištění</h2>
          <div class="date-row">
            <input type="datetime-local" class="date-input" value=${foundAt} max=${toLocalInput(new Date())}
              onInput=${(e) => setFoundAt(e.currentTarget.value)} required />
            <button type="button" class="btn" onClick=${() => setFoundAt(toLocalInput(new Date()))}>Teď</button>
          </div>
          ${Date.now() - Date.parse(foundAt) > 15 * 60 * 1000 && html`
            <div class="hint">Závada se zapíše zpětně – na kartě bude vidět i skutečný čas zápisu.</div>`}
        </section>

        <section class="card">
          <h2 class="field-label">Fotky a videa</h2>
          <${FilePicker} onFiles=${addFiles} />
          ${(existingAtts.length > 0 || previews.length > 0) && html`
            <div class="media-grid">
              ${existingAtts.map((a) => html`<${Preview} key=${a.id} kind=${a.kind} url=${a.url}
                onRemove=${() => setRemoveIds([...removeIds, a.id])} />`)}
              ${previews.map((p, i) => html`<${Preview} key=${p.url} kind=${p.kind} url=${p.url}
                onRemove=${() => setFiles(files.filter((_, j) => j !== i))} />`)}
            </div>`}
          <div class="hint">Fotky se automaticky zmenší. Video max. ${MAX_VIDEO_MB} MB (cca 20–30 s z telefonu).</div>
        </section>

        <${ErrorBox} error=${error} />
        <button class="btn btn-primary block big-btn" type="submit" disabled=${!!busy}>
          ${busy || (editId ? 'Uložit změny' : 'Uložit závadu')}
        </button>
      </form>
    </main>`;
}
