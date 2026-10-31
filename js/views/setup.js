// Setup: switch on each Shopify Function this app ships (one-time), the B2B
// shipping amounts, and a check of what the app is allowed to see. Ported
// from the original one-page activation screen -- same lookups and
// mutations, laid out as one list.
import { gql, assertOk } from '../api.js';
import { hasScope, hasAllOrders } from '../store.js';
import { html, icon, toast, busy } from '../ui.js';

// A discount can't combine with another of its OWN class (Shopify rejects the
// create), so each leaves its own class out and combines with the other two.
const FUNCTIONS = [
  { key: 'payment', kind: 'payment', title: 'Hide trade-account payment method',
    desc: 'Hides "Trade Account – Invoice / Net Terms" at checkout from everyone except customers tagged "b2b".' },
  { key: 'pricing', kind: 'discount', title: 'B2B trade pricing', combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
    desc: "Applies each product's custom.wholesale_price (or a flat fallback %) for customers tagged \"b2b\". Combines with your other automatic discounts." },
  { key: 'shipvis', kind: 'delivery', title: 'B2B shipping: hide other rates',
    desc: 'Rates with "B2B" in their name show only to trade accounts; every other rate shows only to retail customers.' },
  { key: 'shipprice', kind: 'discount', title: 'B2B trade shipping', combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: false },
    desc: 'Prices "B2B" rates free above a threshold or a flat rate below it; a "B2B … Priority" rate gets a fixed price. Amounts are below.' },
  { key: 'starter', kind: 'discount', title: 'Starter order', combinesWith: { orderDiscounts: false, productDiscounts: true, shippingDiscounts: true }, discountClasses: ['ORDER'],
    desc: 'Takes each customer\'s starter offer off their whole order at checkout. Needed for Starter offers to work.' },
];

const SHIP_NS = '$app:b2b-shipping-pricing';
const SHIP_KEY = 'function-configuration';
const SHIP_DEFAULTS = { freeShippingThreshold: 100, flatRateBelowThreshold: 6, priorityRate: 7.99 };

// Looked up once per session (re-rendering on every data change would
// re-query Shopify each time); "Check again" refreshes it.
let cache = null;
let loading = null;

async function findFunction(title) {
  const data = await gql('query { shopifyFunctions(first: 25) { nodes { id title } } }');
  return data.shopifyFunctions.nodes.find((n) => n.title === title) || null;
}

// Paged over the whole store: a long-lived shop has far more than one page
// of discounts, and missing one here is what caused "Title must be unique".
async function findAppDiscount(title, withMetafield = false) {
  let after = null;
  for (let page = 0; page < 20; page++) {
    const data = await gql(`query($after: String) {
      discountNodes(first: 250, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id ${withMetafield ? `metafield(namespace: "${SHIP_NS}", key: "${SHIP_KEY}") { value }` : ''}
          discount { __typename ... on DiscountAutomaticApp { title status } } }
      }
    }`, { after });
    const hit = data.discountNodes.nodes.find((n) => n.discount.__typename === 'DiscountAutomaticApp' && n.discount.title === title);
    if (hit) return hit;
    if (!data.discountNodes.pageInfo.hasNextPage) return null;
    after = data.discountNodes.pageInfo.endCursor;
  }
  return null;
}

async function lookup(f) {
  const fn = await findFunction(f.title);
  if (!fn) return { state: 'missing', fn: null };
  if (f.kind === 'discount') {
    const d = await findAppDiscount(f.title, f.key === 'shipprice');
    if (!d) return { state: 'off', fn };
    return { state: d.discount.status === 'ACTIVE' ? 'on' : 'inactive', fn, id: d.id, metafield: d.metafield };
  }
  const root = f.kind === 'payment' ? 'paymentCustomizations' : 'deliveryCustomizations';
  const data = await gql(`query { ${root}(first: 25) { nodes { id title enabled functionId } } }`);
  const existing = data[root].nodes.find((n) => n.functionId === fn.id);
  if (!existing) return { state: 'off', fn };
  return { state: existing.enabled ? 'on' : 'inactive', fn, id: existing.id };
}

