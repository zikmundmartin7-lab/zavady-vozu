// Přihlášení, registrace, čekání na schválení, můj účet a správa uživatelů.

import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { DEFAULT_PASSWORD, ROLES, can, plural } from '../model.js';
import { APP_VERSION } from '../version.js';
import { ocrReady, prefetchOcr } from '../offline.js';
import { browserVersion, installCzech, offlineDictation } from '../dictation.js';
import {
  Empty, ErrorBox, Icon, InstallOffer, Loading, PasswordInput, TopBar, enablePush, isAndroid, isIos, isStandalone, setPushOff,
  swVersion, updateApp, useApp, useLoad,
} from '../ui.js';

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

// Zda už se na tomto zařízení někdo přihlásil (nastavuje app.js) – pak se rovnou ukáže přihlášení
const HAD_ACCOUNT = 'zavady-had-account';
const hadAccount = () => { try { return !!localStorage.getItem(HAD_ACCOUNT); } catch { return false; } };

function RealLogin() {
  const { api } = useApp();
  // null = úvodní volba „Jsem tu poprvé“ / „Už mám účet“ (častá chyba: nový uživatel se zkouší přihlásit)
  const [tab, setTab] = useState(() => (hadAccount() ? 'login' : null));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState('');
  const [hint, setHint] = useState(null); // 'register' | 'login' – nabídnout přepnutí po chybě

  const switchTab = (t) => {
    setTab(t); setError(null); setInfo(''); setHint(null);
    setPassword(t === 'register' ? DEFAULT_PASSWORD : '');
  };

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(''); setHint(null);
    try {
      if (tab === 'login') await api.signIn(email.trim(), password);
      if (tab === 'register') {
        if (!name.trim()) throw new Error('Vyplňte jméno a příjmení.');
        const r = await api.signUp(email.trim(), password, name);
        setInfo(r.needsConfirmation
          ? 'Hotovo. Na e-mail vám přišel odkaz pro potvrzení účtu. Po potvrzení musí účet ještě schválit administrátor.'
          : 'Účet vytvořen. Teď ho musí schválit administrátor.');
      }
      if (tab === 'reset') {
        await api.resetPassword(email.trim());
        setInfo('Pokud účet existuje, přišel vám e-mail s odkazem pro nastavení nového hesla.');
      }
    } catch (err) {
      setError(err);
      if (tab === 'login' && /Nesprávný e-mail nebo heslo/.test(err.message)) setHint('register');
      if (tab === 'register' && /už existuje/.test(err.message)) setHint('login');
    } finally {
      setBusy(false);
    }
  }

  if (!tab) {
    return html`
      <div class="card first-choice">
        <button type="button" class="btn btn-primary block choice-btn" onClick=${() => switchTab('register')}>
          <b>Jsem tu poprvé</b><span>vytvořit účet (registrace)</span></button>
        <button type="button" class="btn block choice-btn" onClick=${() => switchTab('login')}>
          <b>Už mám účet</b><span>přihlásit se</span></button>
        <p class="muted small">Přihlásit se jde, až když máte účet. Poprvé se proto nejdřív zaregistrujte –
          po schválení administrátorem uvidíte vozy a závady.</p>
        <p class="muted small">Účet vám založil administrátor a poslal heslo? Zvolte „Už mám účet“.</p>
      </div>`;
  }

  return html`
    <form class="card form" onSubmit=${submit}>
      <div class="tabs">
        <button type="button" class=${tab === 'register' ? 'active' : ''} onClick=${() => switchTab('register')}>
          Registrovat<small>poprvé</small></button>
        <button type="button" class=${tab === 'login' || tab === 'reset' ? 'active' : ''} onClick=${() => switchTab('login')}>
          Přihlásit<small>už mám účet</small></button>
      </div>
      ${tab === 'register' && html`
        <p class="muted small form-intro">Vytvořte si účet. Pak ho ještě musí schválit administrátor.
          Heslo je předvyplněné ${DEFAULT_PASSWORD} – můžete ho nechat, nebo napsat vlastní.</p>
        <label class="field">Jméno a příjmení
          <input autocomplete="name" value=${name} onInput=${(e) => setName(e.currentTarget.value)} required /></label>`}
      <label class="field">E-mail
        <input type="email" autocomplete="email" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} required /></label>
      ${tab !== 'reset' && html`
        <label class="field">Heslo${tab === 'register' ? ' (aspoň 6 znaků)' : ''}
          <${PasswordInput} key=${tab} visible=${tab === 'register'} autocomplete=${tab === 'login' ? 'current-password' : 'new-password'}
            minlength="6" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>`}
      <${ErrorBox} error=${error} />
      ${hint === 'register' && html`
        <div class="first-time-hint">
          <b>Jste tu poprvé?</b> Pak ještě nemáte účet – nejdřív se zaregistrujte.
          <button type="button" class="btn btn-primary block" onClick=${() => switchTab('register')}>Zaregistrovat se</button>
        </div>`}
      ${hint === 'login' && html`
        <div class="first-time-hint">
          Účet už máte – stačí se přihlásit. Heslo jde v případě potřeby obnovit.
          <button type="button" class="btn btn-primary block" onClick=${() => switchTab('login')}>Přihlásit se</button>
        </div>`}
      ${info && html`<div class="ok-note">${info}</div>`}
      <button class="btn btn-primary block big-btn" disabled=${busy}>
        ${tab === 'login' ? 'Přihlásit se' : tab === 'register' ? 'Vytvořit účet' : 'Poslat odkaz'}
      </button>
      ${tab === 'login' && html`<button type="button" class="link-btn" onClick=${() => switchTab('reset')}>Zapomenuté heslo</button>`}
      ${tab === 'reset' && html`<button type="button" class="link-btn" onClick=${() => switchTab('login')}>Zpět na přihlášení</button>`}
    </form>`;
}

