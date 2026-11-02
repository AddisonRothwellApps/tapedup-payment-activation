// App shell: sidebar menu, hash router, boot sequence and sync status.
// Hash routes (#/customers/123) because this is a static GitHub Pages site --
// a real path like /customers would 404 there.
import { state, subscribe, loadBoot, loadCustomers, loadCachedOrders, syncOrders, followUps, todayISO, hasAllOrders } from './store.js';
import { html, icon, ago, loadingBlock } from './ui.js';
import { EMBEDDED } from './env.js';
import * as dashboard from './views/dashboard.js';
import * as pipeline from './views/pipeline.js';
import * as customers from './views/customers.js';
import * as prospects from './views/prospects.js';
import * as outbox from './views/outbox.js';
import * as agent from './views/agent.js';
import * as knowledge from './views/knowledge.js';
import * as templates from './views/templates.js';
import * as customer from './views/customer.js';
import * as orders from './views/orders.js';
import * as offers from './views/offers.js';
import * as followups from './views/followups.js';
import * as setup from './views/setup.js';
import * as importer from './views/import.js';

const NAV = [
  { key: 'dashboard', href: '#/', label: 'Dashboard', icon: 'layout-dashboard' },
  { key: 'pipeline', href: '#/pipeline', label: 'Pipeline', icon: 'square-kanban' },
  { key: 'prospects', href: '#/prospects', label: 'Prospects', icon: 'target' },
  { key: 'customers', href: '#/customers', label: 'Customers', icon: 'users' },
  { key: 'outbox', href: '#/outbox', label: 'Outbox', icon: 'inbox' },
  { key: 'templates', href: '#/templates', label: 'Email templates', icon: 'mail' },
  { key: 'agent', href: '#/agent', label: 'Agent', icon: 'sparkles' },
  { key: 'knowledge', href: '#/knowledge', label: 'Knowledge base', icon: 'book-open' },
  { key: 'orders', href: '#/orders', label: 'Trade orders', icon: 'receipt' },
  { key: 'offers', href: '#/offers', label: 'Starter offers', icon: 'gift' },
  { key: 'follow-ups', href: '#/follow-ups', label: 'Follow-ups', icon: 'list-checks' },
  { key: 'setup', href: '#/setup', label: 'Setup', icon: 'settings' },
];

const ROUTES = [
  { nav: 'dashboard', re: /^\/?$/, view: dashboard },
  { nav: 'pipeline', re: /^\/pipeline$/, view: pipeline },
  { nav: 'prospects', re: /^\/prospects$/, view: prospects },
  { nav: 'customers', re: /^\/customers$/, view: customers },
  { nav: 'customers', re: /^\/customers\/(\d+)$/, view: customer },
  { nav: 'outbox', re: /^\/outbox$/, view: outbox },
  { nav: 'templates', re: /^\/templates$/, view: templates },
  { nav: 'agent', re: /^\/agent$/, view: agent },
  { nav: 'knowledge', re: /^\/knowledge$/, view: knowledge },
  { nav: 'orders', re: /^\/orders$/, view: orders },
  { nav: 'offers', re: /^\/offers$/, view: offers },
  { nav: 'follow-ups', re: /^\/follow-ups$/, view: followups },
  { nav: 'setup', re: /^\/setup$/, view: setup },
  { nav: 'setup', re: /^\/import$/, view: importer },
];

const app = document.getElementById('app');
const main = document.getElementById('main');
const nav = document.getElementById('nav');
const syncEl = document.getElementById('sync-status');
let current = null;
let booted = false;
let bootError = null;
let loadingText = EMBEDDED ? 'Connecting to Shopify…' : 'Connecting to Shopify through trade.tapedup.co.uk…';

function renderNav() {
  const today = todayISO();
  const due = state.customersLoaded ? followUps().filter((f) => f.entry.followUp <= today).length : 0;
  nav.innerHTML = String(html`${NAV.map((n) => html`
    <a href="${n.href}" ${current && current.nav === n.key ? html`aria-current="page"` : ''}>${icon(n.icon)}<span>${n.label}</span>${n.key === 'follow-ups' && due ? html`<span class="nav__count" title="${due} due or overdue">${due}</span>` : ''}${n.key === 'outbox' && outbox.outboxCount() ? html`<span class="nav__count" title="Waiting for your approval">${outbox.outboxCount()}</span>` : ''}</a>`)}
    ${EMBEDDED ? '' : html`<form method="post" action="/auth/logout" class="nav__signout"><button class="btn btn--ghost btn--sm" type="submit">${icon('log-out', 'i--sm')}Sign out</button></form>`}`);
}