async function loadAll() {
  const entries = await Promise.all(FUNCTIONS.map(async (f) => {
    try { return [f.key, await lookup(f)]; } catch (err) { return [f.key, { state: 'error', error: err.message }]; }
  }));
  cache = Object.fromEntries(entries);
}

async function activate(f, info) {
  if (f.kind === 'discount') {
    if (info.state === 'inactive') {
      assertOk(await gql('mutation($id: ID!) { discountAutomaticActivate(id: $id) { userErrors { field message } } }', { id: info.id }));
    } else {
      assertOk(await gql(`mutation($input: DiscountAutomaticAppInput!) { discountAutomaticAppCreate(automaticAppDiscount: $input) { userErrors { field message } } }`, {
        input: { title: f.title, functionId: info.fn.id, startsAt: new Date().toISOString(), combinesWith: f.combinesWith, ...(f.discountClasses ? { discountClasses: f.discountClasses } : {}) },
      }));
    }
  } else {
    const type = f.kind === 'payment' ? 'payment' : 'delivery';
    const T = type === 'payment' ? 'PaymentCustomization' : 'DeliveryCustomization';
    if (info.state === 'inactive') {
      assertOk(await gql(`mutation($id: ID!, $input: ${T}Input!) { ${type}CustomizationUpdate(id: $id, ${type}Customization: $input) { userErrors { field message } } }`, { id: info.id, input: { enabled: true } }));
    } else {
      assertOk(await gql(`mutation($input: ${T}Input!) { ${type}CustomizationCreate(${type}Customization: $input) { userErrors { field message } } }`, { input: { functionId: info.fn.id, title: f.title, enabled: true } }));
    }
  }
}

const SCOPES = [
  ['read_customers', 'Customers', 'CRM, starter offers'],
  ['write_customers', 'Edit customers', 'Offers, notes, tags, activity log'],
  ['read_products', 'Products', 'Choosing starter-offer products'],
  ['read_orders', 'Orders', 'Dashboard, trends, order history'],
  ['read_all_orders', 'All orders (not just 60 days)', 'Trends, 12-month view, reorder patterns'],
];

