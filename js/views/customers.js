// Customers: the CRM list of trade accounts. Search, quick filters, sorting,
// bulk "give a starter offer", CSV export, and adding a new trade account.
import { state, insights, isTerms, label, sublabel, shortTape, offerStatus, followUps, lastContact, STATUS, todayISO, createCustomer } from '../store.js';
import { html, raw, icon, money0, ago, trendBadge, statusChip, toast, openDrawer, busy } from '../ui.js';
import { openGiveOffer } from './offers.js';

const FILTERS = [
  ['all', 'All'],
  ['attention', 'Needs a nudge'],
  ['followups', 'Follow-up due'],
  ['offers', 'Offer waiting'],
  ['leads', 'No orders yet'],
];
const SORTS = [
  ['spend', 'Lifetime spend'],
  ['recent', 'Most recent order'],
  ['trend', 'Ordering more'],
  ['slowing', 'Ordering less'],
  ['orders', 'Number of orders'],
  ['contact', 'Longest since contact'],
  ['name', 'Name'],
];
const ui = { q: '', filter: 'all', sort: 'spend', limit: 50, selected: new Set() };

function rows() {
  const today = todayISO();
  const dueIds = new Set(followUps().filter((f) => f.entry.followUp <= today).map((f) => f.customer.id));
  const q = ui.q.trim().toLowerCase();
  let list = [...state.customers.values()].map((c) => ({ c, s: insights(c) }));
  if (q) list = list.filter(({ c }) => searchText(c).includes(q));
  const f = ui.filter;
  if (f === 'attention') list = list.filter(({ s }) => ['due', 'risk', 'lapsed'].includes(s.status));
  if (f === 'followups') list = list.filter(({ c }) => dueIds.has(c.id));
  if (f === 'offers') list = list.filter(({ c }) => offerStatus(c) === 'Waiting');
  if (f === 'leads') list = list.filter(({ c }) => !c.numberOfOrders);
  const trendVal = ({ s }) => (s.trend && s.trend.pct !== null ? s.trend.pct : s.trend && s.trend.dir === 'new' ? 10 : -Infinity);
  const sorters = {
    spend: (a, b) => b.c.amountSpent - a.c.amountSpent,
    recent: (a, b) => String(b.s.lastAt || '').localeCompare(String(a.s.lastAt || '')),
    trend: (a, b) => trendVal(b) - trendVal(a),
    slowing: (a, b) => ((a.s.trend ? a.s.trend.cur - a.s.trend.prev : 0) - (b.s.trend ? b.s.trend.cur - b.s.trend.prev : 0)),
    orders: (a, b) => b.c.numberOfOrders - a.c.numberOfOrders,
    contact: (a, b) => String(lastContact(a.c) || '').localeCompare(String(lastContact(b.c) || '')),
    name: (a, b) => label(a.c).localeCompare(label(b.c)),
  };
  return list.sort(sorters[ui.sort]);
}

function searchText(c) {
  const p = c.crm.profile;
  return [c.name, c.email, c.company, c.contact, c.phone, c.city, p.address, p.financeEmail, ...(p.otherEmails || []), ...c.tags].join(' ').toLowerCase();
}

export function render(el) {
  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Trade accounts</p><h1 class="h1">Customers</h1></div>
        <div class="page-head__actions">
          <button class="btn btn--outline" data-export>${icon('download')}Export CSV</button>
          <button class="btn" data-new>${icon('user-plus')}Add trade account</button>
        </div>
      </div>
      <div class="filters">
        <div class="input-affix" style="flex:1;min-width:220px;max-width:420px">${icon('search', 'i--sm')}<input class="input" type="search" placeholder="Search company, contact, email, phone" value="${ui.q}" data-q aria-label="Search customers"></div>
        <label class="row small muted">Sort <select class="select input--sm" style="width:auto" data-sort>${SORTS.map(([k, l]) => html`<option value="${k}" ${ui.sort === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
      </div>
      <div class="seg" role="group" aria-label="Filter">${FILTERS.map(([k, l]) => html`<button data-filter="${k}" aria-pressed="${String(ui.filter === k)}">${l}</button>`)}</div>
      <div data-results></div>
    </div>`);

  const q = el.querySelector('[data-q]');
  q.addEventListener('input', () => { ui.q = q.value; ui.limit = 50; renderResults(el); });
  el.querySelector('[data-sort]').addEventListener('change', (e) => { ui.sort = e.target.value; renderResults(el); });
  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    ui.filter = b.dataset.filter; ui.limit = 50;
    el.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderResults(el);
  }));
  el.querySelector('[data-new]').addEventListener('click', openNewCustomer);
  el.querySelector('[data-export]').addEventListener('click', () => exportCsv(ui.selected.size ? rows().filter(({ c }) => ui.selected.has(c.id)) : rows()));
  renderResults(el);
}

