// Everything Trade Hub knows, loaded from Shopify and shared by every view.
// It only deals with trade accounts (customers tagged "b2b"); retail
// customers and their orders are left to Shopify's own screens.
// Nothing here has a server behind it -- data lives in Shopify itself:
//   - customers: the Customer objects, plus two JSON metafields on each:
//       tapedup.starter_offer  the live starter order (read by the
//                              starter-order-discount function + the theme;
//                              keep its shape in step with both)
//       tapedup.crm            this app's CRM record:
//                              { stage, profile: { company, contact, ... }, log: [...] }
//   - orders: synced into memory and cached in localStorage (compact, no
//     names or emails) so reopening the app only fetches what changed
//   - starter-offer templates: an app-data metafield on this app's own
//     installation, private to the app
import { gql, assertOk, paginate } from './api.js';

export const TAGS = { dealer: 'b2b', terms: 'terms', starter: 'starter-order' };
const NS = 'tapedup';
const OFFER_KEY = 'starter_offer';
const CRM_KEY = 'crm';
const APP_NS = 'tapedup_admin';
const TEMPLATES_KEY = 'starter_templates';
const DAY = 86400000;

export const state = {
  shop: null,
  appInstallationId: null,
  scopes: new Set(),
  customers: new Map(),     // gid -> customer
  byNumericId: new Map(),   // numeric id -> customer (orders only carry the number)
  customersLoaded: false,
  orders: [],               // compact orders, newest first
  ordersByCustomer: new Map(),
  ordersWindowStart: null,  // ISO date the order data reaches back to
  ordersSyncedAt: null,
  ordersSyncing: false,
  ordersProgress: 0,
  ordersError: null,
  templates: [],
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(what) { listeners.forEach((fn) => fn(what)); }

const parseJson = (raw, fallback) => {
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : fallback; } catch (err) { return fallback; }
};
export const numericId = (gid) => String(gid || '').split('/').pop();
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const addDaysISO = (iso, days) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const uid = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------------
// Boot: shop, granted scopes, templates
// ---------------------------------------------------------------------------
export async function loadBoot() {
  const data = await gql(`query Boot {
    shop { name myshopifyDomain currencyCode ianaTimezone }
    currentAppInstallation {
      id
      accessScopes { handle }
      templates: metafield(namespace: "${APP_NS}", key: "${TEMPLATES_KEY}") { value }
    }
  }`);
  state.shop = data.shop;
  window.tradeHubShop = data.shop.myshopifyDomain; // for admin links outside Shopify admin (ui.js adminUrl)
  state.appInstallationId = data.currentAppInstallation.id;
  state.scopes = new Set(data.currentAppInstallation.accessScopes.map((s) => s.handle));
  const saved = parseJson(data.currentAppInstallation.templates && data.currentAppInstallation.templates.value, null);
  state.templates = Array.isArray(saved) ? saved : [];
}

export const hasScope = (handle) => state.scopes.has(handle) || state.scopes.has(handle.replace(/^read_/, 'write_'));
export const hasAllOrders = () => state.scopes.has('read_all_orders');

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
export const CUSTOMER_FIELDS = `
  id displayName firstName lastName
  defaultEmailAddress { emailAddress }
  defaultPhoneNumber { phoneNumber }
  defaultAddress { company city countryCodeV2 }
  tags note createdAt numberOfOrders
  amountSpent { amount }
  lastOrder { createdAt processedAt }
  offer: metafield(namespace: "${NS}", key: "${OFFER_KEY}") { value }
  crm: metafield(namespace: "${NS}", key: "${CRM_KEY}") { value }`;

/**
 * The CRM record. `profile` holds what Shopify's customer doesn't (or that
 * came over from the old Notion tracker): company, contact, financeEmail,
 * otherEmails, phone, address, labels, lastContacted, notionId. Unknown
 * keys are kept so an older copy of the app can't strip a newer one's data.
 */
export function normalizeCrm(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    ...r,
    stage: r.stage || '',
    profile: r.profile && typeof r.profile === 'object' ? r.profile : {},
    log: Array.isArray(r.log) ? r.log : [],
  };
}

