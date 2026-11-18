// Dashboard: how the business is doing over a period, who's buying the most,
// who's ordering more or less, which tapes sell, and who needs a nudge.
// Everything here is trade accounts only; the period filter scopes it all.
import { FIRST_DAY, state, dashboard, insights, label, sublabel, shortTape, followUps, STATUS, todayISO, hasAllOrders } from '../store.js';
import { html, raw, icon, money0, count, delta, columnChart, barList, statusChip, ago, dueLabel, loadingBlock, trendBadge } from '../ui.js';
import { openGiveOffer } from './offers.js';
import { toast, busy } from '../ui.js';
import { SERVER_FEATURES, serverApi } from '../server.js';
import { emailState, loadEmailTemplates } from '../email-templates.js';

const ui = { days: 90 };
// Profit for the period (and the one before, for the change), from the trade server's margin report.
const profit = { key: '', loading: '', cur: null, prev: null, error: '' };
// For "Needs a nudge": the templates, and who already has an email waiting.
const nudge = { steps: null, loading: false, choice: new Map() };
const iso = (t) => new Date(t).toLocaleDateString('en-CA');
const DAY = 864e5;

function loadProfit(el, days, allTime = false) {
  if (!SERVER_FEATURES) return;
  const key = allTime ? 'all' : String(days);
  if (profit.key === key || profit.loading === key) return;
  profit.loading = key;
  const now = Date.now();
  const range = (endAgo) => `from=${iso(now - (endAgo + days - 1) * DAY)}&to=${iso(now - endAgo * DAY)}`;
  // All time has nothing before it to compare with.
  Promise.all([serverApi(`/api/margins?${range(0)}&type=all`), allTime ? null : serverApi(`/api/margins?${range(days)}&type=all`)])
    .then(([cur, prev]) => { if (profit.loading !== key) return; Object.assign(profit, { key, cur, prev, error: '' }); })
    .catch((err) => { if (profit.loading === key) Object.assign(profit, { key, error: err.message }); })
    .finally(() => { if (profit.loading === key) { profit.loading = ''; if (el.isConnected) render(el); } });
}

function loadNudge(el) {
  if (!SERVER_FEATURES || nudge.loading || nudge.steps) return;
  nudge.loading = true;
  Promise.all([serverApi('/api/next-steps'), emailState.loaded ? null : loadEmailTemplates()])
    .then(([steps]) => { nudge.steps = steps; })
    .catch(() => { nudge.steps = { customers: {}, prospects: {} }; })
    .finally(() => { nudge.loading = false; if (el.isConnected) render(el); });
}
const activeTemplates = () => ((emailState.set && emailState.set.templates) || []).filter((t) => t.active !== false);

