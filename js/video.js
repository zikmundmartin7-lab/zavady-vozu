// Převod videa přímo v telefonu (knihovna Mediabunny, kóduje přes WebCodecs, tedy hardwarem telefonu).
// 1. Video nad MAX_VIDEO_MB (limit souboru v úložišti Supabase na bezplatném tarifu) se před přidáním
//    k závadě převede na menší MP4 s H.264 – přehraje ho každý telefon i počítač a Chrome v Androidu ho
//    umí sdílet do WhatsAppu. Kvalita: rozlišení nejvýš Full HD, datový tok tak vysoký, jak se do limitu
//    vejde (nejvýš 8 Mbit/s – u záběru z telefonu bez viditelné ztráty), zvuk se jen přenese.
// 2. Video z iPhonu (.mov) se pro sdílení z Androidu přebalí do MP4 – Chrome v Androidu .mov sdílet odmítne.
// Knihovna (asi 0,7 MB) se načte až při prvním takovém videu; service worker ji stahuje předem se skenerem
// čísla vozu, aby převod fungoval i bez signálu (stejná cesta v sw.js a js/offline.js).
import { MAX_VIDEO_MB } from './model.js';

const LIB = '../vendor/mediabunny-1.65.2.min.mjs';
export const VIDEO_LIMIT = MAX_VIDEO_MB * 1024 * 1024;
const TARGET = 45 * 1024 * 1024; // rezerva pod limitem: obal souboru a kolísání datového toku
// Delší strana obrazu a datový tok videa: Full HD od 2,5 Mbit/s, kratší dlouhé video 720p až do 1 Mbit/s
const STEPS = [{ side: 1920, min: 2.5e6, max: 8e6 }, { side: 1280, min: 1e6, max: 2.5e6 }];

/** Umí prohlížeč video převést? (WebCodecs: Chrome 94+, Safari 16.4+) */
export const canShrink = () => typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function';

const even = (x) => Math.max(2, Math.round(x / 2) * 2);
const minutes = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const mp4Name = (name) => `${(name || 'video').replace(/\.[^.]+$/, '')}.mp4`;

async function openInput(file) {
  const M = await import(LIB);
  return [M, new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(file) })];
}

// Mediabunny chce mimo Safari H.264 vždy v profilu High (avc1.64…), Chrome v Androidu ale umí často jen Main
// nebo Baseline (emulátor Androidu 17, Chrome 145: High ne, Main a Baseline ano) – video by pak převést nešlo.
// Když telefon High neumí, kóduje tenhle kodér: stejné nastavení, jen profil Main, případně Baseline.
let avcProfile = null; // '4d00' Main | '42e0' Constrained Baseline | null = stačí kodér knihovny
let avcRegistered = false;

async function ensureAvc(M, width, height, bitrate) {
  if (avcProfile || await M.canEncodeVideo('avc', { width, height, bitrate })) return true;
  for (const profile of ['4d00', '42e0']) {
    const config = { codec: `avc1.${profile}28`, width, height, bitrate };
    if (!(await VideoEncoder.isConfigSupported(config).catch(() => ({}))).supported) continue;
    avcProfile = profile;
    if (!avcRegistered) {
      avcRegistered = true;
      M.registerEncoder(class extends M.CustomVideoEncoder {
        static supports(codec) { return codec === 'avc' && avcProfile !== null; }
        init() {
          this.encoder = new VideoEncoder({
            output: (chunk, meta) => this.onPacket(M.EncodedPacket.fromEncodedChunk(chunk), meta),
            error: (e) => this.onError(e),
          });
          this.encoder.configure({ ...this.config, codec: this.config.codec.replace(/^avc1\.[0-9a-f]{4}/i, `avc1.${avcProfile}`) });
        }
        async encode(sample, options) {
          const frame = sample.toVideoFrame();
          this.encoder.encode(frame, options);
          frame.close();
          // nehromadit snímky v paměti, když kodér nestíhá
          while (this.encoder.encodeQueueSize > 4) await new Promise((res) => this.encoder.addEventListener('dequeue', res, { once: true }));
        }
        flush() { return this.encoder.flush(); }
        close() { if (this.encoder.state !== 'closed') this.encoder.close(); }
      });
    }
    return true;
  }
  return false;
}