export function normalizeCustomer(node) {
  const id = numericId(node.id);
  const email = node.defaultEmailAddress && node.defaultEmailAddress.emailAddress;
  const fullName = [node.firstName, node.lastName].filter(Boolean).join(' ');
  return withProfile({
    id: node.id,
    numericId: id,
    // Name/email come back blank without protected-customer-data access.
    name: node.displayName || fullName || email || `Customer ${id}`,
    firstName: node.firstName || '',
    lastName: node.lastName || '',
    email: email || '',
    shopifyPhone: (node.defaultPhoneNumber && node.defaultPhoneNumber.phoneNumber) || '',
    addressCompany: (node.defaultAddress && node.defaultAddress.company) || '',
    hasAddress: !!node.defaultAddress,
    city: (node.defaultAddress && node.defaultAddress.city) || '',
    country: (node.defaultAddress && node.defaultAddress.countryCodeV2) || '',
    tags: node.tags || [],
    note: node.note || '',
    createdAt: node.createdAt,
    numberOfOrders: Number(node.numberOfOrders) || 0,
    amountSpent: Number(node.amountSpent && node.amountSpent.amount) || 0,
    // processedAt: an order imported with a back-dated date is "created" today.
    lastOrderAt: (node.lastOrder && (node.lastOrder.processedAt || node.lastOrder.createdAt)) || null,
    offer: parseJson(node.offer && node.offer.value, null),
    crm: normalizeCrm(parseJson(node.crm && node.crm.value, null)),
  });
}

// Fields that read through to the CRM profile, re-derived whenever it
// changes. The CRM's company name wins: it's the one set here (or brought
// over from Notion); the address one is whatever was typed at checkout.
function withProfile(c) {
  const p = c.crm.profile;
  c.company = p.company || c.addressCompany;
  c.contact = p.contact || '';
  c.phone = c.shopifyPhone || p.phone || '';
  return c;
}

function putCustomer(c) {
  state.customers.set(c.id, c);
  state.byNumericId.set(c.numericId, c);
  return c;
}

/** Adds (or replaces) a customer from a query that selected CUSTOMER_FIELDS. */
export function rememberCustomer(node) {
  const c = putCustomer(normalizeCustomer(node));
  emit('customers');
  return c;
}

export async function loadCustomers(onProgress) {
  const nodes = await paginate(
    (n) => `query Customers($after: String, $q: String) {
      customers(first: ${n}, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        nodes { ${CUSTOMER_FIELDS} }
      }
    }`,
    { q: `tag:${TAGS.dealer}` }, (d) => d.customers, { pageSize: 80, onPage: onProgress },
  );
  state.customers = new Map();
  state.byNumericId = new Map();
  nodes.forEach((n) => putCustomer(normalizeCustomer(n)));
  state.customersLoaded = true;
  emit('customers');
}

export async function refreshCustomer(id) {
  const data = await gql(`query One($id: ID!) { customer(id: $id) { ${CUSTOMER_FIELDS} } }`, { id });
  if (!data.customer) return null;
  const c = putCustomer(normalizeCustomer(data.customer));
  emit('customer');
  return c;
}

export const isDealer = (c) => !!c && c.tags.includes(TAGS.dealer);
export const isTerms = (c) => !!c && c.tags.includes(TAGS.terms);
/** Trade accounts are known by their gym/shop name. */
export const label = (c) => (!c ? '' : c.company || c.name);
/** The other half of label(): who you deal with there. */
export const sublabel = (c) => {
  if (!c) return '';
  if (c.contact) return c.contact;
  return label(c) !== c.name && c.name !== c.email ? c.name : '';
};
/** "DOODLE Zinc Oxide Climbing Tape" -> "DOODLE" -- how the range is talked about. */
export const shortTape = (title) => String(title || '').replace(/\s+(zinc oxide\s+)?climbing tape$/i, '').trim() || title;

/** "36 items · DOODLE, CAUTION" for an order list; an imported Notion invoice has no products to list. */
export function orderSummary(o) {
  if (o.imp) return 'Invoice total from Notion';
  const units = o.lines.reduce((n, l) => n + l[2], 0);
  return `${units} item${units === 1 ? '' : 's'} · ${[...new Set(o.lines.map((l) => shortTape(l[0])))].join(', ')}`;
}

const CONTACT_TYPES = ['call', 'email', 'meeting', 'sample'];
/** When you were last in touch: the latest call/email/visit/samples logged, or the date carried over from Notion. */
export function lastContact(c) {
  let latest = (c.crm.profile.lastContacted || '').slice(0, 10);
  for (const e of c.crm.log) {
    const day = String(e.at || '').slice(0, 10);
    if (CONTACT_TYPES.includes(e.type) && day > latest) latest = day;
  }
  return latest || null;
}

/** Every customer added here is a trade account: tagged "b2b" for trade pricing and B2B shipping. */
export async function createCustomer({ firstName, lastName, email, phone, company, note }) {
  const input = { firstName, lastName, note: note || undefined, tags: [TAGS.dealer] };
  if (email) input.email = email;
  if (phone) input.phone = phone;
  if (company) input.addresses = [{ company, firstName, lastName }];
  const data = assertOk(await gql(`mutation Create($input: CustomerInput!) {
    customerCreate(input: $input) { customer { ${CUSTOMER_FIELDS} } userErrors { field message } }
  }`, { input }));
  const c = putCustomer(normalizeCustomer(data.customerCreate.customer));
  await writeCrm(c, (crm) => ({
    ...crm,
    profile: { ...crm.profile, ...(company ? { company } : {}) },
    log: [newLogEntry({ type: 'auto', text: 'Added as a trade account' }), ...crm.log],
  }));
  emit('customers');
  return c;
}

