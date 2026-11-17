// Margins: what each order actually made after product costs, discounts,
// payment fees, postage and packaging, and the totals for any date range.
// Samples are free, so they're shown as a cost of winning dealers rather than
// dragging down the margin on sales. Every order can carry its own postage,
// box or other cost when it differs from the defaults.
import { html, raw, icon, money, count, fmtDate, toast, busy, openDrawer, loadingBlock, adminUrl } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';

const iso = (d) => d.toLocaleDateString('en-CA');
const PRESETS = [
  ['month', 'This month', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(n)]; }],
  ['last-month', 'Last month', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), iso(new Date(n.getFullYear(), n.getMonth(), 0))]; }],
  ['30', 'Last 30 days', () => { const n = new Date(); return [iso(new Date(n - 29 * 864e5)), iso(n)]; }],
  ['90', 'Last 90 days', () => { const n = new Date(); return [iso(new Date(n - 89 * 864e5)), iso(n)]; }],
  ['year', 'This year', () => { const n = new Date(); return [iso(new Date(n.getFullYear(), 0, 1)), iso(n)]; }],
];
const TYPES = [['all', 'All sales'], ['trade', 'Trade'], ['retail', 'Retail']];
const TYPE_LABEL = { trade: 'Trade', retail: 'Retail', sample: 'Sample' };

const ui = { preset: '30', from: '', to: '', type: 'all', data: null, key: '', errKey: '', loading: false, error: '', view: 'orders', showSamples: false };
if (!ui.from) [ui.from, ui.to] = PRESETS[2][2]();

const pctTxt = (p) => (p == null ? '—' : `${(p * 100).toFixed(1)}%`);
const marginClass = (p) => (p == null ? 'muted' : p < 0 ? 'margin--bad' : p < 0.3 ? 'margin--low' : 'margin--ok');
const neg = (n) => (n ? `−${money(n)}` : money(0));

async function load(el) {
  const key = `${ui.from}|${ui.to}|${ui.type}`;
  if (ui.loading === key) return;
  ui.loading = key;
  try {
    const d = await serverApi(`/api/margins?from=${ui.from}&to=${ui.to}&type=${ui.type}`);
    if (ui.loading !== key) return; // the range changed while this loaded
    ui.data = d; ui.key = key; ui.error = ''; ui.errKey = '';
  } catch (err) {
    if (ui.loading !== key) return;
    ui.error = err.message; ui.errKey = key;
  }
  ui.loading = false;
  render(el);
}

