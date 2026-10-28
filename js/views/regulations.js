// Záložka „Předpisy“: PDF předpisů v soukromém úložišti. Číst je mohou schválení uživatelé,
// nahrávat a mazat jen administrátor.

import { html, useState } from '../../vendor/preact-htm.js';
import { can, formatDateTime } from '../model.js';
import {
  BottomNav, Empty, ErrorBox, Icon, Loading, TopBar, UserButton, useApp, useLoad,
} from '../ui.js';

const MAX_MB = 50;
const sizeMB = (bytes) => (bytes ? `${(bytes / 1024 / 1024).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} MB` : '');

function UploadForm({ onDone }) {
  const { api, toast } = useApp();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function pickFile(e) {
    const f = e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { setError(new Error('Vyberte soubor PDF.')); return; }
    if (f.size > MAX_MB * 1024 * 1024) { setError(new Error(`Soubor je větší než ${MAX_MB} MB.`)); return; }
    setError(null);
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim());
  }

  async function submit(e) {
    e.preventDefault();
    if (!file) { setError(new Error('Vyberte soubor PDF.')); return; }
    if (!title.trim()) { setError(new Error('Vyplňte název předpisu.')); return; }
    setBusy(true);
    try {
      await api.addRegulation(title, file);
      toast('Předpis nahrán.');
      setTitle('');
      setFile(null);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card form" onSubmit=${submit}>
      <h2><${Icon} name="upload" /> Přidat předpis</h2>
      <label class="btn block"><${Icon} name="file" /> ${file ? file.name : 'Vybrat soubor PDF'}
        <input type="file" accept="application/pdf,.pdf" hidden onChange=${pickFile} /></label>
      <label class="field">Název (jak se zobrazí v seznamu)
        <input value=${title} placeholder="např. VSP – příloha 9" onInput=${(e) => setTitle(e.currentTarget.value)} /></label>
      <${ErrorBox} error=${error} />
      <button class="btn btn-primary block" disabled=${busy || !file}>${busy ? 'Nahrávám…' : 'Nahrát předpis'}</button>
      <p class="hint">Předpisy vidí jen přihlášení a schválení uživatelé aplikace. Max. ${MAX_MB} MB.</p>
    </form>`;
}

export function RegulationsView() {
  const { api, me, toast, refresh } = useApp();
  const regs = useLoad(() => api.listRegulations(), []);

  async function remove(r) {
    if (!confirm(`Smazat předpis „${r.title}“?`)) return;
    try {
      await api.deleteRegulation(r);
      toast('Předpis smazán.');
      refresh();
    } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  return html`
    <${TopBar} title="Předpisy"><${UserButton} /><//>
    <main class="page with-nav">
      <${ErrorBox} error=${regs.error} />
      ${!regs.data && regs.loading && html`<${Loading} />`}
      ${regs.data?.length === 0 && html`
        <${Empty}>${api.mode === 'demo'
          ? 'V ukázkovém režimu nejsou předpisy k dispozici.'
          : `Zatím tu nejsou žádné předpisy.${can.admin(me) ? ' Nahrajte je níže.' : ' Nahraje je administrátor.'}`}<//>`}
      ${regs.data?.length > 0 && html`
        <ul class="list">
          ${regs.data.map((r) => html`
            <li key=${r.id} class="reg-row">
              <a class="list-row reg-link" href=${r.url} target="_blank" rel="noopener">
                <${Icon} name="file" size=${26} class="reg-icon" />
                <span class="reg-info">
                  <b>${r.title}</b>
                  <span class="muted small">PDF${r.size_bytes ? ` · ${sizeMB(r.size_bytes)}` : ''} · nahráno ${formatDateTime(r.created_at)}</span>
                </span>
              </a>
              ${can.admin(me) && html`
                <button class="btn btn-ghost danger" onClick=${() => remove(r)} title="Smazat předpis"><${Icon} name="trash" size=${18} /></button>`}
            </li>`)}
        </ul>
        <p class="hint">Předpis se otevře v prohlížeči nebo v aplikaci pro PDF.</p>`}
      ${can.admin(me) && api.mode !== 'demo' && html`<${UploadForm} onDone=${refresh} />`}
    </main>
    <${BottomNav} active="predpisy" />`;
}
