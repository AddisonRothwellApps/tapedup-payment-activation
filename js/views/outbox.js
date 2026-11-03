// Outbox: every email waiting for you, plus what's been sent or failed.
// Nothing leaves trade@ until it's approved here (or, from phase 4, sent by
// the agent on a step you've switched to automatic). Approving sends it
// straight away, within the server's daily limits.
import { state } from '../store.js';
import { html, icon, ago, toast, openDrawer, busy, loadingBlock, showEmail } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { TRADE_SERVER } from '../env.js';

const ui = { tab: 'pending_approval', items: null, status: null, loading: false, error: '' };
const TABS = [
  ['pending_approval', 'Waiting for you'],
  ['approved,scheduled', 'Queued'],
  ['sent', 'Sent'],
  ['failed', 'Failed'],
  ['rejected', 'Rejected'],
];

export const outboxCount = () => (ui.status ? ui.status.pending : 0);

// Always show a fresh list: when you open the Outbox, and when drafts are
// made anywhere else (a customer page, the pipeline, the agent).
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/outbox')) ui.items = null; });
window.addEventListener('outbox-changed', () => { ui.items = null; });

/** Called from the menu so the Outbox count stays current. */
export async function refreshOutboxStatus() {
  if (!SERVER_FEATURES) return null;
  try { ui.status = await serverApi('/api/mail/status'); } catch (err) { /* menu badge is best-effort */ }
  return ui.status;
}

async function load(el) {
  ui.loading = true; ui.error = '';
  try {
    const [list, status] = await Promise.all([serverApi(`/api/outbox?status=${encodeURIComponent(ui.tab)}`), serverApi('/api/mail/status')]);
    ui.items = list.items; ui.status = status;
  } catch (err) { ui.error = err.message; }
  ui.loading = false;
  if (location.hash.startsWith('#/outbox')) render(el);
}

const customerLink = (item) => {
  const n = String(item.customer_id || '').split('/').pop();
  return n && state.byNumericId.get(n) ? html`<a href="#/customers/${n}">${item.customer_name}</a>` : html`${item.customer_name || item.to_address}`;
};