/** Profit card: trade profit for the period, with all sales underneath. */
function profitStat() {
  if (!SERVER_FEATURES) return '';
  const c = profit.cur && profit.cur.byType.trade.costed;
  const p = profit.prev && profit.prev.byType.trade.costed;
  const all = profit.cur && profit.cur.summary.costed;
  const missing = profit.cur ? profit.cur.byType.trade.incomplete : 0;
  return html`<div class="stat"><span class="stat__label">Profit</span>
    <span class="stat__value">${c ? money0(c.profit) : profit.error ? '—' : '…'}</span>
    <span class="stat__sub">${c ? html`${c.margin != null ? html`<span class="strong">${Math.round(c.margin * 100)}%</span> margin · ` : ''}${p && p.orders ? delta(c.profit, p.profit, { money: true }) : html`<span title="The period before has no orders with costs to compare">no earlier figure</span>`}` : profit.error ? html`<a href="#/margins">Couldn't load</a>` : 'Working it out…'}</span>
    ${c ? html`<span class="stat__sub"><a href="#/margins">All sales ${money0(all.profit)}</a>${missing ? html` · <span title="Imported invoices or products with no cost">${missing} without costs</span>` : ''}</span>` : ''}
  </div>`;
}

/** The email picker and Draft button for one customer in "Needs a nudge". */
function nudgeAction(c, s) {
  if (!SERVER_FEATURES) return '';
  if (!nudge.steps) return html`<span class="muted small">…</span>`;
  const info = nudge.steps.customers[c.id] || {};
  if (info.waiting) return html`<a class="badge badge--cyan" href="#/outbox">${icon('inbox', 'i--sm')}In outbox</a>`;
  if (!c.email) return html`<span class="muted small">No email</span>`;
  const tpl = activeTemplates();
  const has = (k) => tpl.some((t) => t.key === k);
  const sug = s.status === 'risk' && info.lastKey === 'reorder' && has('winback') ? 'winback' : has('reorder') ? 'reorder' : (tpl[0] || {}).key || '';
  const pick = nudge.choice.has(c.id) ? nudge.choice.get(c.id) : sug;
  return html`<div class="deal__send nudge__send">
    <select class="select input--sm" data-nudge="${c.id}" aria-label="Email for ${label(c)}">
      ${tpl.map((t) => html`<option value="${t.key}" ${t.key === pick ? raw('selected') : ''}>${t.name || t.key}${t.key === sug ? ' (suggested)' : ''}</option>`)}
    </select>
    <button type="button" class="btn btn--sm btn--ink" data-nudge-draft="${c.id}" ${pick ? '' : raw('disabled')} title="Draft this email into the Outbox for approval">${icon('mail', 'i--sm')}Draft</button>
  </div>`;
}
// 0 is all time: everything since Trade Hub's records begin.
const PERIODS = [[30, '30 days'], [90, '90 days'], [365, '12 months'], [730, '2 years'], [0, 'All time']];
const daysFor = (n) => (n ? n : Math.ceil((Date.now() - Date.parse(FIRST_DAY)) / DAY) + 1);

export function render(el) {
  const today = todayISO();
  const due = followUps().filter((f) => f.entry.followUp <= today);
  const firstSync = !state.orders.length && state.ordersSyncing;
  // The 60-day limit means a 90-day or 12-month view would silently show
  // 60 days -- clamp and say so instead.
  const maxDays = hasAllOrders() ? Infinity : 30;
  if (!hasAllOrders() && (ui.days > maxDays || ui.days === 0)) ui.days = maxDays;
  const days = daysFor(ui.days);
  const d = dashboard({ days });
  const attention = [...state.customers.values()].map((c) => ({ c, s: insights(c) }))
    .filter(({ s }) => ['due', 'risk'].includes(s.status)).sort((a, b) => b.c.amountSpent - a.c.amountSpent).slice(0, 6);
  loadProfit(el, days, ui.days === 0);
  loadNudge(el);
  const granularity = days > 120 ? 'By month' : days > 31 ? 'By week' : 'By day';

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">${state.shop.name} · Trade Hub</p><h1 class="h1">Dashboard</h1></div>
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
        <div class="seg" role="group" aria-label="Period">${PERIODS.map(([n, l]) => html`<button data-days="${n}" aria-pressed="${String(ui.days === n)}" ${(n === 0 ? !hasAllOrders() : n > maxDays) ? raw('disabled title="Needs the read all orders permission"') : ''}>${l}</button>`)}</div>
        ${state.ordersSyncing ? html`<span class="muted small row">${icon('refresh-cw', 'i--sm')}Syncing orders… ${state.ordersProgress || ''}</span>` : ''}
      </div>

      ${firstSync ? loadingBlock('Syncing your orders for the first time…', 'This only takes a while once. After that, opening the app just fetches what changed.') : html`
      <div class="stats ${state.ordersSyncing ? 'is-stale' : ''}">
        <div class="stat"><span class="stat__label">Revenue</span><span class="stat__value">${money0(d.revenue.cur)}</span><span class="stat__sub">${delta(d.revenue.cur, d.revenue.prev, { money: true })}</span></div>
        ${profitStat()}
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
          ${d.dealers.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
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
          <div class="card__head"><h2 class="h2">Who's changing</h2><span class="muted small">${ui.days === 0 ? 'All time' : `Spend vs the previous ${PERIODS.find(([n]) => n === ui.days)[1]}`}</span></div>
          ${ui.days === 0 ? html`<p class="muted small" style="margin:0">All time has nothing before it to compare with. Pick 12 months or 2 years to see who's ordering more or less.</p>` : !d.comparable ? html`<p class="muted small" style="margin:0">Needs order history from before this period to compare against.</p>` : html`
            <h3 class="h3">${icon('trending-up', 'i--sm')} Ordering more</h3>
            ${moverList(d.growing, 'up')}
            <h3 class="h3" style="margin-top:18px">${icon('trending-down', 'i--sm')} Ordering less</h3>
            ${moverList(d.slowing, 'down')}`}
        </section>
      </div>`}

      <section class="card card--flush">
        <div class="card__head"><h2 class="h2">Needs a nudge</h2><span class="muted small">Right now · past their usual reorder time, biggest spenders first</span></div>
        ${attention.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
          <thead><tr><th>Customer</th><th>Status</th><th class="hide-sm">Usually orders</th><th>Last order</th><th class="r">Lifetime</th>${SERVER_FEATURES ? html`<th>Email</th>` : ''}</tr></thead>
          <tbody>${attention.map(({ c, s }) => html`<tr data-href="#/customers/${c.numericId}">
            <td><div class="cust"><span class="cust__name clip">${label(c)}</span><span class="cust__sub clip">${sublabel(c) || c.email}</span></div></td>
            <td>${statusChip(s.status, STATUS)}</td>
            <td class="hide-sm">${s.gap ? `Every ${Math.round(s.gap)} days` : '—'}</td>
            <td class="nowrap">${ago(s.lastAt)}</td>
            <td class="r">${money0(c.amountSpent)}</td>
            ${SERVER_FEATURES ? html`<td class="nudge__cell">${nudgeAction(c, s)}</td>` : ''}
          </tr>`)}</tbody></table></div>`
          : html`<div class="empty">${icon('check')}<span>Everyone's ordering on their usual rhythm.</span></div>`}
      </section>
    </div>`);

  el.querySelector('[data-give]').addEventListener('click', () => openGiveOffer());
  el.querySelectorAll('[data-days]').forEach((b) => b.addEventListener('click', () => { ui.days = Number(b.dataset.days); render(el); }));
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('.nudge__cell')) return; location.hash = tr.dataset.href; }));
  el.querySelectorAll('[data-nudge]').forEach((sel) => sel.addEventListener('change', () => { nudge.choice.set(sel.dataset.nudge, sel.value); }));
  el.querySelectorAll('[data-nudge-draft]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.nudgeDraft;
    const c = state.customers.get(id);
    const key = el.querySelector(`[data-nudge="${CSS.escape(id)}"]`).value;
    const t = activeTemplates().find((x) => x.key === key);
    busy(b, () => serverApi('/api/outbox/bulk', { method: 'POST', body: { items: [{ customerId: id, templateKey: key }] } })).then((r) => {
      if (r.failed && r.failed.length) { toast(`${label(c)}: ${r.failed[0].reason}`, 'err'); return; }
      toast(`Drafted "${(t && t.name) || key}" for ${label(c)}: it's in the Outbox`);
      window.dispatchEvent(new Event('outbox-changed'));
      nudge.steps = null; nudge.choice.delete(id); render(el);
    }).catch(() => {});
  }));
  const chart = el.querySelector('[data-chart]');
  if (chart) columnChart(chart, d.series, { unit: 'Revenue' });
}

function moverList(rows, dir) {
  if (!rows.length) return html`<p class="muted small" style="margin:0 0 4px">Nobody yet.</p>`;
  return html`<div class="list">${rows.map((r) => html`
    <a class="list__item" href="#/customers/${r.customer.numericId}" style="color:inherit">
      <span class="list__main"><span class="strong clip">${label(r.customer)}</span>
        <span class="muted small">${money0(r.cur)} vs ${money0(r.prev)}</span></span>
      <span class="trend trend--${dir}">${icon(dir === 'up' ? 'trending-up' : 'trending-down', 'i--sm')}${r.delta > 0 ? '+' : '−'}${money0(Math.abs(r.delta))}</span>
    </a>`)}</div>`;
}
