// Products: every product and size with its stock, what it costs us, our
// trade and retail price and the margin on each, plus who supplies it.
// Retail prices, titles and stock come from Shopify (edit them there);
// costs, trade prices and supplier details are kept on the trade server.
// A cost change starts from a date, so older orders keep their old cost.
import { html, raw, icon, money, count, fmtDate, toast, busy, armed, openDrawer, loadingBlock, adminUrl } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';

const ui = { tab: 'products', q: '', all: false, items: null, suppliers: null, loading: false, error: '' };
const sizeKey = (t) => String(t || '').replace(/[()\s]/g, '').toLowerCase();
const pctTxt = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
const marginClass = (p) => (p == null ? 'muted' : p < 0 ? 'margin--bad' : p < 0.3 ? 'margin--low' : 'margin--ok');
const today = () => new Date().toLocaleDateString('en-CA');

async function load(el) {
  if (ui.loading) return;
  ui.loading = true; ui.error = '';
  try {
    const [p, s] = await Promise.all([serverApi('/api/products'), serverApi('/api/suppliers')]);
    ui.items = p.items; ui.suppliers = s.items;
  } catch (err) { ui.error = err.message; }
  ui.loading = false;
  render(el);
}

export const variants = () => (ui.items || []).flatMap((p) => p.variants.map((v) => ({ ...v, product: p })));