export function render(el) {
  if (!SERVER_FEATURES) { el.innerHTML = String(html`<div class="page"><div class="notice notice--info">${icon('info')}<div>Margins need the trade server: open Trade Hub at trade.tapedup.co.uk.</div></div></div>`); return; }
  const key = `${ui.from}|${ui.to}|${ui.type}`;
  if (ui.key !== key && ui.loading !== key && ui.errKey !== key) load(el);
  const d = ui.key === key ? ui.data : null;
  const t = d && d.summary;
  const c = t && t.costed; // orders whose costs are all known

  el.innerHTML = String(html`
    <div class="page page--wide">
      <div class="page-head">
        <div><p class="eyebrow">Products</p><h1 class="h1">Margins</h1>
          <p class="muted" style="margin:4px 0 0">Every order after product cost, discounts, payment fees, postage and packaging.</p></div>
        <div class="page-head__actions row row--wrap">
          <a class="btn btn--outline btn--sm" href="#/products">${icon('package', 'i--sm')}Products and costs</a>
          <button class="btn btn--outline btn--sm" data-settings>${icon('settings', 'i--sm')}Postage, boxes and fees</button>
        </div>
      </div>
      <div class="row row--wrap margins-range" style="gap:12px;margin-bottom:16px;align-items:flex-end">
        <div class="seg" role="group" aria-label="Period">${PRESETS.map(([k, l]) => html`<button type="button" data-preset="${k}" aria-pressed="${String(ui.preset === k)}">${l}</button>`)}</div>
        <label class="field"><span>From</span><input class="input input--sm" type="date" data-from value="${ui.from}" max="${ui.to}"></label>
        <label class="field"><span>To</span><input class="input input--sm" type="date" data-to value="${ui.to}" min="${ui.from}"></label>
        <div class="seg" role="group" aria-label="Sales">${TYPES.map(([k, l]) => html`<button type="button" data-type="${k}" aria-pressed="${String(ui.type === k)}">${l}</button>`)}</div>
      </div>
      ${ui.error && ui.errKey === key ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div>`
        : !d ? loadingBlock('Working out the margins…')
        : html`
        ${t.incomplete ? html`<div class="notice notice--info" style="margin-bottom:16px">${icon('info')}<div>${incompleteText(d)}</div></div>` : ''}
        <div class="stats" style="margin-bottom:20px">
          <div class="stat"><span class="stat__label">Net sales</span><span class="stat__value">${money(t.net)}</span><span class="stat__sub">${count(t.orders)} orders · avg ${money(t.aov)}</span></div>
          <div class="stat"><span class="stat__label">Gross profit</span><span class="stat__value">${c.orders ? money(c.net - c.cogs) : '—'}</span><span class="stat__sub"><span class="${marginClass(c.grossMargin)} strong">${pctTxt(c.grossMargin)}</span> after product cost${t.incomplete ? ` · ${c.orders} of ${t.orders} orders` : ''}</span></div>
          <div class="stat"><span class="stat__label">Profit</span><span class="stat__value ${c.profit < 0 ? 'margin--bad' : ''}">${c.orders ? money(c.profit) : '—'}</span><span class="stat__sub"><span class="${marginClass(c.margin)} strong">${pctTxt(c.margin)}</span> after fees, postage and boxes${t.incomplete ? ` · ${c.orders} of ${t.orders} orders` : ''}</span></div>
          <div class="stat"><span class="stat__label">Discounts given</span><span class="stat__value">${money(t.discounts)}</span><span class="stat__sub">${t.gross ? pctTxt(t.discounts / t.gross) : '—'} off full retail price</span></div>
          <div class="stat"><span class="stat__label">Samples sent</span><span class="stat__value">${money(d.samples.cost)}</span><span class="stat__sub">${count(d.samples.orders)} sample orders · ${count(d.samples.units)} rolls${d.samples.complete ? '' : ' · some costs missing'}</span></div>
        </div>
        <div class="grid grid--side" style="margin-bottom:20px">
          <section class="card">
            <div class="card__head"><h2 class="h2">P&amp;L</h2><span class="small muted">${fmtDate(d.from)} to ${fmtDate(d.to)}${t.incomplete ? ` · the ${c.orders} orders with costs` : ''}</span></div>
            ${c.orders ? pnl(c, d.samples) : html`<p class="muted small">Add product costs on <a href="#/products">Products</a> and the breakdown fills in.</p>`}
          </section>
          <section class="card">
            <div class="card__head"><h2 class="h2">Trade and retail</h2></div>
            ${['trade', 'retail'].map((k) => { const s = d.byType[k]; return html`<div class="split">
              <div class="row" style="justify-content:space-between"><span class="strong">${TYPE_LABEL[k]}</span><span class="small muted">${count(s.orders)} orders</span></div>
              <div class="row small" style="justify-content:space-between"><span>Net sales ${money(s.net)}</span><span>${s.costed.orders ? html`Profit ${money(s.costed.profit)} · <span class="${marginClass(s.costed.margin)} strong">${pctTxt(s.costed.margin)}</span>` : html`<span class="muted">Profit needs costs</span>`}</span></div>
            </div>`; })}
            ${ui.type !== 'all' ? html`<p class="small muted">Showing ${TYPE_LABEL[ui.type].toLowerCase()} only in the totals and tables.</p>` : ''}
          </section>
        </div>
        <div class="tabs" role="tablist" style="margin-bottom:12px">
          <button role="tab" data-view="orders" aria-selected="${String(ui.view === 'orders')}">Orders (${d.orders.filter((o) => o.type !== 'sample').length})</button>
          <button role="tab" data-view="products" aria-selected="${String(ui.view === 'products')}">By product (${d.products.length})</button>
        </div>
        ${ui.view === 'orders' ? ordersTable(d) : productsTable(d)}`}
    </div>`);

  el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = PRESETS.find((x) => x[0] === b.dataset.preset);
    ui.preset = p[0]; [ui.from, ui.to] = p[2](); render(el);
  }));
  const from = el.querySelector('[data-from]'); const to = el.querySelector('[data-to]');
  const custom = () => { if (from.value && to.value && from.value <= to.value) { ui.preset = ''; ui.from = from.value; ui.to = to.value; render(el); } };
  from.addEventListener('change', custom); to.addEventListener('change', custom);
  el.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => { ui.type = b.dataset.type; render(el); }));
  el.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { ui.view = b.dataset.view; render(el); }));
  const ss = el.querySelector('[data-samples]');
  if (ss) ss.addEventListener('change', () => { ui.showSamples = ss.checked; render(el); });
  el.querySelector('[data-settings]').addEventListener('click', () => settingsDrawer(el));
  el.querySelectorAll('[data-order]').forEach((r) => {
    const open = () => orderDrawer(el, d.orders.find((o) => o.id === r.dataset.order));
    r.addEventListener('click', open);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function incompleteText(d) {
  const left = d.orders.filter((o) => o.type !== 'sample' && !o.complete);
  const imported = left.filter((o) => o.imported).length;
  const products = [...new Set(left.flatMap((o) => o.missing))];
  return html`${left.length} order${left.length === 1 ? ' is' : 's are'} left out of the profit figures because a cost isn't known (sales and discounts still count them).
    ${imported ? html`${imported} ${imported === 1 ? 'is an imported invoice' : 'are imported invoices'} with no products listed. ` : ''}
    ${products.length ? html`No cost entered for: ${products.slice(0, 6).join(', ')}${products.length > 6 ? ` and ${products.length - 6} more` : ''}. <a href="#/products">Add costs</a>.` : ''}`;
}

/** A profit and loss statement for the orders in range. */
function pnl(t, samples) {
  const row = (label, value, cls = '', sub = '') => html`<div class="wf__row ${cls}"><span>${label}${sub ? html` <span class="small muted">${sub}</span>` : ''}</span><span class="num">${value}</span></div>`;
  const head = (label) => html`<div class="wf__head">${label}</div>`;
  const pc = (n, of) => (of ? pctTxt(n / of) : '');
  const revenue = t.net + t.shipping;
  const gross = revenue - t.cogs;
  const costs = t.postage + t.box + t.fees + t.other;
  const afterSamples = t.profit - (samples ? samples.cost : 0);
  return html`<div class="wf">
    ${head('Revenue')}
    ${row('Sales at full price', money(t.gross))}
    ${row('Discounts', neg(t.discounts), 'wf--minus', 'trade pricing, codes')}
    ${row('Net sales', money(t.net), 'wf--sub')}
    ${row('Postage charged to customers', money(t.shipping))}
    ${row('Total revenue', money(revenue), 'wf--total')}
    ${head('Cost of sales')}
    ${row('Product cost', neg(t.cogs), 'wf--minus', 'landed cost per roll at the time of each order')}
    ${row('Gross profit', money(gross), 'wf--total', pc(gross, revenue))}
    ${head('Selling costs')}
    ${row('Postage', neg(t.postage), 'wf--minus', t.postageEstimated ? `${t.postageEstimated} parcel${t.postageEstimated === 1 ? '' : 's'} at the large letter rate until parcel prices are set` : '')}
    ${row('Boxes and packaging', neg(t.box), 'wf--minus')}
    ${row('Payment fees', neg(t.fees), 'wf--minus')}
    ${t.other ? row('Other order costs', neg(t.other), 'wf--minus') : ''}
    ${row('Total selling costs', neg(costs), 'wf--sub')}
    ${row('Net profit', money(t.profit), `wf--total ${t.profit < 0 ? 'margin--bad' : ''}`, pc(t.profit, revenue))}
    ${samples && samples.orders ? html`
      ${row('Free samples sent', neg(samples.cost), 'wf--minus', `${samples.orders} sample pack${samples.orders === 1 ? '' : 's'}: tape, postage and packaging`)}
      ${row('Net profit after samples', money(afterSamples), `wf--total ${afterSamples < 0 ? 'margin--bad' : ''}`, pc(afterSamples, revenue))}` : ''}
  </div>`;
}

function ordersTable(d) {
  const list = d.orders.filter((o) => ui.showSamples || o.type !== 'sample');
  return html`
    <label class="check" style="margin-bottom:10px"><input type="checkbox" data-samples ${ui.showSamples ? raw('checked') : ''}><span>Include sample orders (${d.samples.orders})</span></label>
    <section class="card" style="padding:0"><div class="table-wrap"><table class="table">
      <thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Type</th><th class="num">Net sales</th><th class="num">Discount</th><th class="num">Cost</th><th class="num">Fees</th><th class="num">Postage + box</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
      <tbody>${list.length ? list.map((o) => html`<tr data-order="${o.id}" data-href tabindex="0" title="Open the margin report">
        <td class="small">${fmtDate(o.at)}</td><td class="strong">${o.name}</td><td class="small">${o.customer ? o.customer.name : '—'}</td>
        <td><span class="badge ${o.type === 'sample' ? 'badge--cyan' : ''}">${TYPE_LABEL[o.type]}</span></td>
        <td class="num">${money(o.net)}</td><td class="num small muted">${o.discounts ? money(o.discounts) : '—'}</td>
        <td class="num">${o.complete ? money(o.cogs) : html`<span class="margin--bad small" title="${o.imported ? 'Imported invoice: no products listed' : `No cost for ${o.missing.join(', ')}`}">Unknown</span>`}</td>
        <td class="num">${money(o.fees)}${o.feesEstimated ? '*' : ''}</td>
        <td class="num" title="${o.parcel || ''}${o.postageEstimated ? ': no price for this size yet, so the large letter rate is used' : ''}">${money(o.postage + o.box)}${o.postageEstimated ? '†' : ''}${o.overridden ? html` <span class="muted" title="Set on this order">${icon('pencil', 'i--sm')}</span>` : ''}</td>
        <td class="num strong ${o.complete && o.profit < 0 ? 'margin--bad' : ''}">${o.complete ? money(o.profit) : '—'}</td>
        <td class="num ${o.complete ? marginClass(o.margin) : 'muted'}">${o.complete ? pctTxt(o.margin) : '—'}</td></tr>`)
        : html`<tr><td colspan="11" class="muted">No orders in this range.</td></tr>`}</tbody>
    </table></div></section>
    ${list.some((o) => o.feesEstimated) ? html`<p class="small muted">* PayPal fee estimated from the rate in settings.</p>` : ''}
    ${list.some((o) => o.postageEstimated) ? html`<p class="small muted">† A parcel size with no postage price yet: the large letter rate is used. Set parcel prices under Postage, boxes and fees.</p>` : ''}`;
}

function productsTable(d) {
  return html`<section class="card" style="padding:0"><div class="table-wrap"><table class="table">
    <thead><tr><th>Product</th><th>Size</th><th class="num">Units</th><th class="num">Net sales</th><th class="num">Avg price</th><th class="num">Cost</th><th class="num">Gross profit</th><th class="num">Margin</th></tr></thead>
    <tbody>${d.products.length ? d.products.map((p) => html`<tr>
      <td class="strong">${p.title}</td><td class="small">${p.variant || '—'}</td><td class="num">${count(p.units)}</td><td class="num">${money(p.revenue)}</td>
      <td class="num">${money(p.avgPrice)}</td><td class="num">${p.cost == null ? html`<a class="margin--bad small" href="#/products">Add cost</a>` : money(p.cost)}</td>
      <td class="num">${p.profit == null ? '—' : money(p.profit)}</td><td class="num ${marginClass(p.margin)}">${pctTxt(p.margin)}</td></tr>`)
      : html`<tr><td colspan="8" class="muted">No product sales in this range.</td></tr>`}</tbody>
  </table></div></section>
  <p class="small muted">Gross profit is net sales less product cost, before fees, postage and boxes. Imported invoices have no products, so they aren't here.</p>`;
}