export function LoginView() {
  const { api } = useApp();
  // Odkaz na vůz nebo závadu (např. ze zprávy ve WhatsAppu) otevřel někdo nepřihlášený
  const deepLink = /^#\/(vuz|zavada)\//.test(location.hash);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return html`
    <main class="page narrow login">
      <div class="logo"><img src="icons/icon.svg?v=2" alt="" width="72" height="72" /><h1>Závady vozů</h1></div>
      ${deepLink && api.mode !== 'demo' && html`
        <div class="card link-note">
          <b>Odkaz vede na závadu v aplikaci Závady vozů.</b> Zobrazí se po přihlášení.
          ${!standalone && html`<div class="small">Máte aplikaci na ploše? Otevřete ji z ikony – tam už jste přihlášení.</div>`}
        </div>`}
      <${InstallOffer} />
      ${api.mode === 'demo' ? html`<${DemoLogin} />` : html`<${RealLogin} />`}
      <a class="install-link" href="navod.html">Jak nainstalovat aplikaci do telefonu?</a>
    </main>`;
}

export function PendingView() {
  const { api, me, reloadMe } = useApp();
  return html`
    <main class="page narrow login">
      <div class="logo"><img src="icons/icon.svg?v=2" alt="" width="72" height="72" /><h1>Závady vozů</h1></div>
      <div class="card">
        <h2>Účet čeká na schválení</h2>
        <p>Dobrý den${me.full_name ? `, ${me.full_name}` : ''}. Váš účet zatím neschválil administrátor aplikace.
          Jakmile ho schválí, uvidíte vozy a závady.</p>
        <div class="row">
          <button class="btn btn-primary" onClick=${reloadMe}>Zkontrolovat znovu</button>
          <button class="btn" onClick=${() => api.signOut()}>Odhlásit</button>
        </div>
      </div>
      <${InstallOffer} />
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
          <${PasswordInput} autocomplete="new-password" minlength="6" value=${password}
            onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>
        <${ErrorBox} error=${error} />
        <button class="btn btn-primary block big-btn">Uložit heslo</button>
      </form>
    </main>`;
}

export function AccountView() {
  const { api, me, toast, reloadMe, installPrompt, install } = useApp();
  const [name, setName] = useState(me.full_name);
  const [push, setPush] = useState('off');
  const [devices, setDevices] = useState(null); // { count, here } – na kolik zařízení chodí upozornění
  const [busy, setBusy] = useState(false);

  // Přehled zařízení s upozorněním; odběr tohoto zařízení se nejdřív (znovu) přiřadí přihlášenému uživateli
  const loadDevices = async () => {
    if ((await api.push.status().catch(() => 'off')) === 'on') await api.push.resume().catch(() => {});
    api.push.devices().then(setDevices, () => setDevices(null));
  };
  useEffect(() => {
    api.push.status().then(setPush, () => {});
    if (api.push.supported()) loadDevices();
  }, []);

  async function saveName(e) {
    e.preventDefault();
    try { await api.updateMyName(name); toast('Jméno uloženo.'); reloadMe(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }
  async function testPush() {
    setBusy(true);
    try {
      const r = await api.push.test();
      toast(`Zkušební upozornění odesláno na ${plural(r.sent, 'zařízení', 'zařízení', 'zařízení')}`
        + `${r.removed ? `, neplatná odebrána: ${r.removed}` : ''}.`);
      const d = await api.push.devices().catch(() => null);
      setDevices(d);
      if (d && !d.here) {
        toast('Toto zařízení upozornění nedostává – služba upozornění ho odmítla. Zkuste upozornění vypnout '
          + 'a znovu zapnout. Když to nepomůže, zařízení push upozornění neumí (např. tablet bez služeb Google).',
        { kind: 'error', sticky: true });
      }
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function togglePush() {
    setBusy(true);
    try {
      if (push === 'on') { await api.push.disable(); setPushOff(me.id, true); setPush('off'); toast('Upozornění vypnuta.'); }
      else { await enablePush(api, toast, me.id); setPush('on'); }
      loadDevices();
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

      <${ChangePassword} />

      <section class="card">
        <h2><${Icon} name="bell" /> Upozornění na nové závady</h2>
        ${api.push.supported()
          ? html`
            <p class="muted">${push === 'on'
              ? 'Zapnuto – když kdokoli vloží novou závadu, přijde vám upozornění i při zavřené aplikaci.'
              : 'Vypnuto. Zapněte, ať vám přijde upozornění, když někdo vloží novou závadu.'}</p>
            ${devices && html`
              <p class="muted small">Upozornění chodí na ${plural(devices.count, 'zařízení', 'zařízení', 'zařízení')}${devices.here ? ', včetně tohoto' : ''}.
                ${push === 'on' && !devices.here && html`<b class="error-text">Toto zařízení mezi nimi není</b> – vypněte a znovu zapněte upozornění.`}</p>`}
            <div class="row">
              <button class="btn ${push === 'on' ? '' : 'btn-primary'}" disabled=${busy} onClick=${togglePush}>
                ${push === 'on' ? 'Vypnout upozornění' : 'Zapnout upozornění'}</button>
              ${push === 'on' && html`<button class="btn" disabled=${busy} onClick=${testPush}>Poslat zkušební</button>`}
            </div>
            ${api.mode === 'demo' && html`<p class="hint">V ukázkovém režimu chodí upozornění jen mezi kartami tohoto prohlížeče.</p>`}`
          : html`<p class="muted">${isIos() && !isStandalone()
              ? 'Na iPhonu chodí upozornění jen do aplikace otevřené z ikony na ploše, ne ze Safari.'
              : api.mode === 'supabase'
                ? 'Upozornění zatím nejsou nastavená (chybí VAPID klíč) nebo je tento prohlížeč nepodporuje.'
                : 'Tento prohlížeč upozornění nepodporuje.'}</p>`}
      </section>

      ${installPrompt && html`
        <section class="card">
          <h2>Aplikace na plochu</h2>
          <p class="muted">Nainstalujte si aplikaci – poběží jako samostatná aplikace s ikonou.</p>
          <button class="btn btn-primary" onClick=${install}>Nainstalovat</button>
        </section>`}

      ${can.admin(me) && html`
        <h2 class="section-title">Správa</h2>
        <ul class="list admin-links">
          <li><a class="list-row" href="#/uzivatele"><${Icon} name="users" /> Správa uživatelů <span class="spacer"></span><${Icon} name="right" size=${18} /></a></li>
          <li><a class="list-row" href="#/historie"><${Icon} name="history" /> Historie změn <span class="spacer"></span><${Icon} name="right" size=${18} /></a></li>
          <li><a class="list-row" href="#/kos"><${Icon} name="trash" /> Koš (smazané záznamy) <span class="spacer"></span><${Icon} name="right" size=${18} /></a></li>
          <li><a class="list-row" href="#/exporty"><${Icon} name="download" /> Pravidelné exporty na e-mail <span class="spacer"></span><${Icon} name="right" size=${18} /></a></li>
        </ul>`}

      ${api.mode === 'demo' && html`
        <section class="card">
          <h2>Ukázkový režim</h2>
          <button class="btn" onClick=${() => confirm('Smazat všechny změny a nahrát znovu ukázková data?') && api.resetDemo()}>Obnovit ukázková data</button>
        </section>`}

      <button class="btn block" onClick=${() => api.signOut().then(() => { location.hash = ''; })}><${Icon} name="logout" /> Odhlásit</button>
      <${AppVersion} />
    </main>`;
}

