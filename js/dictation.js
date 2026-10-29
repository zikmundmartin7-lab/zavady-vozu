// Diktování popisu závady: rozpoznávání řeči prohlížeče (Web Speech API, čeština). Chrome i Safari posílají
// zvuk ke zpracování na servery Googlu / Applu, takže diktování většinou potřebuje signál (stejně jako
// mikrofon na klávesnici bez staženého offline jazyka). Kde prohlížeč umí češtinu i přímo v telefonu
// (SpeechRecognition.available s processLocally, Chrome 139+), použije se bez signálu ta. Jinak se poradí
// mikrofon na klávesnici telefonu – Gboard umí stáhnout jazyk pro diktování bez signálu.

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon, isAndroid, isIos, useApp } from './ui.js';

const LANG = 'cs-CZ';
// čte se až při použití (ne při načtení modulu), ať jde rozpoznávání v náhledu podstrčit
const recognizer = () => window.SpeechRecognition || window.webkitSpeechRecognition;

/** Verze prohlížeče z userAgent, např. „Chrome 141“ (jen pro informaci v Můj účet). */
export function browserVersion() {
  const ua = navigator.userAgent;
  const m = /SamsungBrowser\/(\d+)/.exec(ua) ?? /(?:Chrome|CriOS)\/(\d+)/.exec(ua);
  if (/SamsungBrowser/.test(ua)) return { name: 'Samsung Internet', version: Number(m[1]) };
  if (m) return { name: 'Chrome', version: Number(m[1]) };
  return isIos() ? { name: 'Safari', version: null } : { name: 'prohlížeč', version: null };
}

/**
 * Diktování bez signálu (čeština přímo v telefonu): 'ready' | 'downloadable' | 'downloading'
 * | 'unsupported' (prohlížeč to neumí, třeba starší Chrome nebo iPhone) | 'none' (prohlížeč neumí diktovat vůbec).
 */
export async function offlineDictation() {
  const SR = recognizer();
  if (!SR) return 'none';
  if (typeof SR.available !== 'function') return 'unsupported';
  try {
    const s = await SR.available({ langs: [LANG], processLocally: true });
    return { available: 'ready', downloadable: 'downloadable', downloading: 'downloading' }[s] ?? 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Stáhne češtinu pro diktování bez signálu (jen kde offlineDictation() vrátí 'downloadable'). */
export async function installCzech() {
  const SR = recognizer();
  return Boolean(await SR?.install?.({ langs: [LANG], processLocally: true }));
}

/** Přidá nadiktovaný úsek k textu: mezera mezi úseky, na začátku věty velké písmeno. */
export function joinDictated(text, part) {
  const t = part.trim();
  if (!t) return text;
  const sentence = !text.trim() || /[.!?]\s*$/.test(text);
  const piece = sentence ? t[0].toLocaleUpperCase('cs') + t.slice(1) : t;
  return text + (text && !/\s$/.test(text) ? ' ' : '') + piece;
}

const NO_SIGNAL = 'Bez signálu diktování v aplikaci nefunguje. Použijte mikrofon na klávesnici telefonu.';
const NO_SIGNAL_DOWNLOAD = 'Bez signálu diktování v aplikaci nefunguje – čeština není v telefonu. Až bude signál, '
  + 'stáhněte ji v Můj účet (dole), pak půjde diktovat i bez signálu. Teď použijte mikrofon na klávesnici.';

function errorText(code) {
  switch (code) {
    case 'no-speech': return 'Nic jsem neslyšel – klepněte na Diktovat a mluvte.';
    case 'network': return NO_SIGNAL;
    case 'audio-capture': return 'Mikrofon nejde použít – nepoužívá ho jiná aplikace?';
    case 'not-allowed':
      return isIos()
        ? 'Mikrofon není povolený: Nastavení → Safari → Mikrofon → Povolit (a zapnuté Siri a diktování).'
        : isAndroid()
          ? 'Mikrofon není povolený: Nastavení → Aplikace → Chrome → Oprávnění → Mikrofon → Povolit.'
          : 'Mikrofon není povolený – povolte ho v nastavení prohlížeče.';
    case 'service-not-allowed':
    case 'language-not-supported':
      return 'Diktování v aplikaci tento telefon nedovolí. Použijte mikrofon na klávesnici telefonu.';
    default: return `Diktování se nepovedlo (${code}). Zkuste to znovu, nebo použijte mikrofon na klávesnici.`;
  }
}

/** Tlačítko Diktovat: rozpoznaný text předá po větách do onText, průběžně ukazuje, co slyší. */
export function DictateButton({ onText }) {
  const { toast } = useApp();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => () => rec.current?.abort(), []);

  const SR = recognizer();
  if (!SR) return null; // prohlížeč rozpoznávání řeči nemá – zbývá mikrofon na klávesnici

  async function start() {
    const offline = navigator.onLine ? null : await offlineDictation();
    const local = offline === 'ready';
    if (offline && !local) { toast(offline === 'downloadable' ? NO_SIGNAL_DOWNLOAD : NO_SIGNAL, { kind: 'error', duration: 10000 }); return; }
    const r = new SR();
    r.lang = LANG;
    r.interimResults = true;
    // Chrome v Androidu v souvislém režimu výsledky opakuje → jedna promluva na klepnutí (končí pauzou)
    r.continuous = !isAndroid();
    if (local) r.processLocally = true;
    r.onresult = (e) => {
      let done = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) done += e.results[i][0].transcript;
        else partial += e.results[i][0].transcript;
      }
      if (done.trim()) onTextRef.current(done);
      setInterim(partial);
    };
    r.onerror = (e) => { if (e.error !== 'aborted') toast(errorText(e.error), { kind: 'error' }); };
    r.onend = () => { rec.current = null; setListening(false); setInterim(''); };
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch (e) {
      rec.current = null;
      toast(errorText(e.name), { kind: 'error' });
    }
  }

  return html`
    <div class="dictate">
      <button type="button" class=${`btn ${listening ? 'listening' : ''}`} onClick=${listening ? () => rec.current?.stop() : start}
        aria-label=${listening ? 'Ukončit diktování' : 'Diktovat popis'}>
        <${Icon} name="mic" size=${18} /> ${listening ? 'Hotovo' : 'Diktovat'}</button>
      ${listening && html`<span class="dictate-live">${interim || 'Poslouchám, mluvte…'}</span>`}
    </div>`;
}
