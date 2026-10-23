// Detail závady s komentáři ve stylu chatu (vlastní zprávy vpravo, ostatní vlevo).

import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { can, formatDay, formatNumber, formatTime } from '../model.js';
import { actorName, describe } from '../history.js';
import { formatDateTime } from '../model.js';
import { DefectCard, Empty, ErrorBox, Icon, Loading, TopBar, readCached, useApp, useLoad, writeCached } from '../ui.js';

// Historie změn závady (kdo, kdy, co) – rozbalí se tlačítkem
function DefectHistory({ id }) {
  const { api } = useApp();
  const [open, setOpen] = useState(false);
  const data = useLoad(() => api.listHistory(id), [id]);
  const entries = data.data ?? [];
  return html`
    <button class="btn btn-ghost block toggle" onClick=${() => setOpen(!open)} aria-expanded=${open}>
      <${Icon} name="history" /> Historie změn${data.data ? ` (${entries.length})` : ''}
      <${Icon} name="down" class=${open ? 'flip' : ''} />
    </button>
    ${open && html`
      <${ErrorBox} error=${data.error} />
      ${data.data && !entries.length && html`<${Empty}>Zatím bez záznamů (historie se zapisuje od jejího zapnutí).<//>`}
      <ul class="history-list">
        ${entries.map((e) => {
          const d = describe(e);
          return html`
            <li key=${e.id} class="history-item">
              <span class="muted small">${formatDateTime(e.at)}</span>
              <div><b>${actorName(e)}</b> ${d.title}</div>
              ${d.lines.map((l) => html`<div class="small history-line">${l}</div>`)}
            </li>`;
        })}
      </ul>`}`;
}

export function DefectView({ id }) {
  const { api, me, version, toast } = useApp();
  const defect = useLoad(() => api.getDefect(id), [id], `defect:${id}`);
  const d = defect.data;
  const wagon = useLoad(() => (d ? api.getWagon(d.wagon_id) : Promise.resolve(null)), [d?.wagon_id],
    d ? `wagon:${d.wagon_id}` : undefined);
  const [comments, setComments] = useState(() => readCached(api.mode, `comments:${id}`) ?? null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef();
  const inputRef = useRef();
  const firstLoad = useRef(true);

  const reload = () => api.listComments(id).then((c) => { writeCached(api.mode, `comments:${id}`, c); setComments(c); },
    (e) => toast(e.message, { kind: 'error' }));
  useEffect(() => api.subscribeComments(id, reload), [id]);
  useEffect(() => { reload(); }, [id, version]);
  useEffect(() => {
    if (!comments?.length) return;
    endRef.current?.scrollIntoView({ behavior: firstLoad.current ? 'auto' : 'smooth', block: 'end' });
    firstLoad.current = false;
  }, [comments?.length]);

  async function send(e) {
    e?.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await api.addComment(id, text);
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      await reload();
    } catch (err) {
      toast(err.message, { kind: 'error' });
    } finally {
      setSending(false);
    }
  }

  async function remove(c) {
    if (!confirm('Smazat komentář?')) return;
    try { await api.deleteComment(c.id); await reload(); } catch (err) { toast(err.message, { kind: 'error' }); }
  }

  const back = d ? `#/vuz/${d.wagon_id}` : '#/';
  if (!d) {
    return html`
      <${TopBar} back=${back} title="Závada" />
      <main class="page">
        <${ErrorBox} error=${defect.error} />
        ${defect.loading ? html`<${Loading} />` : html`<${Empty}>Závada nebyla nalezena (možná byla smazána).<//>`}
      </main>`;
  }

  let lastDay = '';
  return html`
    <${TopBar} back=${back} title=${wagon.data ? formatNumber(wagon.data.number) : 'Závada'} sub=${wagon.data?.group_name} />
    <main class="page chat-page">
      <${DefectCard} d=${d} wagon=${wagon.data} showComments=${false} />
      <${DefectHistory} id=${id} />
      <h2 class="section-title">Komentáře</h2>
      <div class="chat">
        ${comments === null && html`<${Loading} />`}
        ${comments?.length === 0 && html`<${Empty}>Zatím žádné komentáře. Napište první.<//>`}
        ${comments?.map((c) => {
          const day = formatDay(c.created_at);
          const sep = day !== lastDay;
          lastDay = day;
          const mine = c.author_id === me.id;
          return html`
            ${sep && html`<div class="chat-day"><span>${day}</span></div>`}
            <div key=${c.id} class="bubble ${mine ? 'mine' : ''}">
              ${!mine && html`<div class="bubble-author">${c.author_name || 'Neznámý uživatel'}</div>`}
              <div class="bubble-text">${c.body}</div>
              <div class="bubble-meta">
                ${can.deleteComment(me, c) && html`
                  <button class="link-btn" onClick=${() => remove(c)} aria-label="Smazat komentář"><${Icon} name="trash" size=${12} /></button>`}
                ${formatTime(c.created_at)}
              </div>
            </div>`;
        })}
        <div ref=${endRef}></div>
      </div>
    </main>
    <form class="composer" onSubmit=${send}>
      <textarea ref=${inputRef} rows="1" placeholder="Napište komentář…" value=${text}
        onInput=${(e) => { setText(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 140)}px`; }}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(hover: hover)').matches) send(e); }}></textarea>
      <button class="send-btn" type="submit" disabled=${!text.trim() || sending} aria-label="Odeslat"><${Icon} name="send" /></button>
    </form>`;
}