/** Saves the details card (company, contact, emails, phone, address...) into the CRM profile. */
export const saveProfile = (customer, patch) => writeCrm(customer, (crm) => ({ ...crm, profile: { ...crm.profile, ...patch } }));

export async function setTag(customer, tag, on, logText) {
  const field = on ? 'tagsAdd' : 'tagsRemove';
  assertOk(await gql(`mutation Tag($id: ID!, $tags: [String!]!) { ${field}(id: $id, tags: $tags) { userErrors { field message } } }`, { id: customer.id, tags: [tag] }));
  customer.tags = on ? [...new Set([...customer.tags, tag])] : customer.tags.filter((t) => t !== tag);
  if (logText) await addLog(customer, { type: 'auto', text: logText });
  emit('customer');
}

export async function saveNote(customer, note) {
  assertOk(await gql(`mutation Note($input: CustomerInput!) { customerUpdate(input: $input) { userErrors { field message } } }`, { input: { id: customer.id, note } }));
  customer.note = note;
  emit('customer');
}

// ---------------------------------------------------------------------------
// CRM record (stage + comms log) -- JSON metafield tapedup.crm
// ---------------------------------------------------------------------------
export const LOG_TYPES = {
  call: { label: 'Call', icon: 'phone' },
  email: { label: 'Email', icon: 'mail' },
  meeting: { label: 'Meeting / visit', icon: 'handshake' },
  sample: { label: 'Samples sent', icon: 'package' },
  note: { label: 'Note', icon: 'notebook-pen' },
  auto: { label: 'Update', icon: 'refresh-cw' },
};
// The sales pipeline. Every trade account sits in exactly one stage.
// `hint` is what should happen next, shown on the pipeline board.
export const PIPELINE = [
  { key: 'Prospect', hint: 'Send the intro and sample offer', tone: 'lead' },
  { key: 'Contacted', hint: 'Follow up after 4 days, then 9', tone: 'new' },
  { key: 'Replied', hint: 'Answer and offer the sample', tone: 'new' },
  { key: 'Sample sent', hint: 'Check in 5 days after delivery', tone: 'due' },
  { key: 'Account opened', hint: 'Nudge towards a first order', tone: 'due' },
  { key: 'Active dealer', hint: 'Reorder reminders', tone: 'active' },
  { key: 'Lapsed', hint: 'Win-back offer', tone: 'risk' },
  { key: 'Not now', hint: 'Re-introduce in 90 days', tone: 'lapsed' },
  { key: 'Lost', hint: 'No contact', tone: 'lapsed' },
];
export const STAGES = PIPELINE.map((p) => p.key);

// Stages saved by earlier versions of Trade Hub, read as their pipeline stage.
// They're only rewritten when someone moves the customer, so nothing is lost.
export const LEGACY_STAGES = { Lead: 'Prospect', Prospect: 'Contacted', Customer: 'Active dealer', 'Key account': 'Active dealer', Inactive: 'Lapsed' };

/**
 * A customer's pipeline stage: the saved one (old names mapped across), or,
 * when none is saved, a best guess from their orders, flagged as `guessed`
 * so the board can show it isn't a decision anyone made.
 */
export function stageOf(c, now = Date.now()) {
  const saved = c && c.crm && c.crm.stage;
  if (saved && STAGES.includes(saved)) return { stage: saved, guessed: false };
  if (saved && LEGACY_STAGES[saved]) return { stage: LEGACY_STAGES[saved], guessed: false, legacy: saved };
  const s = insights(c, now).status;
  if (s === 'lead') return { stage: 'Prospect', guessed: true };
  if (s === 'lapsed' || s === 'risk') return { stage: 'Lapsed', guessed: true };
  return { stage: 'Active dealer', guessed: true };
}
/** Key accounts keep a label when their old stage is mapped to Active dealer. */
export const isKeyAccount = (c) => (c.crm.stage === 'Key account') || (c.crm.profile.labels || []).includes('key-account');