export function render(el) {
  if (!cache && !loading) {
    // Only redraw if they're still on this screen when the checks finish.
    loading = loadAll().finally(() => { loading = null; if (location.hash.startsWith('#/setup')) render(el); });
  }
  const chip = (s) => ({
    on: html`<span class="status status--active">Active</span>`,
    inactive: html`<span class="status status--due">Turned off</span>`,
    off: html`<span class="status status--lead">Not set up</span>`,
    missing: html`<span class="status status--lapsed" title="Run shopify app deploy from tapedup-payment-rules">Not deployed</span>`,
    error: html`<span class="status status--lapsed">Couldn't check</span>`,
  }[s]);
  const ship = cache && cache.shipprice && cache.shipprice.id ? (() => {
    try { return { ...SHIP_DEFAULTS, ...JSON.parse((cache.shipprice.metafield && cache.shipprice.metafield.value) || '{}') }; } catch (err) { return SHIP_DEFAULTS; }
  })() : null;

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">tapedup-payment-rules</p><h1 class="h1">Setup</h1></div>
        <div class="page-head__actions"><button class="btn btn--outline" data-recheck ${loading ? 'disabled' : ''}>${icon('refresh-cw')}Check again</button></div>
      </div>

      <section class="card">
        <div class="card__head"><h2 class="h2">Checkout rules</h2><span class="muted small">Switch each on once. After that it runs in Shopify by itself.</span></div>
        ${!cache ? html`<div class="loading" style="padding:30px"><div class="spinner"></div><span>Checking each rule…</span></div>` : html`
          <div>${FUNCTIONS.map((f) => { const info = cache[f.key]; return html`
            <div class="fn">
              <div><div class="row row--wrap"><span class="strong">${f.title}</span>${chip(info.state)}</div><p class="fn__desc">${info.state === 'error' ? info.error : f.desc}</p></div>
              <div>${['off', 'inactive'].includes(info.state) ? html`<button class="btn btn--sm" data-activate="${f.key}">${info.state === 'off' ? 'Create and switch on' : 'Switch on'}</button>` : ''}</div>
            </div>`; })}</div>`}
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">B2B shipping amounts</h2><span class="muted small">Saved into the B2B trade shipping rule; takes effect on the next checkout</span></div>
        ${!cache ? html`<p class="muted small" style="margin:0">Loading…</p>` : !ship ? html`<p class="muted small" style="margin:0">Switch on "B2B trade shipping" above first.</p>` : html`
          <div class="form">
            <div class="form-row">
              <label class="field"><span>Free shipping from</span><span class="input-affix"><b>£</b><input class="input" type="number" min="0" step="1" data-ship="freeShippingThreshold" value="${ship.freeShippingThreshold}"></span></label>
              <label class="field"><span>Flat rate below that</span><span class="input-affix"><b>£</b><input class="input" type="number" min="0" step="0.01" data-ship="flatRateBelowThreshold" value="${ship.flatRateBelowThreshold}"></span></label>
              <label class="field"><span>Priority (24hr) rate</span><span class="input-affix"><b>£</b><input class="input" type="number" min="0" step="0.01" data-ship="priorityRate" value="${ship.priorityRate}"></span></label>
            </div>
            <p class="muted small" style="margin:0">Priority pricing applies to a shipping rate named with both "B2B" and "priority" (e.g. "B2B Priority (24hr)"). Price it in Settings → Shipping and delivery at or above this amount so there's something to discount down from.</p>
            <button class="btn btn--sm" style="justify-self:start" data-save-ship>${icon('check', 'i--sm')}Save amounts</button>
          </div>`}
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">What the app can see</h2></div>
        <div class="list">${SCOPES.map(([scope, label, use]) => { const ok = scope === 'read_all_orders' ? hasAllOrders() : hasScope(scope); return html`
          <div class="list__item"><span class="tl__icon ${ok ? '' : 'tl__icon--auto'}">${icon(ok ? 'check' : 'x', 'i--sm')}</span>
            <span class="list__main"><span class="strong">${label}</span><span class="muted small">${use}</span></span>
            <span class="status ${ok ? 'status--active' : 'status--lapsed'}">${ok ? 'Allowed' : 'Not yet'}</span></div>`; })}</div>
        ${SCOPES.some(([s]) => (s === 'read_all_orders' ? !hasAllOrders() : !hasScope(s))) ? html`<div class="notice notice--info" style="margin-top:14px">${icon('circle-alert')}<div>
          Missing permissions arrive with the next app deploy: open the app from Shopify admin and approve them when asked. "All orders" may need a one-off request in the app's dashboard (API access → Read all orders) before it can be added.</div></div>` : ''}
        <p class="muted small" style="margin:14px 0 0">If customer names or emails show blank, turn on protected customer data (name, email, phone) for this app in its dashboard.</p>
      </section>
    </div>`);

  const recheck = el.querySelector('[data-recheck]');
  recheck.addEventListener('click', () => { cache = null; render(el); });
  el.querySelectorAll('[data-activate]').forEach((b) => b.addEventListener('click', () => {
    const f = FUNCTIONS.find((x) => x.key === b.dataset.activate);
    busy(b, () => activate(f, cache[f.key])).then(async () => { toast(`${f.title} is on`); cache = null; render(el); }).catch(() => {});
  }));
  const save = el.querySelector('[data-save-ship]');
  if (save) save.addEventListener('click', () => {
    const values = Object.fromEntries([...el.querySelectorAll('[data-ship]')].map((i) => [i.dataset.ship, Number(i.value)]));
    if (Object.values(values).some((n) => !Number.isFinite(n) || n < 0)) { toast('Enter three amounts of £0 or more', 'err'); return; }
    busy(save, async () => {
      assertOk(await gql('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
        m: [{ ownerId: cache.shipprice.id, namespace: SHIP_NS, key: SHIP_KEY, type: 'json', value: JSON.stringify(values) }],
      }));
      cache.shipprice.metafield = { value: JSON.stringify(values) };
    }).then(() => toast('Shipping amounts saved')).catch(() => {});
  });
}
