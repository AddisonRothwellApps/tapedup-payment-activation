// Pipeline: every trade account as a card in its sales stage. Drag a card
// (or use its menu) to move it; the move is saved to the customer's CRM
// record, so it shows the same in Shopify admin and at trade.tapedup.co.uk.
// Within a stage, overdue follow-ups come first, then whoever has waited
// longest, so the top of each column is always the next thing to do.
import { state, PIPELINE, STAGES, stageOf, setStage, label, sublabel, lastContact, todayISO, isKeyAccount } from '../store.js';
import { html, raw, icon, ago, fmtDate, dueLabel, money0, toast } from '../ui.js';
import { prospectState, loadProspects, updateProspect } from '../prospects.js';
import { SERVER_FEATURES } from '../server.js';

// Prospects (not yet in Shopify) can only be in these stages.
const PROSPECT_STAGES = ['Prospect', 'Contacted', 'Not now', 'Lost'];

const ui = { q: '', showClosed: false };
const CLOSED = new Set(['Not now', 'Lost']);
const DAY = 86400000;

function nextFollowUp(c) {
  return c.crm.log.filter((e) => e.followUp && !e.done).map((e) => e.followUp).sort()[0] || '';
}

function daysInStage(c, now) {
  const since = c.crm.stageChangedAt || c.crm.log.find((e) => e.type === 'auto' && /^Stage:/.test(e.text || ''))?.at || null;
  return since ? Math.floor((now - Date.parse(since)) / DAY) : null;
}

function cards(now) {
  const q = ui.q.trim().toLowerCase();
  const out = new Map(STAGES.map((s) => [s, []]));
  for (const c of state.customers.values()) {
    if (q && ![label(c), c.name, c.email, c.city].some((v) => String(v || '').toLowerCase().includes(q))) continue;
    const st = stageOf(c, now);
    out.get(st.stage).push({ c, st, next: nextFollowUp(c), days: daysInStage(c, now), contact: lastContact(c) });
  }
  for (const p of prospectState.items) {
    if (q && ![p.company, p.contact, p.email, p.city].some((v) => String(v || '').toLowerCase().includes(q))) continue;
    if (out.has(p.stage)) out.get(p.stage).push({ p, days: Math.floor((now - Date.parse(p.updated_at || p.created_at)) / DAY), contact: p.last_contacted });
  }
  const today = todayISO();
  for (const list of out.values()) {
    list.sort((a, b) => {
      const ao = a.next && a.next <= today, bo = b.next && b.next <= today;
      if (ao !== bo) return ao ? -1 : 1;
      if (ao && bo) return a.next.localeCompare(b.next);
      if (!a.c !== !b.c) return a.c ? -1 : 1; // customers above cold prospects
      return (b.days ?? -1) - (a.days ?? -1) || (a.c ? label(a.c) : a.p.company).localeCompare(b.c ? label(b.c) : b.p.company);
    });
  }
  return out;
}

function prospectCard({ p, contact }) {
  return html`
    <article class="deal deal--prospect" aria-label="${p.company}">
      <a class="deal__name" href="#/prospects">${p.company}</a>
      <div class="deal__sub small muted">${[p.contact, p.city].filter(Boolean).join(' · ') || '—'}</div>
      <div class="deal__meta">
        ${contact ? html`<span class="small muted" title="Last emailed">${icon('send', 'i--sm')}${ago(contact)}</span>` : html`<span class="small muted">${p.email ? 'Not emailed yet' : 'No email address'}</span>`}
      </div>
      <div class="deal__foot">
        <span class="row" style="gap:4px"><span class="badge" title="Not in Shopify until they reply">Prospect</span>${p.waiting ? html`<span class="badge badge--cyan">In outbox</span>` : ''}</span>
        <label class="deal__move"><span class="visually-hidden">Move ${p.company} to</span>
          <select class="select input--sm" data-pmove="${p.id}">${PROSPECT_STAGES.map((s) => html`<option ${s === p.stage ? raw('selected') : ''}>${s}</option>`)}</select></label>
      </div>
    </article>`;
}

function card(x, today) {
  if (x.p) return prospectCard(x);
  const { c, st, next, days, contact } = x;
  const due = next ? dueLabel(next, today) : null;
  return html`
    <article class="deal" draggable="true" data-id="${c.id}" aria-label="${label(c)}">
      <a class="deal__name" href="#/customers/${c.numericId}">${label(c)}</a>
      <div class="deal__sub small muted">${sublabel(c) || c.city || '—'}</div>
      <div class="deal__meta">
        ${due ? html`<span class="followup ${due.kind ? `followup--${due.kind}` : ''}" title="Next follow-up ${fmtDate(next)}">${icon('calendar', 'i--sm')}${due.text}</span>` : ''}
        ${contact ? html`<span class="small muted" title="Last contact">${icon('message-circle', 'i--sm')}${ago(contact)}</span>` : html`<span class="small muted">No contact logged</span>`}
        ${c.amountSpent ? html`<span class="small muted" title="Lifetime spend">${money0(c.amountSpent)}</span>` : ''}
      </div>
      <div class="deal__foot">
        <span class="row" style="gap:4px">
          ${st.guessed ? html`<span class="badge" title="Not set yet: guessed from their orders">Suggested</span>` : ''}
          ${isKeyAccount(c) ? html`<span class="badge badge--accent">Key account</span>` : ''}
          ${days != null ? html`<span class="small muted" title="Days in this stage">${days}d</span>` : ''}
        </span>
        <label class="deal__move"><span class="visually-hidden">Move ${label(c)} to</span>
          <select class="select input--sm" data-move="${c.id}">
            ${STAGES.map((s) => html`<option ${s === st.stage ? raw('selected') : ''}>${s}</option>`)}
          </select></label>
      </div>
    </article>`;
}