/** The margin report for one order, with its own postage, box and other costs. */
export function orderDrawer(el, o) {
  if (!o) return;
  const row = (label, value, cls = '') => html`<div class="wf__row ${cls}"><span>${label}</span><span class="num">${value}</span></div>`;
  const s = (ui.data && ui.data.settings) || { postage: {}, box: {} };
  openDrawer({
    title: `${o.name}${o.customer ? ` · ${o.customer.name}` : ''}`, eyebrow: `${TYPE_LABEL[o.type]} order · ${fmtDate(o.at)}`, wide: true,
    body: html`
      ${!o.complete ? html`<div class="notice notice--info">${icon('info')}<div>${o.imported ? 'This is an imported invoice with no products listed, so its product cost is unknown.' : html`No cost entered for ${o.missing.join(', ')}. <a href="#/products">Add it on Products</a> and this order's margin fills in.`}</div></div>` : ''}
      <div class="stats" style="margin:4px 0 16px">
        <div class="stat"><span class="stat__label">Profit</span><span class="stat__value ${o.profit < 0 ? 'margin--bad' : ''}">${o.complete ? money(o.profit) : '—'}</span></div>
        <div class="stat"><span class="stat__label">Margin</span><span class="stat__value ${marginClass(o.margin)}">${o.complete ? pctTxt(o.margin) : '—'}</span></div>
        <div class="stat"><span class="stat__label">Gross margin</span><span class="stat__value">${o.complete ? pctTxt(o.productMargin) : '—'}</span><span class="stat__sub">After product cost only</span></div>
      </div>
      <div class="wf" style="margin-bottom:16px">
        ${row('Full retail value', money(o.gross))}
        ${row('Discounts', neg(o.discounts), 'wf--minus')}
        ${row('Net sales', money(o.net), 'wf--total')}
        ${row('Postage charged', money(o.shipping))}
        ${row('Product cost', o.complete ? neg(o.cogs) : 'Unknown', 'wf--minus')}
        ${row(`Payment fees${o.feesEstimated ? ' (estimated)' : ''}`, neg(o.fees), 'wf--minus')}
        ${row(`Postage (${o.parcel || 'parcel'}, ${o.units} roll${o.units === 1 ? '' : 's'})${o.postageEstimated ? ' at the large letter rate' : ''}`, neg(o.postage), 'wf--minus')}
        ${row('Box and packaging', neg(o.box), 'wf--minus')}
        ${o.other ? row('Other', neg(o.other), 'wf--minus') : ''}
        ${row('Profit', o.complete ? money(o.profit) : '—', 'wf--total')}
      </div>
      ${o.lines.length ? html`<div class="table-wrap" style="margin-bottom:16px"><table class="table">
        <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Retail</th><th class="num">Paid each</th><th class="num">Cost each</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
        <tbody>${o.lines.map((l) => html`<tr><td>${l.title}${l.variant ? html`<div class="small muted">${l.variant}</div>` : ''}</td><td class="num">${l.qty}</td><td class="num">${money(l.retail)}</td>
          <td class="num">${money(l.unitPrice)}</td><td class="num">${l.unitCost == null ? html`<span class="margin--bad small">Not set</span>` : money(l.unitCost)}</td>
          <td class="num">${l.profit == null ? '—' : money(l.profit)}</td><td class="num ${marginClass(l.margin)}">${pctTxt(l.margin)}</td></tr>`)}</tbody></table></div>` : ''}
      <form class="form" data-costs>
        <p class="label" style="margin:0">This order's own costs <span class="small muted" style="text-transform:none;letter-spacing:0">(leave blank to use the default)</span></p>
        <div class="form-row">
          <label class="field"><span>Postage (£)</span><input class="input" type="number" min="0" step="0.01" data-c="postage" value="${o.overridden && o.overridden.postage ? o.postage : ''}" placeholder="${o.parcel || 'Default'}: ${money(o.overridden && o.overridden.postage ? 0 : o.postage)}"></label>
          <label class="field"><span>Box (£)</span><input class="input" type="number" min="0" step="0.01" data-c="box" value="${o.overridden && o.overridden.box ? o.box : ''}" placeholder="Default ${money(s.box[o.type] || 0)}"></label>
          <label class="field"><span>Other (£)</span><input class="input" type="number" min="0" step="0.01" data-c="other" value="${o.overridden && o.overridden.other ? o.other : ''}" placeholder="£0.00"></label>
        </div>
        <label class="field"><span>Note</span><input class="input" data-c="note" value="${(o.overridden && o.overridden.note) || ''}" placeholder="e.g. sent in two parcels"></label>
      </form>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save costs</button><a class="btn btn--ghost" href="${adminUrl(`orders/${o.id.split('/').pop()}`)}" target="_blank" rel="noopener">Open in Shopify</a><button class="btn btn--ghost" data-close>Close</button>`,
    onMount: ({ $, $$, close }) => {
      $('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const body = { orderId: o.id, ...Object.fromEntries($$('[data-c]').map((i) => [i.dataset.c, i.value])) };
        await serverApi('/api/margins/order', { method: 'POST', body });
        toast(`Saved costs for ${o.name}`); close(); ui.key = ''; render(el);
      }).catch(() => {}));
    },
  });
}