export function render(el) {
  if (!SERVER_FEATURES) {
    el.innerHTML = String(html`<div class="page"><div class="page-head"><div><p class="eyebrow">Email</p><h1 class="h1">Outbox</h1></div></div>
      <section class="card empty">${icon('inbox')}<strong class="strong">The outbox lives at trade.tapedup.co.uk</strong><span>Sending email needs the trade server, so approvals happen there.</span>
      <a class="btn btn--sm" href="${TRADE_SERVER}/#/outbox" target="_blank" rel="noopener">${icon('external-link', 'i--sm')}Open the outbox</a></section></div>`);
    return;
  }
  if (!ui.items && !ui.loading && !ui.error) { load(el); }
  const s = ui.status;
  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Email</p><h1 class="h1">Outbox</h1>
          ${s ? html`<p class="muted" style="margin:4px 0 0">${s.enabled ? html`Sending from <strong>${s.mailbox}</strong> · today ${s.sentToday.total}/${s.caps.totalPerDay} emails, ${s.sentToday.new}/${s.caps.newPerDay} new conversations` : 'Email is switched off on the server'}</p>` : ''}</div>
        <div class="page-head__actions"><button class="btn btn--outline" data-refresh>${icon('refresh-cw')}Refresh</button></div>
      </div>
      ${s && !s.enabled ? html`<div class="notice notice--warn">${icon('circle-alert')}<div><strong>Email is off.</strong> Drafts can be made and approved, but nothing sends until the trade@ mailbox is set up on the server (MS_MAILBOX and GRAPH_CLIENT_STATE in Coolify).</div></div>` : ''}
      ${s && s.enabled && !s.listening ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>Not listening for replies yet. The server sets this up within a few minutes of starting; if it stays, check the Entra app has Mail.ReadWrite.</div></div>` : ''}
      <div class="seg" role="group" aria-label="Show">${TABS.map(([key, name]) => html`<button type="button" data-tab="${key}" aria-pressed="${ui.tab === key ? 'true' : 'false'}">${name}${key === 'pending_approval' && s && s.pending ? ` (${s.pending})` : key === 'failed' && s && s.failed ? ` (${s.failed})` : ''}</button>`)}</div>
      ${ui.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div>`
        : !ui.items ? loadingBlock('Loading the outbox…')
        : !ui.items.length ? html`<section class="card empty">${icon('inbox')}<strong class="strong">${ui.tab === 'pending_approval' ? 'Nothing waiting for you' : 'Nothing here'}</strong><span>${ui.tab === 'pending_approval' ? 'Draft an email from a customer\'s page and it lands here for approval.' : ''}</span></section>`
        : html`<div class="stack">${ui.items.map((item) => html`
          <section class="card">
            <div class="card__head" style="align-items:flex-start">
              <div style="min-width:0">
                <div class="strong">${item.subject}</div>
                <div class="small muted">To ${customerLink(item)} &lt;${item.to_address}&gt; · ${item.is_reply ? 'reply in thread' : 'new email'}${item.first_touch ? ' · new conversation' : ''} · ${item.template_key === 'agent-reply' ? 'written by the agent' : item.template_key || 'custom'}</div>
                <div class="small muted">${item.status === 'sent' ? `Sent ${ago(item.sent_at)}` : `Drafted ${ago(item.created_at)} by ${item.created_by === 'agent' ? 'the agent' : item.created_by}`}${item.approved_by ? ` · approved by ${item.approved_by}` : ''}</div>
              </div>
              ${['pending_approval', 'approved', 'scheduled', 'failed'].includes(item.status) ? html`<div class="row row--wrap" style="gap:6px;justify-content:flex-end">
                ${item.status === 'pending_approval' ? html`<button class="btn btn--sm" data-approve="${item.id}">${icon('send', 'i--sm')}Approve and send</button>` : ''}
                ${item.status !== 'failed' ? html`<button class="btn btn--outline btn--sm" data-editd="${item.id}">${icon('pencil', 'i--sm')}Edit</button>` : ''}
                <button class="btn btn--ghost btn--sm" data-reject="${item.id}">Reject</button></div>` : ''}
            </div>
            ${item.agent_note ? html`<div class="notice notice--info" style="margin-bottom:12px">${icon('sparkles')}<div>${item.agent_note}</div></div>` : ''}
            ${item.error ? html`<div class="notice ${item.status === 'failed' ? 'notice--err' : 'notice--info'}" style="margin-bottom:12px">${icon('circle-alert')}<div>${item.error}</div></div>` : ''}
            <iframe class="email-frame" sandbox="" title="Email to ${item.customer_name || item.to_address}" data-frame="${item.id}"></iframe>
          </section>`)}</div>`}
    </div>`);

  // srcdoc set after render so the email HTML is never parsed as part of this page.
  (ui.items || []).forEach((item) => showEmail(el.querySelector(`[data-frame="${item.id}"]`), item.body_html));

  el.querySelector('[data-refresh]').addEventListener('click', () => { ui.items = null; render(el); });
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; ui.items = null; render(el); }));
  el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => busy(b, () => serverApi(`/api/outbox/${b.dataset.approve}/approve`, { method: 'POST', body: {} }))
    .then((r) => {
      const res = r.result || {};
      toast(res.sent ? 'Sent' : res.waiting ? `Approved: ${res.waiting}` : res.failed ? `Couldn't send: ${res.failed}` : 'Approved', res.failed ? 'err' : '');
      ui.items = null; render(el);
      window.dispatchEvent(new Event('outbox-changed'));
    }).catch(() => {})));
  el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => busy(b, () => serverApi(`/api/outbox/${b.dataset.reject}/reject`, { method: 'POST', body: {} }))
    .then(() => { toast('Rejected'); ui.items = null; render(el); window.dispatchEvent(new Event('outbox-changed')); }).catch(() => {})));
  el.querySelectorAll('[data-editd]').forEach((b) => b.addEventListener('click', () => openEdit(el, ui.items.find((i) => String(i.id) === b.dataset.editd))));
}

function openEdit(el, item) {
  openDrawer({
    title: 'Edit email', eyebrow: `To ${item.customer_name || item.to_address}`, wide: true,
    body: html`<div class="form">
      <label class="field"><span>Subject</span><input class="input" data-subject value="${item.subject}"></label>
      <label class="field"><span>Email</span><textarea class="textarea" data-body rows="14" style="line-height:1.55">${item.body_text}</textarea></label>
      <p class="muted small" style="margin:0">Fields in {curly brackets} are filled in again when you save. The signature and "reply STOP" line are added for you. Saving puts it back in the queue for approval.</p></div>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save changes</button>`,
    onMount: (d) => d.$('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, () => serverApi(`/api/outbox/${item.id}`, { method: 'PATCH', body: { subject: d.$('[data-subject]').value, bodyText: d.$('[data-body]').value } }))
      .then(() => { toast('Saved'); d.close(); ui.tab = 'pending_approval'; ui.items = null; render(el); }).catch(() => {})),
  });
}

