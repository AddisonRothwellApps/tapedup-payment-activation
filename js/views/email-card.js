// The Email card on a customer's page: their thread with trade@, drafts
// waiting in the outbox, and "draft from template". Loaded from the trade
// server, so it only works at trade.tapedup.co.uk; inside Shopify admin it
// links there instead.
import { html, icon, ago, toast, busy, loadingBlock } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { emailState, loadEmailTemplates } from '../email-templates.js';
import { stageOf } from '../store.js';
import { TRADE_SERVER } from '../env.js';

const cache = new Map(); // customer gid -> { data, at }
const STALE = 60_000;

async function fetchThread(c) {
  const data = await serverApi(`/api/threads?customerId=${encodeURIComponent(c.id)}`);
  cache.set(c.id, { data, at: Date.now() });
  return data;
}

export function emailCardShell() {
  return html`<section class="card" data-email-card><div class="card__head"><h2 class="h2">Email</h2></div><div data-email-body>${SERVER_FEATURES ? loadingBlock('Loading emails…') : ''}</div></section>`;
}

export async function mountEmailCard(card, c) {
  if (!card) return;
  const body = card.querySelector('[data-email-body]');
  if (!SERVER_FEATURES) {
    body.innerHTML = String(html`<p class="muted small" style="margin:0">Emails with this dealer, and drafting from templates, are at <a href="${TRADE_SERVER}/#/customers/${c.numericId}" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p>`);
    return;
  }
  const hit = cache.get(c.id);
  let data = hit && Date.now() - hit.at < STALE ? hit.data : null;
  try {
    if (!emailState.loaded) await loadEmailTemplates();
    if (!data) data = await fetchThread(c);
  } catch (err) {
    body.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${err.message}</div></div>`);
    return;
  }
  if (!card.isConnected) return;
  const stage = stageOf(c).stage;
  const usable = emailState.set.templates.filter((t) => t.active !== false);
  const suggested = usable.find((t) => t.stage === stage);
  const optedOut = !!(data.suppressed || c.crm.optOut);

  body.innerHTML = String(html`
    ${optedOut ? html`<div class="notice notice--warn" style="margin-bottom:12px">${icon('circle-alert')}<div>Opted out of email${data.suppressed ? ` (${data.suppressed.reason.replace(/-/g, ' ')}, ${ago(data.suppressed.at)})` : ''}. Nothing will be sent to them.</div></div>`
      : !emailState.saved ? html`<p class="muted small" style="margin:0 0 12px">Save the email <a href="#/templates">templates</a> once to start drafting.</p>`
      : html`<div class="row" style="gap:6px;margin-bottom:12px">
        <select class="select input--sm" data-tpl aria-label="Template">${usable.map((t) => html`<option value="${t.key}" ${suggested && t.key === suggested.key ? 'selected' : ''}>${t.name}${t.stage === stage ? ' (suggested)' : ''}</option>`)}</select>
        <button class="btn btn--sm" data-draft>${icon('pencil', 'i--sm')}Draft</button></div>`}
    ${data.drafts.length ? html`<div class="list" style="margin-bottom:12px">${data.drafts.map((d) => html`
      <a class="list__item" href="#/outbox" style="text-decoration:none"><span class="tl__icon">${icon(d.status === 'failed' ? 'circle-alert' : 'clock', 'i--sm')}</span>
        <span class="list__main"><span class="strong">${d.subject}</span><span class="small muted">${d.status === 'pending_approval' ? 'Waiting for your approval' : d.status === 'failed' ? 'Failed: see the outbox' : 'Queued to send'} · ${ago(d.created_at)}</span></span></a>`)}</div>` : ''}
    ${data.messages.length ? html`<div class="timeline">${data.messages.map((m) => html`
      <div class="tl"><span class="tl__icon">${icon(m.direction === 'out' ? 'send' : 'mail', 'i--sm')}</span>
        <div class="tl__body"><div class="tl__meta"><span class="strong">${m.direction === 'out' ? 'Sent' : 'Received'}</span><span>${ago(m.sent_at)}${m.auto_reply ? ' · auto-reply' : ''}${m.classification === 'opt-out' ? ' · opted out' : ''}</span></div>
          <div class="small strong">${m.subject}</div>
          <div class="tl__text small email-excerpt">${String(m.body_text || '').split(/\n\s*(On .+ wrote:|From:|-----Original)/)[0].trim().slice(0, 400)}</div></div></div>`)}</div>`
      : html`<p class="muted small" style="margin:0">No emails with this dealer yet.</p>`}`);

  const draft = body.querySelector('[data-draft]');
  if (draft) draft.addEventListener('click', () => {
    const key = body.querySelector('[data-tpl]').value;
    busy(draft, () => serverApi('/api/outbox', { method: 'POST', body: { customerId: c.id, templateKey: key } }))
      .then(() => { toast('Draft added to the outbox for approval'); cache.delete(c.id); mountEmailCard(card, c); window.dispatchEvent(new Event('outbox-changed')); })
      .catch(() => {});
  });
}