function settingsDrawer(el) {
  const s = (ui.data && ui.data.settings) || { bands: [], box: {}, paypal: {} };
  const inp = (group, k, val, step = '0.01') => html`<input class="input" type="number" min="0" step="${step}" data-g="${group}" data-k="${k}" value="${val ?? 0}">`;
  openDrawer({
    title: 'Postage, boxes and fees', eyebrow: 'Margins',
    body: html`<form class="form">
      <p class="label" style="margin:0">Postage by parcel size</p>
      <p class="small muted" style="margin:0">Each order's postage comes from how many rolls are in it. A band with no price uses the one above it until you set it. Any order can still have its own postage.</p>
      <div class="table-wrap"><table class="table" data-bands>
        <thead><tr><th>Parcel</th><th>Up to (rolls)</th><th>Postage (£)</th></tr></thead>
        <tbody>${(s.bands || []).map((b, i, all) => html`<tr>
          <td><input class="input input--sm" data-b="name" value="${b.name}"></td>
          <td>${i === all.length - 1 ? html`<span class="small muted">Anything bigger</span><input type="hidden" data-b="upTo" value="">` : html`<input class="input input--sm" type="number" min="1" step="1" data-b="upTo" value="${b.upTo ?? ''}">`}</td>
          <td><input class="input input--sm" type="number" min="0" step="0.01" data-b="cost" value="${b.cost ?? ''}" placeholder="Not set"></td></tr>`)}</tbody></table></div>
      <p class="label" style="margin:0">Per order</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th></th><th>Trade order</th><th>Retail order</th><th>Sample</th></tr></thead>
        <tbody>
          <tr><th scope="row">Box and packaging (£)</th><td>${inp('box', 'trade', s.box.trade)}</td><td>${inp('box', 'retail', s.box.retail)}</td><td>${inp('box', 'sample', s.box.sample)}</td></tr>
        </tbody></table></div>
      <div class="form-row">
        <label class="field"><span>PayPal fee (%)</span>${inp('paypal', 'pct', s.paypal.pct, '0.01')}</label>
        <label class="field"><span>PayPal fixed fee (£)</span>${inp('paypal', 'fixed', s.paypal.fixed)}</label>
      </div>
      <p class="small muted" style="margin:0">PayPal doesn't report its fees to Shopify, so they're estimated with these.</p>
    </form>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save</button><button class="btn btn--ghost" data-close>Cancel</button>`,
    onMount: ({ $, $$, close }) => {
      $('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const body = { box: {}, paypal: {} };
        $$('[data-g]').forEach((i) => { body[i.dataset.g][i.dataset.k] = i.value; });
        body.bands = $$('[data-bands] tbody tr').map((tr) => Object.fromEntries([...tr.querySelectorAll('[data-b]')].map((x) => [x.dataset.b, x.value])));
        await serverApi('/api/margins/settings', { method: 'PUT', body });
        toast('Saved'); close(); ui.key = ''; render(el);
      }).catch(() => {}));
    },
  });
}