export async function writeCrm(customer, mutate) {
  // Re-read just before writing so two people logging on the same customer
  // don't overwrite each other's entries.
  const data = await gql(`query Crm($id: ID!) { customer(id: $id) { crm: metafield(namespace: "${NS}", key: "${CRM_KEY}") { value } } }`, { id: customer.id });
  const crm = mutate(normalizeCrm(parseJson(data.customer && data.customer.crm && data.customer.crm.value, null)));
  assertOk(await gql(`mutation SaveCrm($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, {
    m: [{ ownerId: customer.id, namespace: NS, key: CRM_KEY, type: 'json', value: JSON.stringify(crm) }],
  }));
  customer.crm = crm;
  withProfile(customer);
  emit('customer');
  return crm;
}

export const newLogEntry = ({ id, type, text, at, followUp }) => ({
  id: id || uid('l'), type: LOG_TYPES[type] ? type : 'note', at: at || new Date().toISOString(), text: text || '', followUp: followUp || '', done: false,
});

export const addLog = (customer, entry) => writeCrm(customer, (crm) => ({ ...crm, log: [newLogEntry(entry), ...crm.log] }));
export const updateLog = (customer, id, patch) => writeCrm(customer, (crm) => ({ ...crm, log: crm.log.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
export const deleteLog = (customer, id) => writeCrm(customer, (crm) => ({ ...crm, log: crm.log.filter((e) => e.id !== id) }));
export const setStage = (customer, stage) => writeCrm(customer, (crm) => {
  // A key account moved off its old "Key account" stage keeps the distinction as a label.
  const labels = crm.profile.labels || [];
  const keepKey = crm.stage === 'Key account' && stage !== 'Key account' && !labels.includes('key-account');
  const profile = keepKey ? { ...crm.profile, labels: [...labels, 'key-account'] } : crm.profile;
  const log = crm.stage !== stage && stage
    ? [newLogEntry({ type: 'auto', text: `Stage: ${stageOf({ ...customer, crm }).stage} → ${stage}` }), ...crm.log]
    : crm.log;
  return { ...crm, stage, stageChangedAt: new Date().toISOString(), profile, log };
});

/** Every open follow-up across all customers, soonest first. */
export function followUps() {
  const out = [];
  for (const c of state.customers.values()) {
    for (const e of c.crm.log) if (e.followUp && !e.done) out.push({ customer: c, entry: e });
  }
  return out.sort((a, b) => a.entry.followUp.localeCompare(b.entry.followUp));
}

// ---------------------------------------------------------------------------
// Starter offers + templates
// ---------------------------------------------------------------------------
export function offerStatus(c) {
  const offer = c && c.offer;
  if (!offer) return null;
  if (c.numberOfOrders > Number(offer.ordersAtAssignment || 0)) return 'Used';
  if (offer.expiresOn && todayISO() > offer.expiresOn) return 'Expired';
  return 'Waiting';
}

const pounds = (n) => `£${Number(n).toFixed(Number(n) % 1 ? 2 : 0)}`;
export const round2 = (n) => Math.round(n * 100) / 100;
const pctText = (n) => `${Math.round(Number(n) * 10) / 10}%`;

/** "£150 pack" for a fixed-price pack; older offers were set as a % or £ off. */
export function offerHeadline(o) {
  if (o.packPrice) return `${pounds(o.packPrice)} pack`;
  return o.discountType === 'fixedAmount' ? `${pounds(o.discountValue)} off` : `${o.discountValue}% off`;
}

export function describeOffer(o) {
  const units = (o.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const what = `${units} item${units === 1 ? '' : 's'}`;
  if (o.packPrice) return `${what} · ${pounds(o.packPrice)} for the pack (${pctText(o.discountValue)} off trade)`;
  return `${what} · ${offerHeadline(o)} the whole order`;
}

// ---- Trade prices -------------------------------------------------------
// Same rule as the b2b-wholesale-pricing function in tapedup-payment-rules:
// a variant's custom.wholesale_price if it undercuts the selling price (a
// wholesale price that doesn't undercut means no trade discount at all),
// otherwise a flat % off. Keep TRADE_FALLBACK_PERCENT in step with
// FALLBACK_DISCOUNT_PERCENT in that function.
export const TRADE_FALLBACK_PERCENT = 20;
const priceCache = new Map(); // variant gid -> { retail, trade } (null if the variant is gone)

function tradePriceOf(node) {
  const retail = Number(node.price) || 0;
  const wholesale = node.wholesale && node.wholesale.jsonValue;
  if (wholesale && wholesale.amount !== undefined) {
    const amount = Number(wholesale.amount);
    return { retail, trade: Number.isFinite(amount) && amount < retail ? amount : retail };
  }
  return { retail, trade: round2(retail * (1 - TRADE_FALLBACK_PERCENT / 100)) };
}

/** Map of variant gid -> { retail, trade } per unit, or null for a deleted variant. */
export async function tradePrices(variantIds) {
  const ids = [...new Set(variantIds)];
  const missing = ids.filter((id) => !priceCache.has(id));
  for (const group of chunk(missing, 100)) {
    const data = await gql(`query Prices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant {
      id price wholesale: metafield(namespace: "custom", key: "wholesale_price") { jsonValue }
    } } }`, { ids: group });
    group.forEach((id) => priceCache.set(id, null));
    for (const node of data.nodes) if (node && node.id) priceCache.set(node.id, tradePriceOf(node));
  }
  return new Map(ids.map((id) => [id, priceCache.get(id)]));
}

/** A template's expiry is relative ("14 days after it's given"); an offer's is a date. */
export function offerFromTemplate(t) {
  return {
    items: (t.items || []).map(({ productId, variantId, title, image, quantity }) => ({ productId, variantId, title, image, quantity })),
    discountType: t.discountType === 'fixedAmount' ? 'fixedAmount' : 'percentage',
    discountValue: Number(t.discountValue) || 0,
    // The pack price is what's promised; the % is re-worked from today's
    // trade prices when the offer is given (see the offer form).
    ...(t.packPrice ? { packPrice: Number(t.packPrice), tradeTotal: Number(t.tradeTotal) || 0 } : {}),
    message: t.message || '',
    expiresOn: t.expiresInDays ? addDaysISO(todayISO(), Number(t.expiresInDays)) : '',
    autoAdd: t.autoAdd !== false,
    templateId: t.id || '',
    templateName: t.name || '',
  };
}

export const defaultTemplate = () => state.templates.find((t) => t.isDefault) || state.templates[0] || null;

export async function saveTemplates(list) {
  assertOk(await gql(`mutation SaveTemplates($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, {
    m: [{ ownerId: state.appInstallationId, namespace: APP_NS, key: TEMPLATES_KEY, type: 'json', value: JSON.stringify(list) }],
  }));
  state.templates = list;
  emit('templates');
}

