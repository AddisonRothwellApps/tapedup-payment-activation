// Pipeline: every trade account as a card in its sales stage. Drag a card
// (or use its menu) to move it; the move is saved to the customer's CRM
// record, so it shows the same in Shopify admin and at trade.tapedup.co.uk.
// Within a stage, overdue follow-ups come first, then whoever has waited
// longest, so the top of each column is always the next thing to do.
//
// Each card also shows its next email, suggested from its stage and what we
// last sent (change it with the dropdown, or pick "Don't email"). "Bulk
// draft" on a column drafts every card's chosen email into the Outbox, where
// each waits for "Approve and send". Nothing is sent from here.
import { state, PIPELINE, STAGES, stageOf, setStage, label, sublabel, lastContact, todayISO, isKeyAccount } from '../store.js';
import { html, raw, icon, ago, fmtDate, dueLabel, money0, toast, armed, busy, openDrawer } from '../ui.js';
import { prospectState, loadProspects, updateProspect } from '../prospects.js';
import { SERVER_FEATURES, serverApi } from '../server.js';
import { emailState, loadEmailTemplates } from '../email-templates.js';
import { groupState, loadGroups, groupOfCustomer, groupOfProspect } from '../groups.js';

// Prospects (not yet in Shopify) can only be in these stages.
const PROSPECT_STAGES = ['Prospect', 'Contacted', 'Not now', 'Lost'];

const ui = { q: '', showClosed: false };
// Next-email data: what each contact last got (from the trade server), the
// email templates, and any choice made on a card this session.
const mailUi = { steps: null, loading: null, error: '', choice: new Map() };
const CLOSED = new Set(['Not now', 'Lost']);
const DAY = 86400000;

function loadMailData(el) {
  if (!SERVER_FEATURES || mailUi.loading || (mailUi.steps && emailState.loaded)) return;
  mailUi.loading = Promise.all([serverApi('/api/next-steps'), emailState.loaded ? null : loadEmailTemplates(), groupState.loaded ? null : loadGroups()])
    .then(([steps]) => { mailUi.steps = steps; mailUi.error = ''; })
    .catch((err) => { mailUi.error = err.message; })
    .finally(() => { mailUi.loading = null; if (el.isConnected && location.hash.startsWith('#/pipeline')) render(el); });
}

const templates = () => new Map(((emailState.set && emailState.set.templates) || []).filter((t) => t.active !== false).map((t) => [t.key, t]));
const refOf = (x) => (x.c ? x.c.id : `p${x.p.id}`);
const infoOf = (x) => (mailUi.steps ? (x.c ? mailUi.steps.customers[x.c.id] : mailUi.steps.prospects[x.p.id]) : null) || {};
const emailOf = (x) => (x.c ? x.c.email : x.p.email);
const optedOut = (x) => (x.c ? !!x.c.crm.optOut : !!x.p.opt_out);

/** Another centre in the same group that already orders from us, if any. */
function sisterStocking(x) {
  const g = x.c ? groupOfCustomer(x.c.id) : groupOfProspect(x.p.id);
  if (!g) return null;
  const site = g.customers.find((m) => m.customerId !== (x.c && x.c.id) && (state.customers.get(m.customerId) || {}).numberOfOrders > 0);
  return site ? { group: g, name: site.siteName || label(state.customers.get(site.customerId)) } : null;
}