// Změna hesla v Můj účet. U účtu založeného administrátorem (dočasné heslo) jen nabídka, ne povinnost.
function ChangePassword() {
  const { api, me, toast, reloadMe } = useApp();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.updatePassword(password);
      toast('Heslo změněno.');
      setPassword(''); setOpen(false); reloadMe();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  const close = () => { setOpen(false); setPassword(''); setError(null); };

  return html`
    <section class="card">
      <h2><${Icon} name="lock" /> Heslo</h2>
      ${me.temp_password && html`<p class="muted">Přihlašujete se základním heslem. Pokud chcete, změňte si ho na vlastní – není to povinné.</p>`}
      ${open
        ? html`
          <form class="form" onSubmit=${submit}>
            <input type="email" autocomplete="username" value=${me.email} readonly hidden />
            <label class="field">Nové heslo (aspoň 6 znaků)
              <${PasswordInput} autocomplete="new-password" minlength="6" value=${password}
                onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>
            <p class="hint">Na ostatních zařízeních se pak přihlásíte novým heslem.</p>
            <${ErrorBox} error=${error} />
            <div class="row">
              <button class="btn btn-primary" disabled=${busy}>Uložit heslo</button>
              <button type="button" class="btn" onClick=${close}>Zrušit</button>
            </div>
          </form>`
        : html`<button class="btn" onClick=${() => setOpen(true)}>Změnit heslo</button>`}
    </section>`;
}