function renderResults(el) {
  const list = rows();
  const shown = list.slice(0, ui.limit);
  const box = el.querySelector('[data-results]');
  const allShownSelected = shown.length && shown.every(({ c }) => ui.selected.has(c.id));
  box.innerHTML = String(html`
    <div class="card card--flush">
      ${list.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr>
          <th class="w-check"><input type="checkbox" data-select-all aria-label="Select all shown" ${allShownSelected ? raw('checked') : ''}></th>
          <th>Customer</th><th>Status</th><th class="r">Lifetime spend</th><th class="r hide-sm">Orders</th><th class="hide-sm">Last order</th><th class="hide-sm">Last contact</th><th title="Spend, last 90 days vs the 90 before">90-day trend</th><th class="hide-sm">Best tape</th>
        </tr></thead>
        <tbody>${shown.map(({ c, s }) => html`<tr data-href="#/customers/${c.numericId}">
          <td class="w-check"><input type="checkbox" data-select="${c.id}" aria-label="Select ${label(c)}" ${ui.selected.has(c.id) ? raw('checked') : ''}></td>
          <td><div class="cust">
            <span class="cust__name">${label(c)}</span>
            ${isTerms(c) || offerStatus(c) === 'Waiting' ? html`<span class="row" style="gap:4px;margin:2px 0">${isTerms(c) ? html`<span class="badge">Terms</span>` : ''}${offerStatus(c) === 'Waiting' ? html`<span class="badge badge--accent">Offer</span>` : ''}</span>` : ''}
            <span class="cust__sub clip" style="max-width:320px">${[sublabel(c), c.email, c.city].filter(Boolean).join(' · ') || '—'}</span>
          </div></td>
          <td>${statusChip(s.status, STATUS)}</td>
          <td class="r">${money0(c.amountSpent)}</td>
          <td class="r hide-sm">${c.numberOfOrders}</td>
          <td class="hide-sm nowrap">${s.lastAt ? ago(s.lastAt) : '—'}</td>
          <td class="hide-sm nowrap">${lastContact(c) ? ago(lastContact(c)) : '—'}</td>
          <td>${trendBadge(s.trend, { short: true })}</td>
          <td class="hide-sm clip" style="max-width:180px">${shortTape(s.topProduct) || '—'}</td>
        </tr>`)}</tbody></table></div>
        ${list.length > shown.length ? html`<div class="row" style="justify-content:center;padding:14px"><button class="btn btn--ghost btn--sm" data-more>Show more (${list.length - shown.length} more)</button></div>` : ''}`
      : html`<div class="empty">${icon('users')}<span>No customers match.</span></div>`}
    </div>
    <p class="muted small" style="margin:0">${list.length} customer${list.length === 1 ? '' : 's'}${state.ordersSyncing ? ' · trends update when the order sync finishes' : ''}</p>
    ${ui.selected.size ? html`<div class="bulkbar"><span>${ui.selected.size} selected</span><span class="spacer"></span>
      <button class="btn btn--accent btn--sm" data-bulk-offer>${icon('gift', 'i--sm')}Give starter offer</button>
      <button class="btn btn--ghost btn--sm" style="color:#fff" data-bulk-export>${icon('download', 'i--sm')}Export</button>
      <button class="btn btn--ghost btn--sm" style="color:#fff" data-bulk-clear>Clear</button></div>` : ''}`);

  box.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('input, a, button')) return;
    location.hash = tr.dataset.href;
  }));
  box.querySelectorAll('[data-select]').forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) ui.selected.add(cb.dataset.select); else ui.selected.delete(cb.dataset.select);
    renderResults(el);
  }));
  const all = box.querySelector('[data-select-all]');
  if (all) all.addEventListener('change', () => { shown.forEach(({ c }) => (all.checked ? ui.selected.add(c.id) : ui.selected.delete(c.id))); renderResults(el); });
  const more = box.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { ui.limit += 100; renderResults(el); });
  const bulkOffer = box.querySelector('[data-bulk-offer]');
  if (bulkOffer) {
    bulkOffer.addEventListener('click', () => openGiveOffer({ customers: [...ui.selected].map((id) => state.customers.get(id)).filter(Boolean) }));
    box.querySelector('[data-bulk-export]').addEventListener('click', () => exportCsv(rows().filter(({ c }) => ui.selected.has(c.id))));
    box.querySelector('[data-bulk-clear]').addEventListener('click', () => { ui.selected.clear(); renderResults(el); });
  }
}

function exportCsv(list) {
  const cols = ['Company', 'Contact', 'Shopify name', 'Email', 'Phone', 'City', 'Status', 'Lifetime spend', 'Orders', 'Last order', 'Last contact', 'Spend last 90 days', 'Spend previous 90 days', 'Best tape', 'Stage', 'Tags'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(cell).join(',')];
  for (const { c, s } of list) {
    lines.push([label(c), c.contact, c.name, c.email, c.phone, c.city, STATUS[s.status].label, c.amountSpent.toFixed(2), c.numberOfOrders,
      s.lastAt ? s.lastAt.slice(0, 10) : '', lastContact(c) || '', s.trend ? s.trend.cur.toFixed(2) : '', s.trend ? s.trend.prev.toFixed(2) : '', s.topProduct, c.crm.stage, c.tags.join(' ')].map(cell).join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `trade-hub-customers-${todayISO()}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Exported ${list.length} customer${list.length === 1 ? '' : 's'}`);
}

export function openNewCustomer() {
  openDrawer({
    eyebrow: 'Trade Hub',
    title: 'Add trade account',
    body: html`<form class="form" onsubmit="return false">
      <div class="form-row">
        <label class="field"><span>First name</span><input class="input" data-f="firstName" autocomplete="off"></label>
        <label class="field"><span>Last name</span><input class="input" data-f="lastName" autocomplete="off"></label>
      </div>
      <label class="field"><span>Company / gym</span><input class="input" data-f="company" autocomplete="off"></label>
      <label class="field"><span>Email</span><input class="input" type="email" data-f="email" autocomplete="off"></label>
      <label class="field"><span>Phone</span><input class="input" type="tel" data-f="phone" autocomplete="off" placeholder="+44…"></label>
      <label class="field"><span>Note</span><textarea class="textarea" data-f="note" placeholder="How you met, what they're after…"></textarea></label>
      <p class="muted small" style="margin:0">They're tagged "b2b", so they get trade pricing and B2B shipping when they sign in.</p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('user-plus', 'i--sm')}Add trade account</button>`,
    onMount(api) {
      api.$('[data-save]').addEventListener('click', (e) => {
        const v = (k) => api.$(`[data-f="${k}"]`).value.trim();
        const input = { firstName: v('firstName'), lastName: v('lastName'), company: v('company'), email: v('email'), phone: v('phone'), note: v('note') };
        if (!input.email && !input.phone) { toast('Add an email or phone number', 'err'); return; }
        if (!input.firstName && !input.lastName && !input.company) { toast('Add a name or company', 'err'); return; }
        busy(e.currentTarget, () => createCustomer(input)).then((c) => { toast(`Added ${label(c)}`); api.close(); location.hash = `#/customers/${c.numericId}`; }).catch(() => {});
      });
    },
  });
}