/** The suggested next email for a card: a template key, or '' for none. */
function suggest(x, tpl, now = Date.now()) {
  const i = infoOf(x);
  const has = (k) => (tpl.has(k) ? k : '');
  const stage = x.c ? x.st.stage : x.p.stage;
  const since = i.lastOut ? (now - Date.parse(i.lastOut)) / DAY : Infinity;
  if (i.waiting || optedOut(x) || !emailOf(x)) return '';
  if (i.lastIn && (!i.lastOut || i.lastIn > i.lastOut)) return ''; // they wrote last: answer in the thread
  // The intro sequence: intro or re-intro, then follow-up 1, then 2.
  const chase = () => {
    if (i.lastKey === 'intro' || i.lastKey === 'reintro' || i.lastKey === 'sister-site') return since >= ((tpl.get('followup-1') || {}).delayDays || 4) ? has('followup-1') : '';
    if (i.lastKey === 'followup-1') return since >= 5 ? has('followup-2') : '';
    if (i.lastKey === 'followup-2') return '';
    return null;
  };
  // A sister centre already stocks us: lead with that.
  const firstTouch = sisterStocking(x) && tpl.has('sister-site') ? 'sister-site' : x.p ? (x.p.template === 'reintro' ? 'reintro' : 'intro') : 'intro';
  switch (stage) {
    case 'Prospect': { const c = chase(); return c !== null ? c : has(firstTouch); }
    case 'Contacted': { const c = chase(); return c !== null ? c : has(x.p ? firstTouch : 'reintro'); }
    case 'Sample sent': {
      const ci = tpl.get('sample-checkin');
      return ci && i.lastKey !== 'sample-checkin' && (!i.sampleAt || now - Date.parse(i.sampleAt) >= (ci.delayDays || 5) * DAY) ? 'sample-checkin' : '';
    }
    case 'Account opened': return i.lastKey === 'account-walkthrough' ? '' : has('account-walkthrough');
    case 'Active dealer': {
      if (since < 30) return '';
      const last = x.c.lastOrderAt ? (now - Date.parse(x.c.lastOrderAt)) / DAY : Infinity;
      return last >= 45 && x.c.lastOrderAt ? has('reorder') : '';
    }
    case 'Lapsed': return since < 30 ? '' : has('winback');
    case 'Not now': return since < 60 ? '' : has('reintro');
    default: return ''; // Replied (the agent drafts the answer) and Lost
  }
}

/** The email a card will get from Bulk draft: the dropdown's choice, else the suggestion. */
function chosen(x, tpl) {
  const ref = refOf(x);
  if (mailUi.choice.has(ref)) return mailUi.choice.get(ref);
  return suggest(x, tpl);
}

function nextEmail(x, tpl) {
  if (!SERVER_FEATURES) return '';
  if (!mailUi.steps) return html`<div class="deal__next small muted">${mailUi.error ? '' : 'Checking next email…'}</div>`;
  const i = infoOf(x);
  const name = x.c ? label(x.c) : x.p.company;
  if (i.waiting) return html`<div class="deal__next small"><span class="badge badge--cyan">${icon('inbox', 'i--sm')}In outbox</span></div>`;
  if (optedOut(x)) return html`<div class="deal__next small muted">Opted out of email</div>`;
  if (!emailOf(x)) return html`<div class="deal__next small muted">No email address</div>`;
  const sug = suggest(x, tpl);
  const pick = chosen(x, tpl);
  return html`<label class="deal__next"><span class="small muted">Next email</span>
    <select class="select input--sm" data-next="${refOf(x)}" aria-label="Next email for ${name}">
      <option value="" ${pick === '' ? raw('selected') : ''}>Don't email${sug === '' ? ' (suggested)' : ''}</option>
      ${[...tpl.values()].map((t) => html`<option value="${t.key}" ${pick === t.key ? raw('selected') : ''}>${t.name || t.key}${t.key === sug ? ' (suggested)' : ''}</option>`)}
    </select></label>`;
}

async function bulkDraft(el, stage, list, tpl) {
  const items = list.map((x) => ({ x, key: chosen(x, tpl) })).filter(({ x, key }) => key && !infoOf(x).waiting && emailOf(x) && !optedOut(x))
    .map(({ x, key }) => (x.c ? { customerId: x.c.id, templateKey: key, name: label(x.c) } : { prospectId: x.p.id, templateKey: key, name: x.p.company }));
  if (!items.length) { toast(`Nothing to draft in ${stage}`); return; }
  const r = await serverApi('/api/outbox/bulk', { method: 'POST', body: { items } });
  window.dispatchEvent(new Event('outbox-changed'));
  mailUi.steps = null; mailUi.choice.clear();
  loadProspects({ force: true });
  loadMailData(el);
  if (!r.failed.length) { toast(`${r.drafted} email${r.drafted === 1 ? '' : 's'} drafted. Approve them in the Outbox.`); return; }
  openDrawer({
    title: `${r.drafted} drafted, ${r.failed.length} skipped`, eyebrow: `Bulk draft: ${stage}`,
    body: html`<div class="form">
      <p class="muted small" style="margin:0">The drafted emails are waiting in the <a href="#/outbox">Outbox</a> for you to approve. These weren't drafted:</p>
      <div class="list">${r.failed.map((f) => html`<div class="list__item"><span class="list__main"><span class="strong">${f.name || f.customerId || f.prospectId}</span><span class="small muted">${f.reason}</span></span></div>`)}</div></div>`,
    foot: html`<a class="btn" href="#/outbox" data-close>${icon('inbox', 'i--sm')}Open the Outbox</a>`,
  });
}

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