export function newTemplateId() { return uid('t'); }


/**
 * Gives `offer` (from offerFromTemplate, or edited) to every customer in the
 * list: snapshots each one's current order count (the offer is spent once
 * they go past it), writes the offer + a CRM log line, and tags them
 * "starter-order". Batched so 50 customers is a handful of calls.
 */
export async function giveOffer(customers, offer) {
  const now = new Date().toISOString();
  for (const group of chunk(customers, 12)) {
    const fresh = await gql(`query Fresh($ids: [ID!]!) { nodes(ids: $ids) { ... on Customer {
      id numberOfOrders
      offer: metafield(namespace: "${NS}", key: "${OFFER_KEY}") { value }
      crm: metafield(namespace: "${NS}", key: "${CRM_KEY}") { value }
    } } }`, { ids: group.map((c) => c.id) });
    const metafields = [];
    const updates = [];
    for (const node of fresh.nodes.filter(Boolean)) {
      const c = state.customers.get(node.id);
      const numberOfOrders = Number(node.numberOfOrders) || 0;
      const previous = parseJson(node.offer && node.offer.value, null);
      // assignedAt keys the theme's once-only auto-add. Keep it if the same
      // products are re-given while the old offer is still waiting, so the
      // site doesn't drop them in the cart a second time.
      const itemsKey = (items) => JSON.stringify((items || []).map((i) => [i.variantId, Number(i.quantity)]));
      const previousWaiting = previous && numberOfOrders <= Number(previous.ordersAtAssignment || 0) && !(previous.expiresOn && todayISO() > previous.expiresOn);
      const keepKey = previous && previous.assignedAt && previousWaiting && itemsKey(previous.items) === itemsKey(offer.items);
      const saved = { ...offer, ordersAtAssignment: numberOfOrders, assignedAt: keepKey ? previous.assignedAt : now };
      const crm = normalizeCrm(parseJson(node.crm && node.crm.value, null));
      const logText = `Starter offer ${previous ? 'updated' : 'given'}${offer.templateName ? ` (${offer.templateName})` : ''}: ${describeOffer(saved)}${saved.expiresOn ? `, until ${saved.expiresOn}` : ''}`;
      const nextCrm = { ...crm, log: [newLogEntry({ type: 'auto', text: logText }), ...crm.log] };
      metafields.push(
        { ownerId: node.id, namespace: NS, key: OFFER_KEY, type: 'json', value: JSON.stringify(saved) },
        { ownerId: node.id, namespace: NS, key: CRM_KEY, type: 'json', value: JSON.stringify(nextCrm) },
      );
      updates.push({ c, numberOfOrders, saved, nextCrm });
    }
    if (!updates.length) continue;
    const tagVars = {};
    const tagCalls = updates.map((u, i) => { tagVars[`id${i}`] = u.c.id; return `t${i}: tagsAdd(id: $id${i}, tags: $tags) { userErrors { field message } }`; });
    assertOk(await gql(`mutation Give($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: metafields }));
    assertOk(await gql(`mutation Tag(${updates.map((_, i) => `$id${i}: ID!`).join(', ')}, $tags: [String!]!) { ${tagCalls.join(' ')} }`, { ...tagVars, tags: [TAGS.starter] }));
    for (const u of updates) {
      Object.assign(u.c, { numberOfOrders: u.numberOfOrders, offer: u.saved, crm: u.nextCrm, tags: [...new Set([...u.c.tags, TAGS.starter])] });
    }
  }
  emit('customers');
}

export async function removeOffer(customer) {
  assertOk(await gql(`mutation Remove($mf: [MetafieldIdentifierInput!]!, $id: ID!, $tags: [String!]!) {
    metafieldsDelete(metafields: $mf) { userErrors { field message } }
    tagsRemove(id: $id, tags: $tags) { userErrors { field message } }
  }`, { mf: [{ ownerId: customer.id, namespace: NS, key: OFFER_KEY }], id: customer.id, tags: [TAGS.starter] }));
  customer.offer = null;
  customer.tags = customer.tags.filter((t) => t !== TAGS.starter);
  await addLog(customer, { type: 'auto', text: 'Starter offer removed' });
  emit('customers');
}

// ---------------------------------------------------------------------------
// Orders: synced + cached, then everything below is computed from them
// ---------------------------------------------------------------------------
// Order history brought over from the old Notion tracker is tagged this
// (see importer.js). Those orders are one "Trade order INV-0123" line at the
// invoice value, so they count towards spend but not towards best tapes.
export const IMPORT_TAG = 'notion-import';

const ORDER_FIELDS = `
  id name createdAt processedAt updatedAt cancelledAt test tags
  displayFinancialStatus displayFulfillmentStatus
  customer { id }
  currentTotalPriceSet { shopMoney { amount } }
  lineItems(first: 20) { nodes { title variantTitle quantity discountedTotalSet { shopMoney { amount } } } }`;

const compactOrder = (o) => ({
  id: numericId(o.id),
  name: o.name,
  // processedAt is when it was placed; an imported order is back-dated
  // there but "created" on the day it was imported.
  at: o.processedAt || o.createdAt,
  cust: o.customer ? numericId(o.customer.id) : null,
  total: Number(o.currentTotalPriceSet.shopMoney.amount) || 0,
  pay: o.displayFinancialStatus || '',
  ful: o.displayFulfillmentStatus || '',
  x: o.cancelledAt ? 1 : 0,
  test: o.test ? 1 : 0,
  imp: (o.tags || []).includes(IMPORT_TAG) ? 1 : 0,
  // [product title, variant title, quantity, line total after line discounts]
  lines: o.lineItems.nodes.map((l) => [l.title, l.variantTitle || '', l.quantity, Number(l.discountedTotalSet.shopMoney.amount) || 0]),
});

const CACHE_VERSION = 2;
const cacheKey = () => `tuAdminOrders:v${CACHE_VERSION}:${state.shop.myshopifyDomain}`;
function readCache() {
  try { return JSON.parse(localStorage.getItem(cacheKey()) || 'null'); } catch (err) { return null; }
}
function writeCache(value) {
  try { localStorage.setItem(cacheKey(), JSON.stringify(value)); } catch (err) { /* full or blocked -- next open just syncs from scratch */ }
}

function indexOrders() {
  const map = new Map();
  for (const o of state.orders) {
    if (!o.cust) continue;
    if (!map.has(o.cust)) map.set(o.cust, []);
    map.get(o.cust).push(o);
  }
  state.ordersByCustomer = map;
}

/** Without read_all_orders Shopify only returns the last 60 days. */
export function orderWindowStart() {
  const d = new Date();
  if (hasAllOrders()) d.setMonth(d.getMonth() - 24); else d.setDate(d.getDate() - 60);
  return d.toISOString().slice(0, 10);
}

export function loadCachedOrders() {
  const cache = readCache();
  if (!cache || !Array.isArray(cache.orders)) return false;
  state.orders = cache.orders;
  state.ordersWindowStart = cache.windowStart;
  state.ordersSyncedAt = cache.syncedAt;
  state.ordersCheckedAt = cache.checkedAt || cache.syncedAt;
  indexOrders();
  return true;
}

/**
 * Only trade accounts' orders are synced: one search per 40 customers
 * ("(customer_id:1 OR customer_id:2 ...) AND <date filter>"), so a store full
 * of retail orders doesn't slow the app down. The cache remembers which
 * customers it covers; anyone newly tagged "b2b" gets their whole window
 * fetched, everyone else just what changed since the last sync.
 */
async function fetchOrdersFor(customerIds, filter, onProgress) {
  const out = [];
  for (const group of chunk(customerIds, 40)) {
    const q = `(${group.map((id) => `customer_id:${id}`).join(' OR ')}) AND ${filter}`;
    const nodes = await paginate(
      (n) => `query Orders($after: String, $q: String) {
        orders(first: ${n}, after: $after, query: $q, sortKey: UPDATED_AT) {
          pageInfo { hasNextPage endCursor }
          nodes { ${ORDER_FIELDS} }
        }
      }`,
      { q }, (d) => d.orders,
      { pageSize: 25, onPage: (count) => onProgress(out.length + count) },
    );
    out.push(...nodes);
  }
  return out;
}

export async function syncOrders({ full = false } = {}) {
  if (state.ordersSyncing) return;
  state.ordersSyncing = true;
  state.ordersError = null;
  state.ordersProgress = 0;
  emit('orders-sync');
  try {
    const windowStart = orderWindowStart();
    const cache = full ? null : readCache();
    const usable = cache && cache.syncedAt && cache.windowStart <= windowStart && cache.allOrders === hasAllOrders();
    const ids = [...state.customers.values()].map((c) => c.numericId);
    const covered = new Set(usable ? cache.customers || [] : []);
    const known = ids.filter((id) => covered.has(id));
    const added = ids.filter((id) => !covered.has(id));
    const startedAt = new Date();
    let done = 0;
    const progress = (base) => (count) => { state.ordersProgress = base + count; emit('orders-progress'); };
    const fresh = [];
    if (known.length) fresh.push(...await fetchOrdersFor(known, `updated_at:>='${cache.syncedAt}'`, progress(done)));
    done = fresh.length;
    if (added.length) fresh.push(...await fetchOrdersFor(added, `processed_at:>='${windowStart}'`, progress(done)));
    const keep = new Set(ids);
    const byId = new Map((usable ? cache.orders : []).filter((o) => keep.has(o.cust)).map((o) => [o.id, o]));
    fresh.forEach((o) => byId.set(numericId(o.id), compactOrder(o)));
    state.orders = [...byId.values()].filter((o) => o.at.slice(0, 10) >= windowStart).sort((a, b) => b.at.localeCompare(a.at));
    state.ordersWindowStart = windowStart;
    // A few minutes' overlap so an order saved mid-sync is never skipped.
    state.ordersSyncedAt = new Date(startedAt.getTime() - 5 * 60000).toISOString();
    state.ordersCheckedAt = new Date().toISOString();
    indexOrders();
    writeCache({ syncedAt: state.ordersSyncedAt, checkedAt: state.ordersCheckedAt, windowStart, allOrders: hasAllOrders(), customers: ids, orders: state.orders });
  } catch (err) {
    state.ordersError = err.message;
  } finally {
    state.ordersSyncing = false;
    emit('orders');
  }
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------
export const countable = (o) => !o.x && !o.test;
const sum = (list, fn) => list.reduce((s, x) => s + fn(x), 0);
const median = (list) => { const s = [...list].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export const STATUS = {
  active: { label: 'Active', hint: 'Ordering on their usual rhythm' },
  new: { label: 'New', hint: 'First order in the last 60 days' },
  due: { label: 'Due to reorder', hint: 'Past their usual gap between orders' },
  risk: { label: 'At risk', hint: 'Well past their usual gap' },
  lapsed: { label: 'Lapsed', hint: 'No order in a long time' },
  lead: { label: 'No orders yet', hint: 'Never ordered' },
};

/** Change between the last `days` and the `days` before, or null if the order data doesn't reach back far enough. */
export function compare(orders, days, now = Date.now()) {
  const start = now - days * DAY;
  const prevStart = now - 2 * days * DAY;
  if (!state.ordersWindowStart || Date.parse(state.ordersWindowStart) > prevStart + DAY) return null;
  const cur = sum(orders.filter((o) => Date.parse(o.at) >= start), (o) => o.total);
  const prev = sum(orders.filter((o) => { const t = Date.parse(o.at); return t >= prevStart && t < start; }), (o) => o.total);
  let dir = 'flat';
  if (!cur && !prev) dir = 'none';
  else if (!prev) dir = 'new';
  else if (cur >= prev * 1.1) dir = 'up';
  else if (cur <= prev * 0.9) dir = 'down';
  return { cur, prev, pct: prev ? (cur - prev) / prev : null, dir };
}

export function topProducts(orders, limit = 6) {
  const map = new Map();
  for (const o of orders) {
    if (o.imp) continue; // one lump-sum line, no products to rank
    for (const [title, , qty, amount] of o.lines) {
      const row = map.get(title) || { title, units: 0, revenue: 0 };
      row.units += qty;
      row.revenue += amount;
      map.set(title, row);
    }
  }
  return [...map.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue).slice(0, limit);
}

export function insights(c, now = Date.now()) {
  const orders = (state.ordersByCustomer.get(c.numericId) || []).filter(countable);
  // Synced orders first: Shopify's lastOrder is the last one *created*,
  // which after an import can be an old back-dated order.
  const lastAt = (orders[0] && orders[0].at) || c.lastOrderAt || null;
  const daysSince = lastAt ? Math.floor((now - Date.parse(lastAt)) / DAY) : null;
  const times = orders.map((o) => Date.parse(o.at)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY);
  const gap = gaps.length ? median(gaps) : null;

  let status;
  if (!c.numberOfOrders && !orders.length) status = 'lead';
  else if (c.numberOfOrders <= 1 && daysSince !== null && daysSince <= 60) status = 'new';
  else {
    const typical = Math.max(gap || 60, 21);
    if (daysSince === null) status = 'lapsed';
    else if (daysSince <= typical * 1.25) status = 'active';
    else if (daysSince <= typical * 2) status = 'due';
    else if (daysSince <= Math.max(typical * 4, 180)) status = 'risk';
    else status = 'lapsed';
  }

  const products = topProducts(orders, 5);
  return {
    orders,
    lastAt,
    daysSince,
    gap,
    status,
    // Only meaningful for someone who orders regularly: an occasional
    // buyer would flip between "New" and "-100%" on every order.
    trend: orders.length >= 3 && (!gap || gap <= 75) ? compare(orders, 90, now) : null,
    topProduct: products[0] ? products[0].title : '',
    products,
    aov: c.numberOfOrders ? c.amountSpent / c.numberOfOrders : 0,
  };
}

/** Bucketed revenue for a column chart: daily for <= 31 days, weekly for <= 120, else monthly. */
export function revenueSeries(orders, days, now = Date.now()) {
  const buckets = [];
  const end = new Date(now);
  if (days > 120) {
    const months = Math.round(days / 30.4);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
      buckets.push({ start: d.getTime(), end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(), label: d.toLocaleDateString('en-GB', { month: 'short' }), long: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), value: 0, count: 0 });
    }
  } else {
    const step = days > 31 ? 7 : 1;
    const startDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1).getTime();
    for (let t = startDay; t <= now; t += step * DAY) {
      const d = new Date(t);
      const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      buckets.push({ start: t, end: t + step * DAY, label, long: step === 7 ? `Week of ${label}` : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), value: 0, count: 0 });
    }
  }
  for (const o of orders) {
    const t = Date.parse(o.at);
    const b = buckets.find((x) => t >= x.start && t < x.end);
    if (b) { b.value += o.total; b.count += 1; }
  }
  return buckets;
}

export function dashboard({ days }, now = Date.now()) {
  const start = now - days * DAY;
  const prevStart = now - 2 * days * DAY;
  const all = state.orders.filter(countable);
  const cur = all.filter((o) => Date.parse(o.at) >= start);
  const prev = all.filter((o) => { const t = Date.parse(o.at); return t >= prevStart && t < start; });
  const comparable = !!state.ordersWindowStart && Date.parse(state.ordersWindowStart) <= prevStart + DAY;
  const kpi = (fn) => ({ cur: fn(cur), prev: comparable ? fn(prev) : null });
  const customersIn = (list) => new Set(list.map((o) => o.cust).filter(Boolean)).size;

  // Per-customer revenue in both periods -> leaderboard and movers.
  const per = new Map();
  for (const o of [...cur, ...prev]) {
    if (!o.cust) continue;
    const row = per.get(o.cust) || { cur: 0, prev: 0, orders: 0, list: [] };
    if (Date.parse(o.at) >= start) { row.cur += o.total; row.orders += 1; row.list.push(o); } else row.prev += o.total;
    per.set(o.cust, row);
  }
  const rows = [...per.entries()].map(([id, r]) => ({ customer: state.byNumericId.get(id), ...r })).filter((r) => r.customer);
  const dealers = rows.filter((r) => r.cur > 0).sort((a, b) => b.cur - a.cur).slice(0, 8)
    .map((r) => ({ ...r, topProduct: (topProducts(r.list, 1)[0] || {}).title || '' }));
  const movers = comparable ? rows.filter((r) => r.prev > 0 || r.cur > 0).map((r) => ({ ...r, delta: r.cur - r.prev })) : [];

  return {
    comparable,
    revenue: kpi((l) => sum(l, (o) => o.total)),
    orders: kpi((l) => l.length),
    customers: kpi(customersIn),
    aov: kpi((l) => (l.length ? sum(l, (o) => o.total) / l.length : 0)),
    series: revenueSeries(cur, days, now),
    products: topProducts(cur, 8),
    dealers,
    growing: movers.filter((r) => r.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5),
    slowing: movers.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5),
  };
}
