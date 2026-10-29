// Skener čísla vozu (převzato z aplikace Výkaz vozů, js/views/scanner.js – držet obě kopie stejné): živý obraz
// z kamery, neuronová síť přímo v telefonu průběžně čte text v rámečku. Číslo se přijme samo, když ho přečte
// dvakrát po sobě a sedí kontrolní číslice, kód státu i rozdělení do skupin; s pouhou platnou kontrolní číslicí
// se jen nabídne a nabídka zůstane, i když kamera z čísla odjede. Ke kontrole se ukáže výřez snímku s číslem
// nad přečteným číslem.
// Záloha: fotka fotoaparátem telefonu. Sítě (asi 25 MB) se stahují s novou verzí aplikace (sw.js, js/offline.js),
// aby skener fungoval i v terénu bez signálu.

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { loadOcr, readText } from '../ocr.js';
import { formatNumber, numberCandidates } from '../model.js';
import { CameraSteps, Icon, WagonNumber, isAndroid, isIos, useBackClose } from '../ui.js';
import { useCameraLight, LightButtons, BrightnessSlider, applyGain } from '../light.js';
import { ocrReady } from '../offline.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DECAY = 0.8;       // hlasy z předchozích snímků slábnou
const ACCEPT = 3.2;      // „jisté“ číslo (2 body) ve dvou snímcích po sobě
const MAYBE = 1.8;       // platná kontrolní číslice aspoň ve dvou snímcích → nabídnout
const MAX_MAYBE = 4;     // nabídnutá čísla zůstávají k výběru, při dalších vypadne nejstarší
const LIVE_SIDE = 1280;  // výřez rámečku z kamery
const PHOTO_SIDE = 3024; // fotka fotoaparátem se čte v plném rozlišení

// Full HD jako ve Výkazu vozů – s kamerou ve 4K (verze 49–52) četl skener v telefonu znatelně hůř
const CAMERA = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

// Rámeček na obrazovce → výřez ve skutečném obrazu kamery (video je roztažené přes object-fit: cover).
function guideRegion(video, guide) {
  const vr = video.getBoundingClientRect();
  const g = guide.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(vr.width / vw, vr.height / vh);
  const ox = (vr.width - vw * scale) / 2;
  const oy = (vr.height - vh * scale) / 2;
  const x = Math.max(0, (g.left - vr.left - ox) / scale);
  const y = Math.max(0, (g.top - vr.top - oy) / scale);
  return { x, y, w: Math.min(vw - x, g.width / scale), h: Math.min(vh - y, g.height / scale) };
}