// Převod do MP4 v paměti; signal ho zruší (AbortError)
async function convert(M, input, video, onProgress, signal) {
  const output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new M.BufferTarget() });
  const conversion = await M.Conversion.init({ input, output, tracks: 'primary', video, audio: {} });
  const lost = conversion.discardedTracks;
  const lostVideo = lost.find((t) => t.track.isVideoTrack());
  if (!conversion.isValid || lostVideo) {
    throw new Error(lostVideo?.reason === 'no_encodable_target_codec'
      ? 'tenhle telefon video převést neumí.' : 'video se nepodařilo přečíst.');
  }
  conversion.onProgress = onProgress;
  const cancel = () => conversion.cancel();
  signal?.addEventListener('abort', cancel);
  try {
    if (signal?.aborted) throw new DOMException('Zrušeno', 'AbortError');
    await conversion.execute();
  } catch (e) {
    if (signal?.aborted) throw new DOMException('Zrušeno', 'AbortError');
    throw e;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
  return { buffer: output.target.buffer, noAudio: lost.some((t) => t.track.isAudioTrack()) };
}

/**
 * Zmenší video pod VIDEO_LIMIT. onProgress(0–1, číslo pokusu), signal (AbortSignal) převod zruší (AbortError).
 * Vrací { file (MP4), noAudio } nebo vyhodí chybu se srozumitelnou hláškou.
 */
export async function shrinkVideo(file, { onProgress, signal } = {}) {
  const fail = (why) => new Error(`Video je větší než ${MAX_VIDEO_MB} MB a ${why}`);
  if (!canShrink()) throw fail('tenhle prohlížeč ho neumí zmenšit – zkraťte ho nebo natočte v nižším rozlišení.');
  const [M, input] = await openInput(file);
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) throw fail('nepodařilo se ho přečíst – zkraťte ho nebo natočte v nižším rozlišení.');
    const audio = await input.getPrimaryAudioTrack();
    const seconds = await input.computeDuration();
    const stats = await track.computePacketStats();
    const audioBps = audio ? (await audio.computePacketStats()).averageBitrate || 0 : 0;
    const budget = (TARGET * 8) / seconds - audioBps;
    const step = STEPS.find((s) => budget >= s.min);
    if (!step) {
      const max = (TARGET * 8) / (STEPS.at(-1).min + audioBps);
      throw new Error(`Video je moc dlouhé (${minutes(seconds)}) – do aplikace se vejde nejvýš asi ${Math.floor(max / 60)} minut. `
        + 'Zkraťte ho v galerii a přidejte znovu.');
    }
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    const options = (side, bitrate) => {
      const scale = Math.min(1, side / Math.max(w, h));
      return {
        codec: 'avc', width: even(w * scale), height: even(h * scale), fit: 'contain',
        quality: new M.Quality({ bitrate: Math.round(bitrate) }),
        // 60 snímků/s na 30: polovina dat i práce, na záběru závady to není poznat
        ...(stats.averagePacketRate > 32 ? { frameRate: 30 } : {}),
      };
    };
    let side = Math.min(step.side, Math.max(w, h));
    let bitrate = Math.min(budget, step.max, stats.averageBitrate || Infinity);
    const first = options(side, bitrate);
    if (!(await ensureAvc(M, first.width, first.height, Math.round(bitrate)))) {
      throw fail('tenhle telefon ho neumí převést – zkraťte ho nebo natočte v nižším rozlišení.');
    }
    let r;
    try {
      // Kodér datový tok jen odhaduje – když se výsledek do limitu nevejde, znovu s menším (nejvýš 3 pokusy).
      // Obraz s hodně detaily (štěrk, zrnitý obraz ve tmě) kodér pod určitý tok nestlačí, pak pomůže jen
      // menší rozlišení (ve zkoušce kodér na Macu u zrnitého Full HD dával 12 Mbit/s, ať se chtělo cokoli).
      for (let pass = 1; ; pass++) {
        r = await convert(M, input, options(side, bitrate), (p) => onProgress?.(p, pass), signal);
        const size = r.buffer.byteLength;
        if (size <= VIDEO_LIMIT || pass === 3) break;
        const ratio = TARGET / size;
        if ((size * 8) / seconds - audioBps > bitrate * 1.15) side = Math.max(640, side * Math.sqrt(ratio) * 0.95);
        bitrate *= ratio * 0.95;
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw fail(/^(tenhle|video se)/.test(e.message) ? e.message : 'nepodařilo se ho zmenšit – zkraťte ho nebo natočte v nižším rozlišení.');
    }
    if (r.buffer.byteLength > VIDEO_LIMIT) throw fail('nepodařilo se ho zmenšit pod limit – zkraťte ho.');
    return {
      file: new File([r.buffer], mp4Name(file.name), { type: 'video/mp4', lastModified: file.lastModified }),
      noAudio: r.noAudio && !!audio,
    };
  } finally {
    input.dispose();
  }
}

/** Video v jiném obalu než MP4 (.mov z iPhonu) přebalí do MP4 beze změny obrazu i zvuku. */
export async function toMp4(blob, name) {
  const [M, input] = await openInput(blob);
  try {
    const { buffer } = await convert(M, input, {});
    return new File([buffer], mp4Name(name), { type: 'video/mp4' });
  } finally {
    input.dispose();
  }
}