// Verze aplikace = verze, která právě běží (APP_VERSION). Service worker může mít na pozadí staženou novější
// (sw.js → CACHE) – ta se použije až po načtení znovu, proto se v tu chvíli nabídne tlačítko.
// Tlačítko Aktualizovat: najde novou verzi na webu, stáhne ji a aplikaci načte znovu (bez zavírání).
// Skener čísla vozu: je rozpoznávání v telefonu? Před cestou do terénu (bez signálu) se tu dá ověřit;
// chybí-li a je signál, rovnou se stáhne.
function OcrStatus() {
  const [state, setState] = useState(null); // ready | loading | missing
  useEffect(() => {
    let alive = true;
    (async () => {
      if (await ocrReady()) { if (alive) setState('ready'); return; }
      if (!navigator.onLine) { if (alive) setState('missing'); return; }
      if (alive) setState('loading');
      await prefetchOcr().catch(() => {});
      const ok = await ocrReady();
      if (alive) setState(ok ? 'ready' : 'missing');
    })();
    return () => { alive = false; };
  }, []);
  if (!state) return null;
  return html`<p class="muted small">${{
    ready: 'Skener čísla vozu je stažený – funguje i bez signálu.',
    loading: 'Stahuji skener čísla vozu (asi 25 MB, jen jednou)…',
    missing: 'Skener čísla vozu ještě není stažený – stáhne se sám, až bude signál.',
  }[state]}</p>`;
}