export function render(el) {
  if (SERVER_FEATURES && !prospectState.loaded && !prospectState.loading && !prospectState.error) loadProspects();
  const now = Date.now();
  const today = todayISO();
  const byStage = cards(now);
  const cols = PIPELINE.filter((p) => ui.showClosed || !CLOSED.has(p.key));
  const open = PIPELINE.filter((p) => !CLOSED.has(p.key) && p.key !== 'Active dealer' && p.key !== 'Lapsed')
    .reduce((n, p) => n + byStage.get(p.key).filter((x) => x.c).length, 0);
  const unset = [...byStage.values()].flat().filter((x) => x.st && x.st.guessed).length;

  el.innerHTML = String(html`
    <div class="page page--wide">
      <div class="page-head">
        <div><p class="eyebrow">Sales</p><h1 class="h1">Pipeline</h1>
          <p class="muted" style="margin:4px 0 0">${open} in progress · ${prospectState.items.length ? `${prospectState.items.length} cold prospects · ` : ''}${byStage.get('Active dealer').filter((x) => x.c).length} active dealers · ${byStage.get('Lapsed').length} lapsed</p></div>
        <div class="page-head__actions row row--wrap">
          <input class="input input--sm" type="search" placeholder="Search accounts" value="${ui.q}" data-q aria-label="Search accounts" style="width:220px">
          <label class="check"><input type="checkbox" data-closed ${ui.showClosed ? raw('checked') : ''}><span>Show Not now and Lost</span></label>
        </div>
      </div>
      ${unset ? html`<div class="notice notice--info">${icon('info')}<div>${unset} account${unset === 1 ? ' has' : 's have'} no stage set, so they're placed from their orders and marked <strong>Suggested</strong>. Move a card to confirm it.</div></div>` : ''}
      <div class="board" role="list">
        ${cols.map((p) => { const list = byStage.get(p.key); return html`
          <section class="board__col" role="listitem" data-stage="${p.key}" aria-label="${p.key}, ${list.length}">
            <header class="board__head">
              <div class="row" style="justify-content:space-between"><h2 class="board__title"><span class="status status--${p.tone}"></span>${p.key}</h2><span class="board__count">${list.length}</span></div>
              <p class="small muted board__hint">${p.hint}</p>
            </header>
            <div class="board__cards" data-drop="${p.key}">
              ${list.length ? list.slice(0, 60).map((x) => card(x, today)) : html`<p class="small muted board__empty">Nobody here</p>`}
              ${list.length > 60 ? html`<a class="small board__empty" href="#/prospects">${list.length - 60} more on the Prospects screen</a>` : ''}
            </div>
          </section>`; })}
      </div>
    </div>`);

  const move = async (id, stage) => {
    const c = state.customers.get(id);
    if (!c || stageOf(c).stage === stage && !stageOf(c).guessed) return;
    try {
      await setStage(c, stage);
      toast(`${label(c)} → ${stage}`);
    } catch (err) {
      toast(`Couldn't move ${label(c)}: ${err.message}`, 'err');
      render(el);
    }
  };

  const q = el.querySelector('[data-q]');
  q.addEventListener('input', () => {
    ui.q = q.value;
    const pos = q.selectionStart;
    render(el);
    const again = el.querySelector('[data-q]');
    again.focus(); again.setSelectionRange(pos, pos);
  });
  el.querySelector('[data-closed]').addEventListener('change', (e) => { ui.showClosed = e.target.checked; render(el); });
  el.querySelectorAll('[data-move]').forEach((s) => s.addEventListener('change', () => move(s.dataset.move, s.value)));
  el.querySelectorAll('[data-pmove]').forEach((s) => s.addEventListener('change', () => updateProspect(Number(s.dataset.pmove), { stage: s.value })
    .then(() => toast(`Moved to ${s.value}`)).catch((err) => { toast(err.message, 'err'); render(el); })));

  // Drag and drop between columns.
  el.querySelectorAll('.deal').forEach((d) => {
    d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', d.dataset.id); e.dataTransfer.effectAllowed = 'move'; d.classList.add('is-dragging'); });
    d.addEventListener('dragend', () => d.classList.remove('is-dragging'));
  });
  el.querySelectorAll('[data-drop]').forEach((zone) => {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const id = e.dataTransfer.getData('text/plain');
      if (id) move(id, zone.dataset.drop);
    });
  });
}
