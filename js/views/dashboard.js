// Dashboard: how the business is doing over a period, who's buying the most,
// who's ordering more or less, which tapes sell, and who needs a nudge.
// The period + customer filters sit in one row and scope everything below.
import { state, dashboard, insights, isDealer, label, sublabel, shortTape, followUps, STATUS, todayISO, hasAllOrders } from '../store.js';
import { html, raw, icon, money0, count, delta, columnChart, barList, statusChip, ago, dueLabel, loadingBlock, trendBadge } from '../ui.js';
import { openGiveOffer } from './offers.js';

const ui = { days: 90, segment: 'all' };
const PERIODS = [[30, '30 days'], [90, '90 days'], [365, '12 months']];
const SEGMENTS = [['all', 'All customers'], ['dealers', 'Trade'], ['retail', 'Retail']];

export function render(el) {
  const today = todayISO();
  const due = followUps().filter((f) => f.entry.followUp <= today);
  const firstSync = !state.orders.length && state.ordersSyncing;
  // The 60-day limit means a 90-day or 12-month view would silently show
  // 60 days -- clamp and say so instead.
  const maxDays = hasAllOrders() ? 365 : 30;
  if (ui.days > maxDays) ui.days = maxDays;
  const d = dashboard(ui);
  const segmentFilter = (c) => ui.segment === 'all' || (ui.segment === 'dealers' ? isDealer(c) : !isDealer(c));
  const attention = [...state.customers.values()].filter(segmentFilter).map((c) => ({ c, s: insights(c) }))
    .filter(({ s }) => ['due', 'risk'].includes(s.status)).sort((a, b) => b.c.amountSpent - a.c.amountSpent).slice(0, 6);
  const granularity = ui.days > 120 ? 'By month' : ui.days > 31 ? 'By week' : 'By day';

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">${state.shop.name}</p><h1 class="h1">Dashboard</h1></div>
        <div class="page-head__actions">
          <a class="btn btn--outline" href="#/customers">${icon('users')}Customers</a>
          <button class="btn" data-give>${icon('gift')}Give a starter offer</button>
        </div>
      </div>

      ${due.length ? html`<section class="card">
        <div class="card__head"><h2 class="h2">Follow-ups due</h2><a class="btn btn--ghost btn--sm" href="#/follow-ups">See all</a></div>
        <div class="list">${due.slice(0, 4).map(({ customer: c, entry: e }) => { const l = dueLabel(e.followUp, today); return html`
          <a class="list__item" href="#/customers/${c.numericId}" style="color:inherit">
            <span class="list__main"><span class="strong clip">${label(c)}</span><span class="muted small clip">${e.text || 'Follow up'}</span></span>
            <span class="followup ${l.kind ? `followup--${l.kind}` : ''}">${icon('calendar', 'i--sm')}${l.text}</span>
          </a>`; })}</div>
      </section>` : ''}

      ${!hasAllOrders() ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>
        <strong>Only the last 60 days of orders are visible.</strong> Trends and the 90-day / 12-month views need the "read all orders" permission. See <a href="#/setup">Setup</a>.</div></div>` : ''}
      ${state.ordersError ? html`<div class="notice notice--err">${icon('circle-alert')}<div><strong>Couldn't sync orders.</strong> ${state.ordersError}</div></div>` : ''}

      <div class="filters">
        <div class="seg" role="group" aria-label="Period">${PERIODS.map(([n, l]) => html`<button data-days="${n}" aria-pressed="${String(ui.days === n)}" ${n > maxDays ? raw('disabled title="Needs the read all orders permission"') : ''}>${l}</button>`)}</div>
        <div class="seg" role="group" aria-label="Customers">${SEGMENTS.map(([k, l]) => html`<button data-seg="${k}" aria-pressed="${String(ui.segment === k)}">${l}</button>`)}</div>
        ${state.ordersSyncing ? html`<span class="muted small row">${icon('refresh-cw', 'i--sm')}Syncing orders… ${state.ordersProgress || ''}</span>` : ''}
      </div>

      ${firstSync ? loadingBlock('Syncing your orders for the first time…', 'This only takes a while once. After that, opening the app just fetches what changed.') : html`
      <div class="stats ${state.ordersSyncing ? 'is-stale' : ''}">
        <div class="stat"><span class="stat__label">Revenue</span><span class="stat__value">${money0(d.revenue.cur)}</span><span class="stat__sub">${delta(d.revenue.cur, d.revenue.prev, { money: true })}</span></div>
        <div class="stat"><span class="stat__label">Orders</span><span class="stat__value">${count(d.orders.cur)}</span><span class="stat__sub">${delta(d.orders.cur, d.orders.prev)}</span></div>
        <div class="stat"><span class="stat__label">Customers ordering</span><span class="stat__value">${count(d.customers.cur)}</span><span class="stat__sub">${delta(d.customers.cur, d.customers.prev)}</span></div>
        <div class="stat"><span class="stat__label">Average order</span><span class="stat__value">${money0(d.aov.cur)}</span><span class="stat__sub">${delta(d.aov.cur, d.aov.prev, { money: true })}</span></div>
      </div>

      <div class="grid grid--side ${state.ordersSyncing ? 'is-stale' : ''}">
        <section class="card">
          <div class="card__head"><h2 class="h2">Revenue</h2><span class="muted small">${granularity}</span></div>
          ${d.orders.cur ? html`<div data-chart></div>` : html`<div class="empty">${icon('receipt')}<span>No orders in this period.</span></div>`}
        </section>
        <section class="card">
          <div class="card__head"><h2 class="h2">Best tapes</h2><span class="muted small">Units sold</span></div>
          ${d.products.length ? barList(d.products, { value: (p) => p.units, label: (p) => shortTape(p.title), format: (v) => `${count(v)}`, sub: (p) => money0(p.revenue) })
            : html`<p class="muted small" style="margin:0">Nothing sold in this period.</p>`}
        </section>
      </div>

      <div class="grid grid--2 ${state.ordersSyncing ? 'is-stale' : ''}">
        <section class="card card--flush">
          <div class="card__head"><h2 class="h2">Best dealers</h2><span class="muted small">Revenue this period</span></div>
          ${ui.segment === 'retail' ? html`<div class="empty"><span>Switch to All customers or Trade to rank your dealers.</span></div>`
            : d.dealers.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
              <thead><tr><th></th><th>Dealer</th><th class="r">Revenue</th><th class="hide-sm">vs before</th><th class="r">Orders</th></tr></thead>
              <tbody>${d.dealers.map((r, i) => html`<tr data-href="#/customers/${r.customer.numericId}">
                <td style="width:40px"><span class="rank ${i === 0 ? 'rank--1' : ''}">${i + 1}</span></td>
                <td><div class="cust"><span class="cust__name clip">${label(r.customer)}</span><span class="cust__sub clip">${[sublabel(r.customer), r.topProduct ? `Best tape: ${shortTape(r.topProduct)}` : ''].filter(Boolean).join(' · ')}</span></div></td>
                <td class="r strong">${money0(r.cur)}</td>
                <td class="hide-sm">${d.comparable ? trendBadge({ cur: r.cur, prev: r.prev, pct: r.prev ? (r.cur - r.prev) / r.prev : null, dir: !r.prev ? 'new' : r.cur >= r.prev * 1.1 ? 'up' : r.cur <= r.prev * 0.9 ? 'down' : 'flat' }, { short: true }) : html`<span class="faint">—</span>`}</td>
                <td class="r">${r.orders}</td>
              </tr>`)}</tbody></table></div>`
            : html`<div class="empty">${icon('store')}<span>No trade orders in this period.</span></div>`}
        </section>

        <section class="card">
          <div class="card__head"><h2 class="h2">Who's changing</h2><span class="muted small">Spend vs the previous ${PERIODS.find(([n]) => n === ui.days)[1]}</span></div>
          ${!d.comparable ? html`<p class="muted small" style="margin:0">Needs order history from before this period to compare against.</p>` : html`
            <h3 class="h3">${icon('trending-up', 'i--sm')} Ordering more</h3>
            ${moverList(d.growing, 'up')}
            <h3 class="h3" style="margin-top:18px">${icon('trending-down', 'i--sm')} Ordering less</h3>
            ${moverList(d.slowing, 'down')}`}
        </section>
      </div>`}

      <section class="card card--flush">
        <div class="card__head"><h2 class="h2">Needs a nudge</h2><span class="muted small">Right now · past their usual reorder time, biggest spenders first</span></div>
        ${attention.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
          <thead><tr><th>Customer</th><th>Status</th><th class="hide-sm">Usually orders</th><th>Last order</th><th class="r">Lifetime</th></tr></thead>
          <tbody>${attention.map(({ c, s }) => html`<tr data-href="#/customers/${c.numericId}">
            <td><div class="cust"><span class="cust__name clip">${label(c)}</span><span class="cust__sub clip">${sublabel(c) || c.email}</span></div></td>
            <td>${statusChip(s.status, STATUS)}</td>
            <td class="hide-sm">${s.gap ? `Every ${Math.round(s.gap)} days` : '—'}</td>
            <td class="nowrap">${ago(s.lastAt)}</td>
            <td class="r">${money0(c.amountSpent)}</td>
          </tr>`)}</tbody></table></div>`
          : html`<div class="empty">${icon('check')}<span>Everyone's ordering on their usual rhythm.</span></div>`}
      </section>
    </div>`);

  el.querySelector('[data-give]').addEventListener('click', () => openGiveOffer());
  el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { ui.days = Number(b.dataset.days); render(el); }));
  el.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { ui.segment = b.dataset.seg; render(el); }));
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  const chart = el.querySelector('[data-chart]');
  if (chart) columnChart(chart, d.series, { unit: 'Revenue' });
}

function moverList(rows, dir) {
  if (!rows.length) return html`<p class="muted small" style="margin:0 0 4px">Nobody yet.</p>`;
  return html`<div class="list">${rows.map((r) => html`
    <a class="list__item" href="#/customers/${r.customer.numericId}" style="color:inherit">
      <span class="list__main"><span class="strong clip">${label(r.customer)}${isDealer(r.customer) ? html` <span class="badge badge--ink" style="margin-left:4px">Trade</span>` : ''}</span>
        <span class="muted small">${money0(r.cur)} vs ${money0(r.prev)}</span></span>
      <span class="trend trend--${dir}">${icon(dir === 'up' ? 'trending-up' : 'trending-down', 'i--sm')}${r.delta > 0 ? '+' : '−'}${money0(Math.abs(r.delta))}</span>
    </a>`)}</div>`;
}