// Diktování popisu bez signálu: umí telefon češtinu přímo v sobě? Chybí-li, jde ji tu stáhnout (Chrome 139+).
// Chrome v Androidu to zatím neumí v žádné verzi (jen Chrome na počítači, 2026) – tam se neradí aktualizace,
// ale mikrofon na klávesnici. Kdyby to Android dostal, ukáže se tu samo tlačítko Stáhnout.
function DictationStatus() {
  const { toast } = useApp();
  const [state, setState] = useState(null);
  const b = browserVersion();
  const check = () => offlineDictation().then(setState, () => setState('unsupported'));
  useEffect(() => { check(); }, []);
  // během stahování se stav občas ověří, ať je vidět, až je hotovo
  useEffect(() => {
    if (state !== 'downloading') return undefined;
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, [state]);

  async function download() {
    if (!navigator.onLine) { toast('Češtinu jde stáhnout jen se signálem.', { kind: 'error' }); return; }
    setState('downloading');
    try {
      if (!(await installCzech())) throw new Error('telefon stažení odmítl');
    } catch (e) {
      toast(`Češtinu se nepodařilo stáhnout (${e.message}). Zkuste to znovu na Wi-Fi.`, { kind: 'error' });
    }
    check();
  }

  if (!state) return null;
  const ver = b.version ? ` (${b.name} ${b.version})` : '';
  return html`<div class="dictation-status">
    <p class="muted small">${{
      ready: `Diktování bez signálu: připravené, čeština je v telefonu${ver}.`,
      downloadable: `Diktování bez signálu: čeština ještě není v telefonu${ver}.`,
      downloading: 'Stahuji češtinu pro diktování bez signálu…',
      unsupported: isIos()
        ? 'Diktování v aplikaci potřebuje na iPhonu signál. Bez signálu použijte mikrofon na klávesnici.'
        : isAndroid()
          ? `Diktování bez signálu Android zatím neumí${ver} – tlačítko Diktovat potřebuje signál. Bez signálu použijte `
            + 'mikrofon na klávesnici (v Gboardu si stáhněte češtinu: Hlasové zadávání → Offline rozpoznávání řeči).'
          : b.name === 'Chrome' && b.version < 139
          ? `Diktování bez signálu potřebuje novější Chrome (teď ${b.version}) – aktualizujte ho v Obchodě Play.`
          : `Diktování bez signálu tento telefon pro češtinu neumí${ver} – v aplikaci diktujte se signálem, jinak mikrofonem na klávesnici.`,
      none: `Diktování v aplikaci tento prohlížeč neumí${ver} – použijte mikrofon na klávesnici.`,
    }[state]}</p>
    ${state === 'downloadable' && html`<button type="button" class="btn" onClick=${download}>
      <${Icon} name="mic" size=${18} /> Stáhnout češtinu pro diktování</button>`}
  </div>`;
}

function AppVersion() {
  const { toast } = useApp();
  const [downloaded, setDownloaded] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { swVersion().then(setDownloaded); }, []);

  async function update() {
    setBusy(true);
    const result = await updateApp(APP_VERSION);
    if (result === 'reload') return; // aplikace se právě načítá znovu
    if (result === 'latest') toast(`Máte nejnovější verzi (${APP_VERSION}).`);
    if (result === 'offline') toast('Bez signálu nejde novou verzi zkontrolovat.', { kind: 'error' });
    if (result === 'error') toast('Novou verzi se nepodařilo stáhnout – zkuste to znovu.', { kind: 'error' });
    setBusy(false);
  }

  return html`
    <div class="app-version">
      <p class="muted small">Verze aplikace ${APP_VERSION}${downloaded > APP_VERSION ? ` · stažená je novější verze ${downloaded}` : ''}</p>
      <${OcrStatus} />
      <${DictationStatus} />
      <button type="button" class="btn" disabled=${busy} onClick=${update}>
        <${Icon} name="download" size=${18} /> ${busy ? 'Hledám novou verzi…' : 'Aktualizovat'}</button>
    </div>`;
}