function grab(src, r, canvas, max) {
  const k = Math.min(1, max / Math.max(r.w, r.h));
  canvas.width = Math.round(r.w * k);
  canvas.height = Math.round(r.h * k);
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(src, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Výřez snímku kolem řádků, ze kterých se číslo složilo (ke kontrole), jako obrázek do panelu.
function shot(canvas, lines, idx) {
  const boxes = (idx ?? []).map((i) => lines[i]).filter(Boolean);
  let r = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  if (boxes.length) {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    const m = Math.max(...boxes.map((b) => b.h)) * 0.4;
    const x = Math.max(0, x0 - m);
    const y = Math.max(0, y0 - m);
    r = { x, y, w: Math.min(canvas.width, x1 + m) - x, h: Math.min(canvas.height, y1 + m) - y };
  }
  const k = Math.min(1, 900 / r.w, 360 / r.h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(r.w * k));
  c.height = Math.max(1, Math.round(r.h * k));
  c.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

/** Celoobrazovkový skener. onDone(number) – přečtené a potvrzené číslo (12 číslic). */
export function Scanner({ onDone, onClose }) {
  const videoRef = useRef();
  const guideRef = useRef();
  const pausedRef = useRef(false);
  const offeredRef = useRef([]);                 // nabídnutá čísla { number, shot } v pořadí, jak přišla
  const [camera, setCamera] = useState('start'); // start | live | denied | none
  const [size, setSize] = useState('');          // skutečné rozlišení kamery
  const [ready, setReady] = useState(false);
  const [download, setDownload] = useState(false);
  const [reading, setReading] = useState('');
  const [found, setFound] = useState(null);     // { number, shot }
  const [maybe, setMaybe] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useBackClose(onClose);
  const light = useCameraLight();
  const gainRef = useRef(1);
  gainRef.current = light.gain;
  pausedRef.current = Boolean(found || busy);

  const isOffered = (n) => offeredRef.current.some((m) => m.number === n);
  // Nabídka se jen doplňuje (pořadí zůstává, ať se tlačítko neposune pod prstem) – nezmizí, když kamera odjede.
  function offer(items) {
    const fresh = items.filter((m) => !isOffered(m.number));
    if (!fresh.length) return;
    offeredRef.current = [...offeredRef.current, ...fresh].slice(-MAX_MAYBE);
    setMaybe(offeredRef.current);
  }

  useEffect(() => {
    let stopped = false;
    let stream = null;
    const votes = new Map();
    (async () => {
      // sítě se stahují s novou verzí aplikace; kdyby v telefonu nebyly, řekne se, že se stahuje asi 25 MB
      ocrReady().then((hit) => !hit && !stopped && setDownload(true));
      loadOcr().then(() => setReady(true), () => setError(navigator.onLine
        ? 'Rozpoznávání čísel se nenačetlo. Zkuste skener zavřít a otevřít znovu.'
        : 'Rozpoznávání čísel se poprvé stahuje z internetu (asi 25 MB) – teď není signál. Číslo zatím zadejte ručně.'));
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: CAMERA, audio: false });
      } catch (e) {
        setCamera(e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : 'none');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play().catch(() => {});
      light.attach(stream.getVideoTracks()[0]);
      setCamera('live');
      setSize(`${video.videoWidth} × ${video.videoHeight}`);
      await loadOcr().catch(() => {});
      const canvas = document.createElement('canvas');
      while (!stopped) {
        if (pausedRef.current || video.readyState < 2 || !guideRef.current) {
          votes.clear();
          await sleep(150);
          continue;
        }
        applyGain(grab(video, guideRegion(video, guideRef.current), canvas, LIVE_SIDE), gainRef.current);
        const lines = await readText(canvas).catch(() => []);
        if (stopped || pausedRef.current) continue;
        setReading(lines.filter((l) => /\d/.test(l.text)).map((l) => l.text).join('  ').slice(0, 40));
        for (const [k, v] of votes) votes.set(k, { sure: v.sure * DECAY, valid: v.valid * DECAY });
        const cands = numberCandidates(lines).filter((c) => c.valid).slice(0, 3);
        for (const c of cands) {
          const v = votes.get(c.number) ?? { sure: 0, valid: 0 };
          votes.set(c.number, { sure: v.sure + (c.sure ? 2 : 0), valid: v.valid + 1 });
        }
        // Samo se přijme jen „jisté“ číslo; s pouhou platnou kontrolní číslicí se jen nabídne k ťuknutí.
        const best = [...votes].sort((a, b) => b[1].sure - a[1].sure)[0];
        if (best && best[1].sure >= ACCEPT) {
          navigator.vibrate?.(80);
          const c = cands.find((x) => x.number === best[0]);
          setFound({ number: best[0], shot: shot(canvas, lines, c?.lines) });
        } else {
          // výřez ke kontrole jen jednou, když se číslo poprvé nabídne (převod na obrázek něco stojí)
          offer(cands.filter((c) => votes.get(c.number).valid >= MAYBE && !isOffered(c.number))
            .map((c) => ({ number: c.number, shot: shot(canvas, lines, c.lines) })));
        }
        await sleep(60);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function fromPhoto(file) {
    setBusy(true);
    setError(null);
    try {
      const bmp = await createImageBitmap(file);
      const c = grab(bmp, { x: 0, y: 0, w: bmp.width, h: bmp.height }, document.createElement('canvas'), PHOTO_SIDE);
      const lines = await readText(c, { maxSide: 1600 });
      const cands = numberCandidates(lines).filter((x) => x.valid);
      if (cands[0]?.sure || cands.length === 1) setFound({ number: cands[0].number, shot: shot(c, lines, cands[0].lines) });
      else {
        offer(cands.slice(0, 3).map((x) => ({ number: x.number, shot: shot(c, lines, x.lines) })));
        setError(cands.length
          ? 'Na fotce je víc možných čísel – ťukněte na správné.'
          : 'Číslo se z fotky nepodařilo přečíst. Vyfoťte ho zblízka, nebo ho zadejte ručně.');
      }
    } catch (e) {
      setError(`Fotku se nepodařilo přečíst: ${e.message}`);
    }
    setBusy(false);
  }

  const tip = busy ? 'Čtu fotku…'
    : !ready ? (download ? 'Stahuji rozpoznávání čísel (asi 25 MB, jen poprvé)…' : 'Načítám rozpoznávání…')
      : 'Namiřte na číslo vozu, ať je celé v rámečku';

  return html`<div class="scanner" role="dialog" aria-label="Načíst číslo vozu kamerou">
    <div class="view">
      ${camera === 'denied' || camera === 'none'
        ? html`<div class="msg">
            <p><b>${camera === 'denied' ? 'Fotoaparát není povolený.' : 'Kamera není dostupná.'}</b></p>
            ${camera === 'denied' && isAndroid() && html`<${CameraSteps} />`}
            ${camera === 'denied' && isIos() && html`<p class="small"><b>Nastavení → Safari → Fotoaparát</b> → Povolit.</p>`}
            <p class="small">Číslo můžete vyfotit fotoaparátem nebo zadat ručně.</p>
          </div>`
        : html`<video ref=${videoRef} playsinline muted autoplay style=${light.filter}></video>
            <div ref=${guideRef} class=${`guide ${found ? 'hit' : ''}`}></div>
            <div class="tip">${tip}</div>
            <div class="reading">${!found && reading}</div>`}
      <div class="top">
        <button type="button" class="icon-btn" onClick=${onClose} aria-label="Zavřít"><${Icon} name="x" size=${24} /></button>
        ${size && html`<span class="res" title="Rozlišení kamery">${size}</span>`}
        <span class="spacer"></span>
        ${camera === 'live' && html`<${LightButtons} light=${light} />`}
      </div>
      <${BrightnessSlider} light=${light} />
    </div>

    <div class="panel">
      ${error && html`<div class="warn">${error}</div>`}
      ${found
        ? html`<div class="compare">
              ${found.shot && html`<img class="shot" src=${found.shot} alt="Výřez snímku s číslem" />`}
              <div class="found"><${WagonNumber} number=${found.number} /></div>
            </div>
            <p class="hint center">Nahoře snímek, pod ním přečtené číslo – porovnejte je. Ve formuláři jde číslo ještě opravit.</p>
            <div class="row">
              <button type="button" class="btn" onClick=${() => { setFound(null); setError(null); }}>Znovu</button>
              <button type="button" class="btn btn-ok big-btn grow" onClick=${() => onDone(found.number)}>
                <${Icon} name="check" /> Použít</button>
            </div>`
        : html`${maybe.length > 0 && html`<p class="hint" style="margin-top:0">Možná je to (ťukněte pro kontrolu):</p>
                <div class="chips-select maybe">
                  ${maybe.map((m) => html`<button type="button" class="chip-btn" onClick=${() => setFound(m)}>${formatNumber(m.number)}</button>`)}
                </div>`}
              <div class="row">
                <button type="button" class="btn grow" onClick=${onClose}>Zadat ručně</button>
                <label class=${`btn grow ${busy ? 'disabled' : ''}`}><${Icon} name="camera" /> Vyfotit
                  <input type="file" accept="image/*" capture="environment" hidden disabled=${busy}
                    onChange=${(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) fromPhoto(f); }} /></label>
              </div>`}
    </div>
  </div>`;
}
