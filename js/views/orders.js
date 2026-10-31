// Trade orders: every synced order from a trade account (tagged "b2b"),
// with who placed it, what was in it and where it's up to. Only trade
// accounts' orders are synced (retail stays in Shopify's own Orders screen).
// Fulfilling, refunding and editing stay in Shopify's own order screen, one
// click away.
import { state, hasAllOrders, label, sublabel, orderSummary } from '../store.js';
import { html, icon, money, fmtDate, adminUrl } from '../ui.js';

const ui = { q: '', status: 'all', limit: 100, open: new Set() };
const STATUSES = [['all', 'All'], ['unfulfilled', 'To fulfil'], ['unpaid', 'Unpaid'], ['cancelled', 'Cancelled']];
const pretty = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const UNPAID = ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID', 'EXPIRED'];

function rows() {
  const q = ui.q.trim().toLowerCase();
  return state.orders.filter((o) => {
    if (o.test) return false;
    const c = state.byNumericId.get(o.cust);
    if (!c) return false;
    if (ui.status === 'unfulfilled' && (o.x || !['UNFULFILLED', 'PARTIALLY_FULFILLED', 'IN_PROGRESS', 'ON_HOLD', 'SCHEDULED'].includes(o.ful))) return false;
    if (ui.status === 'unpaid' && (o.x || !UNPAID.includes(o.pay))) return false;
    if (ui.status === 'cancelled' && !o.x) return false;
    if (q && !`${o.name} ${c ? `${c.name} ${c.company} ${c.email}` : ''} ${o.lines.map((l) => l[0]).join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function render(el) {
  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Trade accounts · since ${fmtDate(state.ordersWindowStart)}</p><h1 class="h1">Trade orders</h1></div>
        <div class="page-head__actions"><a class="btn btn--outline" href="${adminUrl('orders')}" target="_top">${icon('external-link')}Orders in Shopify</a></div>
      </div>
      ${!hasAllOrders() ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>Shopify only lets this app see the last 60 days of orders until it has the "read all orders" permission. See <a href="#/setup">Setup</a>.</div></div>` : ''}
      <div class="filters">
        <div class="input-affix" style="flex:1;min-width:220px;max-width:420px">${icon('search', 'i--sm')}<input class="input" type="search" placeholder="Order number, customer or product" value="${ui.q}" data-q aria-label="Search orders"></div>
        <div class="seg" role="group" aria-label="Status">${STATUSES.map(([k, l]) => html`<button data-status="${k}" aria-pressed="${String(ui.status === k)}">${l}</button>`)}</div>
      </div>
      <div data-results></div>
    </div>`);
  const q = el.querySelector('[data-q]');
  q.addEventListener('input', () => { ui.q = q.value; ui.limit = 100; renderResults(el); });
  const pick = (attr, key) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => b.addEventListener('click', () => {
    ui[key] = b.dataset[attr]; ui.limit = 100;
    el.querySelectorAll(`[data-${attr}]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderResults(el);
  }));
  pick('status', 'status');
  renderResults(el);
}

function renderResults(el) {
  const list = rows();
  const shown = list.slice(0, ui.limit);
  const total = list.filter((o) => !o.x).reduce((s, o) => s + o.total, 0);
  const box = el.querySelector('[data-results]');
  box.innerHTML = String(html`
    <div class="card card--flush ${state.ordersSyncing ? 'is-stale' : ''}">
      ${shown.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="hide-sm">Items</th><th class="r">Total</th><th>Payment</th><th>Fulfilment</th></tr></thead>
        <tbody>${shown.map((o) => {
          const c = state.byNumericId.get(o.cust);
          return html`
            <tr data-href="${o.id}" data-order="${o.id}">
              <td class="nowrap"><span class="strong">${o.name}</span>${o.x ? html` <span class="badge">Cancelled</span>` : ''}</td>
              <td class="nowrap">${fmtDate(o.at)}</td>
              <td><a class="cust" href="#/customers/${c.numericId}"><span class="cust__name clip" style="font-size:13px">${label(c)}</span>${sublabel(c) ? html`<span class="cust__sub clip">${sublabel(c)}</span>` : ''}</a></td>
              <td class="hide-sm clip" style="max-width:260px">${orderSummary(o)}</td>
              <td class="r">${money(o.total)}</td>
              <td class="nowrap">${pretty(o.pay)}</td>
              <td class="nowrap">${pretty(o.ful)}</td>
            </tr>
            ${ui.open.has(o.id) ? html`<tr><td colspan="7" style="background:var(--surface-subtle)">
              <div class="list">${o.lines.map(([title, variant, qty, amount]) => html`<div class="list__item"><span class="list__main">${title}${variant ? html` <span class="muted">· ${variant}</span>` : ''}</span><span class="num">${qty} ×</span><span class="num" style="width:90px;text-align:right">${money(amount)}</span></div>`)}</div>
              <div class="row row--wrap" style="margin-top:8px">
                <a class="btn btn--sm" href="${adminUrl(`orders/${o.id}`)}" target="_top">${icon('external-link', 'i--sm')}Open in Shopify</a>
                <a class="btn btn--ghost btn--sm" href="#/customers/${c.numericId}">${icon('users', 'i--sm')}${label(c)}</a>
              </div>
            </td></tr>` : ''}`;
        })}</tbody></table></div>
        ${list.length > shown.length ? html`<div class="row" style="justify-content:center;padding:14px"><button class="btn btn--ghost btn--sm" data-more>Show more (${list.length - shown.length} more)</button></div>` : ''}`
      : html`<div class="empty">${icon('receipt')}<span>${state.ordersSyncing && !state.orders.length ? 'Syncing orders…' : 'No trade orders match.'}</span></div>`}
    </div>
    <p class="muted small" style="margin:0">${list.length} order${list.length === 1 ? '' : 's'} · ${money(total)}</p>`);
  box.querySelectorAll('[data-order]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    if (ui.open.has(tr.dataset.order)) ui.open.delete(tr.dataset.order); else ui.open.add(tr.dataset.order);
    renderResults(el);
  }));
  const more = box.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { ui.limit += 200; renderResults(el); });
}