export function render(el) {
  if (!SERVER_FEATURES) { el.innerHTML = String(html`<div class="page"><div class="notice notice--info">${icon('info')}<div>Products need the trade server: open Trade Hub at trade.tapedup.co.uk.</div></div></div>`); return; }
  if (!ui.items && !ui.loading && !ui.error) load(el);
  const vs = variants();
  const live = vs.filter((v) => v.product.status === 'ACTIVE');
  const stockValue = live.reduce((a, v) => a + (v.stockValue || 0), 0);
  const units = live.reduce((a, v) => a + Math.max(0, v.stock || 0), 0);
  const noCost = live.filter((v) => v.cost == null).length;
  const low = live.filter((v) => v.low).length;

  el.innerHTML = String(html`
    <div class="page page--wide">
      <div class="page-head">
        <div><p class="eyebrow">Stock and costs</p><h1 class="h1">Products</h1>
          <p class="muted" style="margin:4px 0 0">Costs, trade prices and suppliers live here. Retail prices, titles and stock come from Shopify.</p></div>
        <div class="page-head__actions row row--wrap">
          <a class="btn btn--outline btn--sm" href="#/margins">${icon('chart-pie', 'i--sm')}Margins</a>
          <button class="btn btn--ghost btn--sm" data-refresh>${icon('refresh-cw', 'i--sm')}Refresh</button>
        </div>
      </div>
      ${ui.items ? html`<div class="stats" style="margin-bottom:20px">
        <div class="stat"><span class="stat__label">Stock at cost</span><span class="stat__value">${money(stockValue)}</span><span class="stat__sub">${count(units)} units in stock, active products</span></div>
        <div class="stat"><span class="stat__label">Products and sizes</span><span class="stat__value">${count(live.length)}</span><span class="stat__sub">${ui.items.filter((p) => p.status === 'ACTIVE').length} active products</span></div>
        <div class="stat"><span class="stat__label">Low stock</span><span class="stat__value ${low ? 'margin--low' : ''}">${count(low)}</span><span class="stat__sub">At or below their reorder level</span></div>
        <div class="stat"><span class="stat__label">No cost entered</span><span class="stat__value ${noCost ? 'margin--bad' : ''}">${count(noCost)}</span><span class="stat__sub">${noCost ? 'Margins skip orders with these' : 'Every active size has a cost'}</span></div>
      </div>` : ''}
      <div class="tabs" role="tablist" style="margin-bottom:16px">
        <button role="tab" data-tab="products" aria-selected="${String(ui.tab === 'products')}">Products</button>
        <button role="tab" data-tab="suppliers" aria-selected="${String(ui.tab === 'suppliers')}">Suppliers${ui.suppliers ? ` (${ui.suppliers.length})` : ''}</button>
      </div>
      ${ui.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div>`
        : !ui.items ? loadingBlock('Loading products from Shopify…')
        : ui.tab === 'products' ? productsTab() : suppliersTab()}
    </div>`);

  el.querySelector('[data-refresh]').addEventListener('click', () => { ui.items = null; render(el); });
  el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; render(el); }));
  const q = el.querySelector('[data-q]');
  if (q) q.addEventListener('input', () => { ui.q = q.value; const pos = q.selectionStart; render(el); const a = el.querySelector('[data-q]'); a.focus(); a.setSelectionRange(pos, pos); });
  const all = el.querySelector('[data-all]');
  if (all) all.addEventListener('change', () => { ui.all = all.checked; render(el); });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editVariant(el, b.dataset.edit)));
  el.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => editSupplier(el, b.dataset.sup ? Number(b.dataset.sup) : null)));
}

function productsTab() {
  const term = ui.q.trim().toLowerCase();
  const list = ui.items.filter((p) => (ui.all || p.status === 'ACTIVE')
    && (!term || [p.title, ...p.variants.flatMap((v) => [v.sku, v.title, v.supplier])].some((x) => String(x || '').toLowerCase().includes(term))));
  return html`
    <div class="row row--wrap" style="gap:12px;margin-bottom:12px">
      <input class="input input--sm" type="search" placeholder="Search products, SKUs, suppliers" value="${ui.q}" data-q aria-label="Search products" style="width:280px;max-width:100%">
      <label class="check"><input type="checkbox" data-all ${ui.all ? raw('checked') : ''}><span>Show drafts and archived</span></label>
    </div>
    <section class="card" style="padding:0">
      <div class="table-wrap"><table class="table products-table">
        <thead><tr><th>Size / variant</th><th>SKU</th><th class="num">Stock</th><th class="num">Cost</th><th class="num">Trade</th><th class="num">Retail</th>
          <th class="num" title="Profit per unit at our trade price">Trade profit</th><th class="num" title="Our margin selling at trade price">Trade margin</th><th class="num" title="Our margin selling at retail on our website">Retail margin</th><th class="num" title="What a dealer makes buying at trade and selling at retail, on the shelf price before VAT">Dealer margin</th><th>Supplier</th><th><span class="visually-hidden">Edit</span></th></tr></thead>
        <tbody>${list.length ? list.map((p) => html`
          <tr class="products-table__product"><td colspan="12"><div class="row" style="gap:10px">
            ${p.image ? html`<img src="${p.image}" alt="" width="32" height="32" class="products-table__img" loading="lazy">` : html`<span class="products-table__img">${icon('package', 'i--sm')}</span>`}
            <span class="strong">${p.title}</span>${p.status !== 'ACTIVE' ? html`<span class="badge">${p.status.toLowerCase()}</span>` : ''}
            <a class="small muted" href="${adminUrl(`products/${p.id.split('/').pop()}`)}" target="_blank" rel="noopener" title="Edit retail price, stock and photos in Shopify">Shopify ${icon('external-link', 'i--sm')}</a></div></td></tr>
          ${p.variants.map((v) => html`<tr>
            <td>${v.title || '—'}${v.notes ? html` <span class="muted" title="${v.notes}">${icon('notebook-pen', 'i--sm')}</span>` : ''}</td>
            <td class="small muted">${v.sku || '—'}</td>
            <td class="num ${v.low ? 'margin--low strong' : ''}" title="${v.low ? `At or below the reorder level (${v.reorderAt})` : ''}">${v.stock == null ? 'Not tracked' : count(v.stock)}${v.low ? html` ${icon('triangle-alert', 'i--sm')}` : ''}</td>
            <td class="num">${v.cost == null ? html`<span class="margin--bad small">Not set</span>` : money(v.cost)}</td>
            <td class="num">${v.trade == null ? html`<span class="muted">—</span>` : money(v.trade)}</td>
            <td class="num">${money(v.retail)}</td>
            <td class="num">${v.tradeProfit == null ? '—' : money(v.tradeProfit)}</td>
            <td class="num ${marginClass(v.tradeMargin)}">${pctTxt(v.tradeMargin)}</td>
            <td class="num ${marginClass(v.retailMargin)}">${pctTxt(v.retailMargin)}</td>
            <td class="num">${pctTxt(v.dealerMargin)}</td>
            <td class="small">${v.supplier || html`<span class="muted">—</span>`}</td>
            <td><button class="btn btn--ghost btn--sm" data-edit="${v.id}" aria-label="Edit ${p.title} ${v.title}">${icon('pencil', 'i--sm')}Edit</button></td>
          </tr>`)}`) : html`<tr><td colspan="12" class="muted">No products match.</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function editVariant(el, id) {
  const v = variants().find((x) => x.id === id);
  if (!v) return;
  const same = variants().filter((x) => x.id !== v.id && v.title && sizeKey(x.title) === sizeKey(v.title) && x.product.status === v.product.status);
  const supOpts = (ui.suppliers || []).map((s) => html`<option value="${s.id}" ${s.id === v.supplierId ? raw('selected') : ''}>${s.name}</option>`);
  const d = openDrawer({
    title: `${v.product.title}${v.title ? ` · ${v.title}` : ''}`, eyebrow: v.sku || 'Product',
    body: html`<form class="form" data-form>
      <div class="notice notice--info">${icon('info')}<div>Retail price <strong>${money(v.retail)}</strong> and stock <strong>${v.stock == null ? 'not tracked' : count(v.stock)}</strong> come from Shopify. Change them in <a href="${adminUrl(`products/${v.product.id.split('/').pop()}`)}" target="_blank" rel="noopener">Shopify admin</a>.</div></div>
      <div class="form-row">
        <label class="field"><span>Cost per unit (£)</span><input class="input" data-f="cost" type="number" step="0.0001" min="0" value="${v.cost ?? ''}" placeholder="Landed cost"></label>
        <label class="field"><span>Cost applies from</span><input class="input" data-f="costFrom" type="date" value="${today()}"></label>
        <label class="field"><span>Trade price (£)</span><input class="input" data-f="trade" type="number" step="0.01" min="0" value="${v.trade ?? ''}"></label>
      </div>
      <p class="small muted" style="margin:-8px 0 0">Include shipping and duty from the supplier in the cost, so it's what one unit really costs you. A new cost only changes orders from its date onwards.</p>
      <div class="margin-preview" data-preview></div>
      <div class="form-row">
        <label class="field"><span>Supplier</span><select class="select" data-f="supplierId"><option value="">None</option>${supOpts}<option value="new">New supplier…</option></select></label>
        <label class="field"><span>Supplier's code</span><input class="input" data-f="supplierSku" value="${v.supplierSku}"></label>
      </div>
      <label class="field" data-newsup hidden><span>New supplier's name</span><input class="input" data-newname placeholder="e.g. the factory's name"></label>
      <div class="form-row">
        <label class="field"><span>Minimum order</span><input class="input" data-f="moq" type="number" min="0" step="1" value="${v.moq ?? ''}" placeholder="Units"></label>
        <label class="field"><span>Lead time (days)</span><input class="input" data-f="leadDays" type="number" min="0" step="1" value="${v.leadDays ?? ''}"></label>
        <label class="field"><span>Reorder at</span><input class="input" data-f="reorderAt" type="number" min="0" step="1" value="${v.reorderAt ?? ''}" placeholder="Stock level"></label>
      </div>
      <label class="field"><span>Notes</span><textarea class="input" data-f="notes" rows="3" placeholder="Print run, colours, packaging, anything useful">${v.notes}</textarea></label>
      ${same.length ? html`<label class="check"><input type="checkbox" data-same><span>Also set the cost, trade price and supplier on the other ${same.length} <strong>${v.title}</strong> product${same.length === 1 ? '' : 's'}</span></label>` : ''}
      ${v.costHistory.length ? html`<div><p class="label" style="margin:0 0 6px">Cost history</p><ul class="small plain-list">${v.costHistory.map((h) => html`<li>${money(h.cost)} from ${fmtDate(h.from)}</li>`)}</ul></div>` : ''}
    </form>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save</button><button class="btn btn--ghost" data-close>Cancel</button>`,
    onMount: ({ $, $$, close }) => {
      const val = (k) => $(`[data-f="${k}"]`).value;
      const preview = () => {
        const cost = val('cost') === '' ? null : Number(val('cost'));
        const trade = val('trade') === '' ? null : Number(val('trade'));
        const m = (price) => (cost == null || !price ? '—' : `${money(price - cost)} a unit · ${pctTxt((price - cost) / price)}`);
        $('[data-preview]').innerHTML = String(html`<div class="small"><div><span class="muted">At trade:</span> ${m(trade)}</div><div><span class="muted">At retail:</span> ${m(v.retail)}</div>${trade ? html`<div><span class="muted">Dealer makes:</span> ${money(v.retail / 1.2 - trade)} a unit before VAT · ${pctTxt((v.retail / 1.2 - trade) / (v.retail / 1.2))}</div>` : ''}</div>`);
      };
      $$('[data-f="cost"], [data-f="trade"]').forEach((i) => i.addEventListener('input', preview));
      preview();
      $('[data-f="supplierId"]').addEventListener('change', (e) => { $('[data-newsup]').hidden = e.target.value !== 'new'; });
      $('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        let supplierId = val('supplierId');
        if (supplierId === 'new') {
          const name = $('[data-newname]').value.trim();
          if (!name) throw new Error('Give the new supplier a name');
          supplierId = (await serverApi('/api/suppliers', { method: 'POST', body: { name } })).item.id;
        }
        const body = { variantId: v.id, productId: v.product.id, supplierId: supplierId || null };
        for (const k of ['cost', 'costFrom', 'trade', 'supplierSku', 'moq', 'leadDays', 'reorderAt', 'notes']) body[k] = val(k);
        await serverApi('/api/products/update', { method: 'POST', body });
        const also = $('[data-same]');
        if (also && also.checked) {
          await serverApi('/api/products/bulk', { method: 'POST', body: { items: same.map((x) => ({ variantId: x.id, productId: x.product.id, cost: body.cost, costFrom: body.costFrom, trade: body.trade, supplierId: body.supplierId })) } });
        }
        toast(`Saved${also && also.checked ? ` on ${same.length + 1} products` : ''}`);
        close(); ui.items = null; ui.suppliers = null; render(el);
      }).catch(() => {}));
    },
  });
  return d;
}

function suppliersTab() {
  return html`
    <div class="row" style="margin-bottom:12px"><button class="btn btn--sm" data-sup="">${icon('plus', 'i--sm')}Add supplier</button></div>
    ${ui.suppliers.length ? html`<div class="grid grid--2">${ui.suppliers.map((s) => html`
      <section class="card">
        <div class="card__head"><h2 class="h2">${s.name}</h2><button class="btn btn--ghost btn--sm" data-sup="${s.id}">${icon('pencil', 'i--sm')}Edit</button></div>
        <dl class="kv small">
          ${s.contact ? html`<dt>Contact</dt><dd>${s.contact}</dd>` : ''}
          ${s.email ? html`<dt>Email</dt><dd><a href="mailto:${s.email}">${s.email}</a></dd>` : ''}
          ${s.phone ? html`<dt>Phone</dt><dd>${s.phone}</dd>` : ''}
          ${s.website ? html`<dt>Website</dt><dd><a href="${/^https?:/.test(s.website) ? s.website : `https://${s.website}`}" target="_blank" rel="noopener">${s.website}</a></dd>` : ''}
          <dt>Currency</dt><dd>${s.currency}</dd>
          <dt>Products</dt><dd>${s.products}</dd>
        </dl>
        ${s.notes ? html`<p class="small" style="white-space:pre-wrap;margin:10px 0 0">${s.notes}</p>` : ''}
      </section>`)}</div>`
    : html`<section class="card empty">${icon('factory')}<strong class="strong">No suppliers yet</strong><span>Add who makes your tape, then pick them on each product.</span></section>`}`;
}

function editSupplier(el, id) {
  const s = id ? ui.suppliers.find((x) => x.id === id) : { name: '', contact: '', email: '', phone: '', website: '', currency: 'GBP', notes: '' };
  const f = (k, label, type = 'text') => html`<label class="field"><span>${label}</span><input class="input" type="${type}" data-s="${k}" value="${s[k] || ''}"></label>`;
  openDrawer({
    title: id ? s.name : 'New supplier', eyebrow: 'Supplier',
    body: html`<form class="form">${f('name', 'Name')}<div class="form-row">${f('contact', 'Contact')}${f('phone', 'Phone')}</div>
      <div class="form-row">${f('email', 'Email', 'email')}${f('website', 'Website')}</div>
      <label class="field"><span>Currency they invoice in</span><select class="select" data-s="currency">${['GBP', 'USD', 'EUR', 'CNY'].map((c) => html`<option ${c === s.currency ? raw('selected') : ''}>${c}</option>`)}</select></label>
      <label class="field"><span>Notes</span><textarea class="input" rows="4" data-s="notes" placeholder="Payment terms, shipping, who to ask for">${s.notes || ''}</textarea></label></form>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save</button>${id ? html`<button class="btn btn--ghost" data-del>Delete</button>` : ''}<button class="btn btn--ghost" data-close>Cancel</button>`,
    onMount: ({ $, $$, close }) => {
      $('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const body = Object.fromEntries($$('[data-s]').map((i) => [i.dataset.s, i.value]));
        await serverApi(id ? `/api/suppliers/${id}` : '/api/suppliers', { method: id ? 'PATCH' : 'POST', body });
        toast('Supplier saved'); close(); ui.suppliers = null; ui.items = null; render(el);
      }).catch(() => {}));
      const del = $('[data-del]');
      if (del) armed(del, () => busy(del, async () => { await serverApi(`/api/suppliers/${id}`, { method: 'DELETE' }); toast('Supplier deleted'); close(); ui.items = null; render(el); }).catch(() => {}), 'Click again: delete');
    },
  });
}
