// Přihlášení, registrace, čekání na schválení, můj účet a správa uživatelů.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { ROLES, can } from '../model.js';
import { Empty, ErrorBox, Icon, Loading, TopBar, useApp, useLoad } from '../ui.js';

function DemoLogin() {
  const { api } = useApp();
  return html`
    <div class="card">
      <h2>Ukázkový režim</h2>
      <p class="muted">Data jsou jen v tomto prohlížeči. Vyberte, za koho se přihlásit – každá role vidí jiná tlačítka.
        Ve dvou kartách prohlížeče můžete být dva různí uživatelé a zkusit si upozornění na novou závadu.</p>
      <div class="demo-users">
        ${api.demoUsers().map((u) => html`
          <button key=${u.id} class="btn block demo-user" onClick=${() => api.signInAs(u.id)}>
            <b>${u.full_name}</b><span class="muted">${ROLES[u.role]}</span>
          </button>`)}
      </div>
    </div>`;
}

function RealLogin() {
  const { api } = useApp();
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo('');
    try {
      if (tab === 'login') await api.signIn(email.trim(), password);
      if (tab === 'register') {
        if (!name.trim()) throw new Error('Vyplňte jméno a příjmení.');
        const r = await api.signUp(email.trim(), password, name);
        setInfo(r.needsConfirmation
          ? 'Hotovo. Na e-mail vám přišel odkaz pro potvrzení účtu. Po potvrzení musí účet ještě schválit správce.'
          : 'Účet vytvořen. Teď ho musí schválit správce.');
      }
      if (tab === 'reset') {
        await api.resetPassword(email.trim());
        setInfo('Pokud účet existuje, přišel vám e-mail s odkazem pro nastavení nového hesla.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card form" onSubmit=${submit}>
      <div class="tabs">
        <button type="button" class=${tab === 'login' ? 'active' : ''} onClick=${() => setTab('login')}>Přihlásit</button>
        <button type="button" class=${tab === 'register' ? 'active' : ''} onClick=${() => setTab('register')}>Registrovat</button>
      </div>
      ${tab === 'register' && html`
        <label class="field">Jméno a příjmení
          <input autocomplete="name" value=${name} onInput=${(e) => setName(e.currentTarget.value)} required /></label>`}
      <label class="field">E-mail
        <input type="email" autocomplete="email" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} required /></label>
      ${tab !== 'reset' && html`
        <label class="field">Heslo
          <input type="password" autocomplete=${tab === 'login' ? 'current-password' : 'new-password'} minlength="6"
            value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>`}
      <${ErrorBox} error=${error} />
      ${info && html`<div class="ok-note">${info}</div>`}
      <button class="btn btn-primary block big-btn" disabled=${busy}>
        ${tab === 'login' ? 'Přihlásit se' : tab === 'register' ? 'Vytvořit účet' : 'Poslat odkaz'}
      </button>
      ${tab === 'login' && html`<button type="button" class="link-btn" onClick=${() => setTab('reset')}>Zapomenuté heslo</button>`}
      ${tab === 'reset' && html`<button type="button" class="link-btn" onClick=${() => setTab('login')}>Zpět na přihlášení</button>`}
    </form>`;
}

export function LoginView() {
  const { api } = useApp();
  return html`
    <main class="page narrow login">
      <div class="logo"><img src="icons/icon.svg" alt="" width="72" height="72" /><h1>Závady vozů</h1></div>
      ${api.mode === 'demo' ? html`<${DemoLogin} />` : html`<${RealLogin} />`}
    </main>`;
}

export function PendingView() {
  const { api, me, reloadMe } = useApp();
  return html`
    <main class="page narrow login">
      <div class="logo"><img src="icons/icon.svg" alt="" width="72" height="72" /><h1>Závady vozů</h1></div>
      <div class="card">
        <h2>Účet čeká na schválení</h2>
        <p>Dobrý den${me.full_name ? `, ${me.full_name}` : ''}. Váš účet zatím neschválil správce aplikace.
          Jakmile ho schválí, uvidíte vozy a závady.</p>
        <div class="row">
          <button class="btn btn-primary" onClick=${reloadMe}>Zkontrolovat znovu</button>
          <button class="btn" onClick=${() => api.signOut()}>Odhlásit</button>
        </div>
      </div>
    </main>`;
}

export function RecoveryView({ onDone }) {
  const { api, toast } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try {
      await api.updatePassword(password);
      toast('Heslo změněno.');
      onDone();
    } catch (err) { setError(err); }
  }
  return html`
    <main class="page narrow login">
      <form class="card form" onSubmit=${submit}>
        <h2>Nové heslo</h2>
        <label class="field">Nové heslo
          <input type="password" autocomplete="new-password" minlength="6" value=${password}
            onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>
        <${ErrorBox} error=${error} />
        <button class="btn btn-primary block big-btn">Uložit heslo</button>
      </form>
    </main>`;
}

export function AccountView() {
  const { api, me, toast, reloadMe, installPrompt } = useApp();
  const [name, setName] = useState(me.full_name);
  const [push, setPush] = useState('off');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.push.status().then(setPush, () => {}); }, []);

  async function saveName(e) {
    e.preventDefault();
    try { await api.updateMyName(name); toast('Jméno uloženo.'); reloadMe(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
  async function testPush() {
    setBusy(true);
    try {
      const n = await api.push.test();
      toast(`Zkušební upozornění odesláno (zařízení: ${n}).`);
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function togglePush() {
    setBusy(true);
    try {
      if (push === 'on') { await api.push.disable(); setPush('off'); toast('Upozornění vypnuta.'); }
      else { await api.push.enable(); setPush('on'); toast('Upozornění zapnuta.'); }
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <${TopBar} back="#/" title="Můj účet" />
    <main class="page narrow">
      <form class="card form" onSubmit=${saveName}>
        <label class="field">Jméno a příjmení
          <input value=${name} onInput=${(e) => setName(e.currentTarget.value)} /></label>
        <div class="muted">${me.email} · role: <b>${ROLES[me.role]}</b></div>
        <button class="btn" disabled=${name.trim() === me.full_name || !name.trim()}>Uložit jméno</button>
      </form>

      <section class="card">
        <h2><${Icon} name="bell" /> Upozornění na nové závady</h2>
        ${api.push.supported()
          ? html`
            <p class="muted">${push === 'on'
              ? 'Zapnuto – když kdokoli vloží novou závadu, přijde vám upozornění i při zavřené aplikaci.'
              : 'Vypnuto. Zapněte, ať vám přijde upozornění, když někdo vloží novou závadu.'}</p>
            <div class="row">
              <button class="btn ${push === 'on' ? '' : 'btn-primary'}" disabled=${busy} onClick=${togglePush}>
                ${push === 'on' ? 'Vypnout upozornění' : 'Zapnout upozornění'}</button>
              ${push === 'on' && html`<button class="btn" disabled=${busy} onClick=${testPush}>Poslat zkušební</button>`}
            </div>
            ${api.mode === 'demo' && html`<p class="hint">V ukázkovém režimu chodí upozornění jen mezi kartami tohoto prohlížeče.</p>`}`
          : html`<p class="muted">${api.mode === 'supabase'
              ? 'Upozornění zatím nejsou nastavená (chybí VAPID klíč) nebo je tento prohlížeč nepodporuje.'
              : 'Tento prohlížeč upozornění nepodporuje.'}</p>`}
      </section>

      ${installPrompt && html`
        <section class="card">
          <h2>Aplikace na plochu</h2>
          <p class="muted">Nainstalujte si aplikaci – poběží jako samostatná aplikace s ikonou.</p>
          <button class="btn btn-primary" onClick=${() => installPrompt.prompt()}>Nainstalovat</button>
        </section>`}

      ${can.admin(me) && html`
        <a class="card list-row" href="#/uzivatele"><${Icon} name="users" /> Správa uživatelů <span class="spacer"></span><${Icon} name="right" size=${18} /></a>`}

      ${api.mode === 'demo' && html`
        <section class="card">
          <h2>Ukázkový režim</h2>
          <button class="btn" onClick=${() => confirm('Smazat všechny změny a nahrát znovu ukázková data?') && api.resetDemo()}>Obnovit ukázková data</button>
        </section>`}

      <button class="btn block" onClick=${() => api.signOut().then(() => { location.hash = ''; })}><${Icon} name="logout" /> Odhlásit</button>
    </main>`;
}

export function UsersView() {
  const { api, me, toast, refresh } = useApp();
  const users = useLoad(() => api.listProfiles(), []);
  if (!can.admin(me)) return html`<${TopBar} back="#/" title="Uživatelé" /><main class="page"><${Empty}>Jen pro správce.<//></main>`;
  const list = [...(users.data ?? [])].sort((a, b) => (a.role === 'pending' ? 0 : 1) - (b.role === 'pending' ? 0 : 1));

  async function setRole(u, role) {
    try { await api.setRole(u.id, role); toast(`${u.full_name || u.email}: ${ROLES[role]}`); refresh(); }
    catch (err) { toast(err.message, { kind: 'error' }); refresh(); }
  }

  return html`
    <${TopBar} back="#/ucet" title="Správa uživatelů" />
    <main class="page narrow">
      <p class="muted">Nově registrovaní uživatelé čekají na schválení. Nastavením role „Čeká na schválení“ lze účet i zablokovat.</p>
      <${ErrorBox} error=${users.error} />
      ${!users.data && html`<${Loading} />`}
      <ul class="list">
        ${list.map((u) => html`
          <li key=${u.id} class="list-row user-row ${u.role === 'pending' ? 'pending' : ''}">
            <div class="user-info">
              <b>${u.full_name || '(bez jména)'}</b>
              <span class="muted small">${u.email}</span>
            </div>
            <select value=${u.role} disabled=${u.id === me.id} onChange=${(e) => setRole(u, e.currentTarget.value)}>
              ${Object.entries(ROLES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
            </select>
          </li>`)}
      </ul>
      <p class="hint">Vozmistr: zakládá závady, komentuje a své závady může označit jako opravené. Opravář: navíc označuje jako opravené i cizí závady.
        Správce: vše včetně úprav a mazání cizích závad a správy uživatelů.</p>
    </main>`;
}