function renderSync() {
  if (!booted) { syncEl.innerHTML = ''; return; }
  let line;
  if (state.ordersSyncing) line = html`<span class="row">${icon('refresh-cw', 'i--sm')}Syncing orders… ${state.ordersProgress || ''}</span>`;
  else if (state.ordersError) line = html`<span>Couldn't sync orders</span>`;
  else if (state.ordersCheckedAt) line = html`<span>Orders synced ${ago(state.ordersCheckedAt)}</span>`;
  else line = html`<span>Orders not synced yet</span>`;
  syncEl.innerHTML = String(html`${line}
    ${!hasAllOrders() ? html`<span class="small" style="opacity:.8">Last 60 days only</span>` : ''}
    ${state.ordersSyncing ? '' : html`<button class="btn btn--ghost btn--sm" type="button" data-sync>${icon('refresh-cw', 'i--sm')}Refresh</button>`}`);
}

function renderView(scrollTop) {
  if (!current) return;
  if (bootError) {
    main.innerHTML = String(html`<div class="page"><div class="notice notice--err">${icon('circle-alert')}<div><strong>Couldn't load from Shopify.</strong><br>${bootError}</div></div></div>`);
    return;
  }
  // Setup works before customers load (and when customer access is missing).
  if (!booted || (!state.customersLoaded && current.view !== setup && !state.customersError)) {
    main.innerHTML = String(html`<div class="page">${loadingBlock(loadingText)}</div>`);
    return;
  }
  if (state.customersError && current.view !== setup) {
    main.innerHTML = String(html`<div class="page"><div class="notice notice--err">${icon('circle-alert')}<div>
      <strong>Couldn't load customers.</strong> ${state.customersError}<br>
      If this mentions access, open the app from Shopify admin and approve the new permissions, then reload. See <a href="#/setup">Setup</a>.</div></div></div>`);
    return;
  }
  current.view.render(main, ...current.params);
  if (scrollTop) window.scrollTo(0, 0);
}

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const match = ROUTES.find((r) => r.re.test(path)) || ROUTES[0];
  current = { nav: match.nav, view: match.view, params: path.match(match.re).slice(1) };
  app.classList.remove('nav-open');
  // A form left open (e.g. after pressing back) belongs to the old screen.
  document.querySelectorAll('.drawer').forEach((d) => d.remove());
  renderNav();
  renderView(true);
}

subscribe((what) => {
  renderSync();
  if (what === 'orders-progress' || what === 'orders-sync') return;
  renderNav();
  renderView(false);
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-nav-toggle]')) app.classList.toggle('nav-open');
  if (e.target.closest('[data-sync]')) syncOrders();
});
window.addEventListener('hashchange', route);

async function start() {
  route();
  try {
    await loadBoot();
  } catch (err) {
    bootError = err.message;
    booted = true;
    renderView(false);
    return;
  }
  booted = true;
  loadCachedOrders();
  renderSync();
  try {
    loadingText = 'Loading trade accounts…';
    renderView(false);
    await loadCustomers((n) => { loadingText = `Loading trade accounts… ${n}`; renderView(false); });
  } catch (err) {
    state.customersError = err.message;
  }
  renderNav();
  renderView(false);
  syncOrders();
  // Keep "synced 3 min ago" honest while the app stays open.
  setInterval(renderSync, 60000);
  // Outbox badge: how many emails are waiting for approval (trade.tapedup.co.uk only).
  const outboxBadge = () => outbox.refreshOutboxStatus().then((s) => { if (s) renderNav(); });
  outboxBadge();
  setInterval(outboxBadge, 120000);
  window.addEventListener('outbox-changed', outboxBadge);
  window.addEventListener('prospects-changed', () => { if (current && current.view === pipeline) renderView(false); });
}

start();