function CreateUserForm({ onCreated, onCancel }) {
  const { api } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api.createUser({ email, fullName: name, role, password });
      onCreated({ name: name.trim(), email: email.trim().toLowerCase(), password, warning: r?.warning });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card form" onSubmit=${submit}>
      <h2>Založit účet</h2>
      <p class="muted small form-intro">Účet bude hned aktivní – bez potvrzovacího e-mailu a bez schvalování.
        Přihlašovací údaje pak pošlete tomu, komu účet patří. Heslo si může později změnit, ale nemusí.</p>
      <label class="field">Jméno a příjmení
        <input autocomplete="off" value=${name} onInput=${(e) => setName(e.currentTarget.value)} required /></label>
      <label class="field">E-mail
        <input type="email" autocomplete="off" value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} required /></label>
      <label class="field">Role
        <select value=${role} onChange=${(e) => setRole(e.currentTarget.value)}>
          ${Object.entries(ROLES).filter(([k]) => k !== 'pending').map(([k, v]) => html`<option value=${k}>${v}</option>`)}
        </select></label>
      <label class="field">Heslo (aspoň 6 znaků, můžete přepsat)
        <${PasswordInput} visible autocomplete="off" minlength="6" value=${password}
          onInput=${(e) => setPassword(e.currentTarget.value)} required /></label>
      <${ErrorBox} error=${error} />
      <div class="row">
        <button class="btn btn-primary" disabled=${busy}>${busy ? 'Zakládám…' : 'Založit účet'}</button>
        <button type="button" class="btn" onClick=${onCancel}>Zrušit</button>
      </div>
    </form>`;
}

// Zpráva s přihlašovacími údaji; *hvězdičky* = tučně ve WhatsAppu
const credentialsText = ({ email, password }) => [
  '*Účet v aplikaci Závady vozů*',
  `Odkaz: ${location.origin}${location.pathname}`,
  `E-mail: ${email}`,
  `Heslo: ${password}`,
  'V aplikaci zvolte „Už mám účet“ a přihlaste se. Heslo si můžete změnit v Můj účet, ale nemusíte.',
].join('\n');

function CreatedCard({ created, onClose }) {
  const { toast } = useApp();
  const text = credentialsText(created);
  const canNative = typeof navigator.share === 'function';

  async function send() {
    try { await navigator.share({ text }); }
    catch (e) { if (e.name !== 'AbortError') toast(`Sdílení se nepovedlo: ${e.message}`, { kind: 'error' }); }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast('Přihlašovací údaje jsou zkopírované.');
    } catch {
      toast('Kopírování se nepovedlo.', { kind: 'error' });
    }
  }

  return html`
    <section class="card">
      <h2>Účet založen: ${created.name}</h2>
      <${ErrorBox} error=${created.warning} />
      <p class="muted small">Pošlete přihlašovací údaje přímo tomu, komu účet patří – ne do skupiny.</p>
      ${canNative
        ? html`<button class="btn btn-whatsapp block big-btn" onClick=${send}>Poslat do WhatsAppu</button>`
        : html`<a class="btn btn-whatsapp block big-btn" href=${`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank" rel="noopener">Otevřít WhatsApp</a>`}
      <div class="share-preview">${text}</div>
      <div class="row">
        <button class="btn" onClick=${copy}><${Icon} name="clipboard" size=${18} /> Kopírovat</button>
        <button class="btn" onClick=${onClose}>Hotovo</button>
      </div>
    </section>`;
}

export function UsersView() {
  const { api, me, toast, refresh } = useApp();
  const users = useLoad(() => api.listProfiles(), []);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { name, email, password, warning } – právě založený účet
  if (!can.admin(me)) return html`<${TopBar} back="#/" title="Uživatelé" /><main class="page"><${Empty}>Jen pro administrátora.<//></main>`;
  const list = [...(users.data ?? [])].sort((a, b) => (a.role === 'pending' ? 0 : 1) - (b.role === 'pending' ? 0 : 1));

  async function setRole(u, role) {
    try { await api.setRole(u.id, role); toast(`${u.full_name || u.email}: ${ROLES[role]}`); refresh(); }
    catch (err) { toast(err.message, { kind: 'error' }); refresh(); }
  }

  return html`
    <${TopBar} back="#/ucet" title="Správa uživatelů" />
    <main class="page narrow">
      <p class="muted">Nově registrovaní uživatelé čekají na schválení. Nastavením role „Čeká na schválení“ lze účet i zablokovat.
        Účet za kolegu můžete založit i sami – bude hned aktivní.</p>
      ${created
        ? html`<${CreatedCard} created=${created} onClose=${() => setCreated(null)} />`
        : creating
          ? html`<${CreateUserForm} onCancel=${() => setCreating(false)}
              onCreated=${(c) => { setCreating(false); setCreated(c); refresh(); }} />`
          : html`<button class="btn btn-primary block create-user-btn" onClick=${() => setCreating(true)}>
              <${Icon} name="plus" /> Založit účet</button>`}
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
      <p class="hint">Vozmistr: zakládá závady, komentuje a své závady může označit jako opravené. Správce: navíc označuje jako opravené i cizí závady.
        Administrátor: vše včetně úprav a mazání cizích závad a správy uživatelů.</p>
    </main>`;
}
