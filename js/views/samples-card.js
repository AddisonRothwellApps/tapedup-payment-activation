// "Samples & account" on a customer's page: the free sample pack (a
// completed £0 order that lands in the pick/pack queue) and opening their
// trade account. When they reply with an address the agent puts the sample
// order through by itself; the button here is for addresses that came in
// another way (phone, in person). Runs on the trade
// server, so only at trade.tapedup.co.uk.
import { html, icon, money, fmtDate, toast, openDrawer, busy, armed, loadingBlock } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { isDealer, refreshCustomer, label } from '../store.js';
import { TRADE_SERVER } from '../env.js';

export function samplesCardShell() {
  return html`<section class="card" data-samples-card><div class="card__head"><h2 class="h2">Samples and account</h2></div><div data-samples-body>${SERVER_FEATURES ? loadingBlock('Checking samples…') : ''}</div></section>`;
}

const changed = (c) => { window.dispatchEvent(new Event('outbox-changed')); return refreshCustomer(c.id); };

export async function mountSamplesCard(card, c) {
  if (!card) return;
  const body = card.querySelector('[data-samples-body]');
  if (!SERVER_FEATURES) {
    body.innerHTML = String(html`<p class="muted small" style="margin:0">Free samples and opening trade accounts are at <a href="${TRADE_SERVER}/#/customers/${c.numericId}" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p>`);
    return;
  }
  let s;
  try { s = await serverApi(`/api/samples?customerId=${encodeURIComponent(c.id)}`); } catch (err) {
    body.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${err.message}</div></div>`);
    return;
  }
  if (!card.isConnected) return;
  const had = s.samples[0];
  const optedOut = !!c.crm.optOut;
  body.innerHTML = String(html`
    ${had ? html`<div class="list" style="margin-bottom:12px">${s.samples.map((x) => html`
      <div class="list__item"><span class="tl__icon">${icon(x.kind === 'order' ? 'package' : 'ticket', 'i--sm')}</span>
        <span class="list__main"><span class="strong">${x.kind === 'order' ? `Sample order ${x.order_name}` : `Old sample code ${x.code}`}</span>
        <span class="small muted">${money(Number(x.value_gbp))} retail · ${fmtDate(x.created_at)} · ${x.created_by}</span></span></div>`)}</div>`
      : !s.configured ? html`<p class="muted small" style="margin:0 0 12px">Choose what goes in a sample pack on the <a href="#/setup">Setup</a> screen first.</p>`
      : optedOut ? html`<p class="muted small" style="margin:0 0 12px">Opted out, so no samples.</p>`
      : html`<div class="row row--wrap" style="gap:6px;margin-bottom:6px">
          <button class="btn btn--sm" data-send-sample>${icon('package', 'i--sm')}Send sample pack</button></div>
        <p class="muted small" style="margin:0 0 12px">Sent automatically when they reply with an address. One per business and per address.${s.monthlyCapGBP ? ` ${money(s.spentThisMonth)} of the ${money(s.monthlyCapGBP)} monthly cap used.` : ''}</p>`}
    ${isDealer(c) ? html`<p class="muted small" style="margin:0">${icon('check', 'i--sm')} Trade account open: they see trade prices when signed in.</p>`
      : html`<button class="btn btn--sm btn--outline" data-open>${icon('store', 'i--sm')}Open trade account</button>
        <p class="muted small" style="margin:6px 0 0">Tags them "b2b" for trade pricing, moves them to Account opened and drafts the walkthrough email for your approval.</p>`}`);

  const send = body.querySelector('[data-send-sample]');
  if (send) send.addEventListener('click', () => openSampleForm(c, () => mountSamplesCard(card, c)));

  const open = body.querySelector('[data-open]');
  if (open) armed(open, () => busy(open, () => serverApi('/api/accounts/open', { method: 'POST', body: { customerId: c.id } }))
    .then((r) => { toast(r.draft ? 'Trade account opened. Walkthrough email is in the outbox.' : `Trade account opened.${r.draftError ? ` Couldn't draft the email: ${r.draftError}` : ''}`); return changed(c); })
    .catch(() => {}), 'Click again: gives trade pricing');
}

function openSampleForm(c, done) {
  const [first, ...rest] = String(c.crm.profile.contact || c.name || '').split(/\s+/);
  const a = c.crm.profile.address && typeof c.crm.profile.address === 'object' ? c.crm.profile.address : {};
  const f = (key, labelText, value, extra = '') => html`<label class="field"><span>${labelText}</span><input class="input" data-a="${key}" value="${value || ''}" ${extra}></label>`;
  openDrawer({
    title: `Sample pack for ${label(c)}`, eyebrow: 'Free trade sample',
    body: html`<div class="form">
      <p class="muted small" style="margin:0">Creates a £0 order tagged "trade-sample" in Shopify, so it shows up with the day's orders to pick and pack. Delivery is free.</p>
      <div class="form-row">${f('firstName', 'First name', c.firstName || first)}${f('lastName', 'Last name', c.lastName || rest.join(' '))}</div>
      ${f('company', 'Company', label(c))}
      ${f('address1', 'Address', a.address1 || '', 'autocomplete="address-line1"')}
      ${f('address2', 'Address line 2 (optional)', a.address2 || '')}
      <div class="form-row">${f('city', 'Town', a.city || c.city)}${f('zip', 'Postcode', a.zip || '', 'autocomplete="postal-code"')}</div>
      ${f('phone', 'Phone (optional, for the courier)', c.phone)}
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-go>${icon('package', 'i--sm')}Create sample order</button>`,
    onMount: (d) => {
      d.$('[data-go]').addEventListener('click', (e) => {
        const address = Object.fromEntries(d.$$('[data-a]').map((i) => [i.dataset.a, i.value.trim()]));
        busy(e.currentTarget, () => serverApi('/api/samples/order', { method: 'POST', body: { customerId: c.id, address } }))
          .then((r) => { toast(`Sample order ${r.order.name} created`); d.close(); return changed(c).then(done); })
          .catch(() => {});
      });
    },
  });
}