function prospectCard(x, tpl) {
  const { p, contact } = x;
  return html`
    <article class="deal deal--prospect" aria-label="${p.company}">
      <a class="deal__name" href="#/prospects">${p.company}</a>
      <div class="deal__sub small muted">${[p.contact, p.city].filter(Boolean).join(' · ') || '—'}</div>
      <div class="deal__meta">
        ${contact ? html`<span class="small muted" title="Last emailed">${icon('send', 'i--sm')}${ago(contact)}</span>` : html`<span class="small muted">${p.email ? 'Not emailed yet' : 'No email address'}</span>`}
      </div>
      ${nextEmail(x, tpl)}
      <div class="deal__foot">
        <span class="row" style="gap:4px"><span class="badge" title="Not in Shopify until they reply">Prospect</span>${groupBadge(x)}</span>
        <label class="deal__move"><span class="visually-hidden">Move ${p.company} to</span>
          <select class="select input--sm" data-pmove="${p.id}">${PROSPECT_STAGES.map((s) => html`<option ${s === p.stage ? raw('selected') : ''}>${s}</option>`)}</select></label>
      </div>
    </article>`;
}

function groupBadge(x) {
  const g = x.c ? groupOfCustomer(x.c.id) : groupOfProspect(x.p.id);
  if (!g) return '';
  const sis = sisterStocking(x);
  return html`<a class="badge" href="#/groups/${g.id}" title="${sis ? `${sis.name} already stocks us` : `Part of ${g.name}`}">${icon('building-2', 'i--sm')}${g.name}</a>`;
}

function card(x, today, tpl) {
  if (x.p) return prospectCard(x, tpl);
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
      ${nextEmail(x, tpl)}
      <div class="deal__foot">
        <span class="row" style="gap:4px">
          ${st.guessed ? html`<span class="badge" title="Not set yet: guessed from their orders">Suggested</span>` : ''}
          ${isKeyAccount(c) ? html`<span class="badge badge--accent">Key account</span>` : ''}
          ${groupBadge(x)}
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
  loadMailData(el);
  const tpl = templates();
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
              ${SERVER_FEATURES && mailUi.steps ? (() => { const n = list.filter((x) => chosen(x, tpl) && !infoOf(x).waiting && emailOf(x) && !optedOut(x)).length; return html`
                <button class="btn btn--outline btn--sm board__bulk" data-bulk="${p.key}" ${n ? '' : raw('disabled')} title="Drafts each card's chosen email into the Outbox for approval">${icon('mail', 'i--sm')}Bulk draft${n ? ` (${n})` : ''}</button>`; })() : ''}
            </header>
            <div class="board__cards" data-drop="${p.key}">
              ${list.length ? list.slice(0, 60).map((x) => card(x, today, tpl)) : html`<p class="small muted board__empty">Nobody here</p>`}
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

  // Next email: remember the choice for this session and refresh the column's count.
  el.querySelectorAll('[data-next]').forEach((s) => s.addEventListener('change', () => { mailUi.choice.set(s.dataset.next, s.value); render(el); }));
  el.querySelectorAll('[data-bulk]').forEach((b) => armed(b, () => busy(b, () => bulkDraft(el, b.dataset.bulk, byStage.get(b.dataset.bulk), tpl)).catch(() => {}),
    `Click again: draft ${b.textContent.match(/\d+/)?.[0] || ''} emails`));

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
