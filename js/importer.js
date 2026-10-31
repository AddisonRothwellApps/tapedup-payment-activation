// Brings the old Notion dealer tracker into Trade Hub. Each dealer becomes
// (or is linked to) a trade account, their Notion details and call notes go
// into the CRM record, and their invoices become real Shopify orders --
// back-dated, archived, no emails, no stock -- so they show in the
// customer's order history on the site and in every total here.
//
// The data is a JSON file exported from Notion, chosen in the browser. It's
// customer data, so it never lives in this repo (the site is public):
//   { dealers: [{ notionId, name, contact, email, otherEmails[], financeEmail,
//       phone, address, lastContacted, visited, notes, calls: [{ date, text }],
//       warnings[], orders: [{ notionId, invoice, date, value,
//       payment: Paid|Unpaid|Terms|Prizes, status: Fullfilled|Pending|HOLD, due }] }] }
//
// Safe to run again: dealers are found by the Notion id saved in their CRM
// profile, and orders by sourceIdentifier (the Notion page id) on orders
// tagged notion-import, so a second run only adds what's missing.
import { gql, assertOk, paginate } from './api.js';
import {
  state, CUSTOMER_FIELDS, IMPORT_TAG, TAGS, normalizeCustomer, rememberCustomer, refreshCustomer, writeCrm, newLogEntry, round2, offerStatus,
} from './store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const lower = (s) => String(s || '').trim().toLowerCase();
const GENERIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'aol.com', 'btinternet.com', 'sky.com']);
const domainOf = (email) => lower(email).split('@')[1] || '';
/** "The Boulder Barn Ltd" and "boulder barn" compare equal. */
const norm = (s) => lower(s).replace(/&/g, 'and').replace(/\b(the|ltd|limited|llp)\b/g, '').replace(/[^a-z0-9]/g, '');

export const isPrize = (o) => o.payment === 'Prizes';
export const isPaid = (o) => o.payment === 'Paid' || isPrize(o);
export const isFulfilled = (o) => o.status === 'Fullfilled' || o.status === 'Fulfilled';
/** What the order will be worth in Shopify: prizes were given away, so they go in at £0. */
export const orderValue = (o) => (isPrize(o) ? 0 : round2(Number(o.value) || 0));

export function emailsOf(d) {
  return [...new Set([d.email, ...(d.otherEmails || []), d.financeEmail].map(lower).filter((e) => e.includes('@')))];
}

/** UK numbers to E.164 ("01803 293229" -> "+441803293229"), which Shopify needs. */
export function toE164(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  let out = '';
  if (digits.startsWith('+')) out = digits;
  else if (digits.startsWith('00')) out = `+${digits.slice(2)}`;
  else if (digits.startsWith('0')) out = `+44${digits.slice(1)}`;
  return /^\+\d{10,14}$/.test(out) ? out : '';
}

/** "Unit 4, Imperial Park, Empress Rd, Southampton SO14 0JW" -> { address1, city, zip }, or null if there's no postcode. */
export function parseAddress(text) {
  const parts = String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.pop();
  const m = last && last.match(/^(.*?)\s*([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i);
  if (!m) return null;
  let city = m[1].trim();
  if (!city && parts.length > 1) city = parts.pop(); // "..., Bristol, BS2 9YQ"
  return { address1: parts.join(', ') || city, city, zip: `${m[2]} ${m[3]}`.toUpperCase() };
}

function splitName(contact) {
  const c = String(contact || '').trim();
  if (!c) return ['', ''];
  if (/[/&,]/.test(c)) return [c, '']; // "Pete / Kieran" is two people, not a first + last name
  const i = c.indexOf(' ');
  return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)];
}

export function parseFile(text) {
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error("That file isn't valid JSON."); }
  const dealers = Array.isArray(data) ? data : data && data.dealers;
  if (!Array.isArray(dealers) || !dealers.length || !dealers.every((d) => d && d.notionId && d.name)) {
    throw new Error("That doesn't look like a Notion dealer export: it needs a list of dealers, each with a notionId and name.");
  }
  return dealers.map((d) => ({
    ...d,
    otherEmails: Array.isArray(d.otherEmails) ? d.otherEmails : [],
    calls: Array.isArray(d.calls) ? d.calls.filter((c) => c && c.date && c.text) : [],
    orders: Array.isArray(d.orders) ? d.orders.filter((o) => o && o.notionId && o.date) : [],
    warnings: Array.isArray(d.warnings) ? d.warnings : [],
  }));
}

// ---------------------------------------------------------------------------
// Plan: who each dealer is in Shopify, and which orders still need creating
// ---------------------------------------------------------------------------
async function customersByEmail(emails) {
  const found = new Map(); // email -> normalized customer
  for (const group of chunk(emails, 10)) {
    const q = group.map((e) => `email:"${e.replace(/"/g, '')}"`).join(' OR ');
    const data = await gql(`query MatchEmails($q: String) { customers(first: 50, query: $q) { nodes { ${CUSTOMER_FIELDS} } } }`, { q });
    for (const node of data.customers.nodes) {
      const c = normalizeCustomer(node);
      if (c.email) found.set(lower(c.email), c);
    }
  }
  return found;
}

async function existingOrders(invoices) {
  // Orders this importer made before, by Notion page id.
  const imported = await paginate(
    (n) => `query Imported($after: String, $q: String) { orders(first: ${n}, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor } nodes { id name sourceIdentifier }
    } }`,
    { q: `tag:${IMPORT_TAG}` }, (d) => d.orders, { pageSize: 100 },
  );
  const bySource = new Map(imported.filter((o) => o.sourceIdentifier).map((o) => [o.sourceIdentifier, o.name]));
  // Shopify orders already carrying an invoice's name (e.g. TUP1329, which
  // Notion copied from an online order) -- those are in Shopify already.
  const byName = new Set();
  for (const group of chunk(invoices, 20)) {
    const q = group.map((name) => `name:"${name.replace(/"/g, '')}"`).join(' OR ');
    const data = await gql(`query Named($q: String) { orders(first: 50, query: $q) { nodes { name tags } } }`, { q });
    for (const o of data.orders.nodes) if (!(o.tags || []).includes(IMPORT_TAG)) byName.add(o.name);
  }
  return { bySource, byName };
}

/**
 * Looks every dealer up in Shopify and returns one row per dealer with a
 * suggested choice: link to a strong match (imported before, same email,
 * same name), else create a new trade account. Weaker hints (same email
 * domain) are offered but never picked for you.
 */
export async function buildPlan(dealers) {
  const byEmail = await customersByEmail([...new Set(dealers.flatMap(emailsOf))]);
  const { bySource, byName } = await existingOrders([...new Set(dealers.flatMap((d) => d.orders.map((o) => o.invoice)).filter(Boolean))]);
  const trade = [...state.customers.values()];
  const invoiceUse = new Map();
  for (const d of dealers) for (const o of d.orders) invoiceUse.set(o.invoice, [...(invoiceUse.get(o.invoice) || []), d.name]);

  const rows = dealers.map((d) => {
    const candidates = [];
    const add = (c, how, strong) => { if (c && !candidates.some((x) => x.customer.id === c.id)) candidates.push({ customer: c, how, strong }); };
    add(trade.find((c) => c.crm.profile.notionId === d.notionId), 'imported before', true);
    for (const e of emailsOf(d)) add(state.customers.get((byEmail.get(e) || {}).id) || byEmail.get(e), `same email, ${e}`, true);
    const key = norm(d.name);
    for (const c of trade) if (key && (norm(c.company) === key || norm(c.addressCompany) === key || norm(c.name) === key)) add(c, 'same name', true);
    const domains = emailsOf(d).map(domainOf).filter((dm) => dm && !GENERIC_DOMAINS.has(dm));
    for (const c of trade) if (c.email && domains.includes(domainOf(c.email))) add(c, `same email domain, ${domainOf(c.email)}`, false);

    const orders = d.orders.map((o) => {
      if (bySource.has(o.notionId)) return { ...o, state: 'done', why: `Imported before as ${bySource.get(o.notionId)}` };
      if (byName.has(o.invoice)) return { ...o, state: 'exists', why: `Already in Shopify as ${o.invoice}` };
      return { ...o, state: 'new', why: '' };
    }).sort((a, b) => a.date.localeCompare(b.date));

    const notes = [...d.warnings];
    for (const o of orders) {
      const others = (invoiceUse.get(o.invoice) || []).filter((n) => n !== d.name);
      if (others.length) notes.push(`${o.invoice} is also used by ${others.join(', ')} in Notion. Both are imported as separate orders.`);
      if (isPrize(o)) notes.push(`${o.invoice} was a prize: it goes in at £0, with its £${Number(o.value).toFixed(2)} value in the order note.`);
      else if (!isPaid(o)) notes.push(`${o.invoice} is ${o.payment === 'Terms' ? 'on terms' : 'unpaid'} in Notion, so it goes in as payment pending. Mark it paid in Shopify once it's paid.`);
      if (!isFulfilled(o)) notes.push(`${o.invoice} is "${o.status}" in Notion, so it goes in unfulfilled.`);
    }
    if (d.orders.some((o) => o.payment === 'Terms')) notes.push('Paid on terms in Notion. Switch on "Pays on terms" on their page if they still do.');

    const strong = candidates.find((x) => x.strong);
    return {
      dealer: d,
      // A name already fixed up in Trade Hub beats Notion's spelling on a re-run.
      company: (strong && strong.customer.crm.profile.company) || d.name,
      choice: strong ? `link:${strong.customer.id}` : 'create',
      candidates,
      orders,
      notes,
    };
  });

  // One Shopify customer can only be one dealer: if two dealers both found
  // the same one, keep it for the first and make the other a new account.
  const taken = new Map();
  for (const row of rows) {
    if (!row.choice.startsWith('link:')) continue;
    const id = row.choice.slice(5);
    if (taken.has(id)) {
      row.notes.unshift(`Matched the same Shopify customer as ${taken.get(id)}, so this is set to a new account. Pick the right customer if that's wrong.`);
      row.choice = 'create';
    } else taken.set(id, row.dealer.name);
  }
  return rows;
}

/** Customer behind a row's choice (from the trade list or the email search), or null for create/skip. */
export function chosenCustomer(row) {
  if (!row.choice.startsWith('link:')) return null;
  const id = row.choice.slice(5);
  return state.customers.get(id) || (row.candidates.find((x) => x.customer.id === id) || {}).customer || null;
}

export const ordersToCreate = (row) => row.orders.filter((o) => o.state === 'new');

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const CREATE_CUSTOMER = `mutation ImportCustomer($input: CustomerInput!) {
  customerCreate(input: $input) { customer { ${CUSTOMER_FIELDS} } userErrors { field message } }
}`;

async function createCustomer(d, company) {
  const [firstName, lastName] = splitName(d.contact);
  const input = { firstName, lastName, tags: [TAGS.dealer] };
  if (d.email) input.email = lower(d.email);
  const phone = toE164(d.phone);
  if (phone) input.phone = phone;
  // Shopify needs a name, email or phone; a dealer with none is known by the company.
  const ensureName = () => { if (!input.email && !input.phone && !input.firstName) input.firstName = company; };
  ensureName();
  let data = await gql(CREATE_CUSTOMER, { input });
  let errors = data.customerCreate.userErrors;
  // A landline shared with another customer, or one Shopify won't accept,
  // shouldn't stop the import: the number is kept in the CRM profile instead.
  if (errors.length && input.phone && errors.some((e) => /phone/i.test(`${e.field} ${e.message}`))) {
    delete input.phone;
    ensureName();
    data = await gql(CREATE_CUSTOMER, { input });
    errors = data.customerCreate.userErrors;
  }
  assertOk(data);
  return rememberCustomer(data.customerCreate.customer);
}

async function addAddress(c, d, company) {
  const parsed = parseAddress(d.address);
  const [firstName, lastName] = splitName(d.contact);
  const address = { company, countryCode: 'GB', ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(parsed || {}) };
  const data = await gql(`mutation ImportAddress($id: ID!, $address: MailingAddressInput!) {
    customerAddressCreate(customerId: $id, address: $address, setAsDefault: true) { address { id } userErrors { field message } }
  }`, { id: c.id, address });
  return !data.customerAddressCreate.userErrors.length;
}

function crmFrom(row, c) {
  const d = row.dealer;
  const union = (a, b) => [...new Set([...(a || []), ...(b || [])].filter(Boolean))];
  const own = lower(c.email);
  return (crm) => {
    const p = crm.profile;
    const profile = {
      ...p,
      company: row.company,
      contact: d.contact || p.contact || '',
      phone: d.phone || p.phone || '',
      financeEmail: d.financeEmail || p.financeEmail || '',
      otherEmails: union(p.otherEmails, emailsOf(d).filter((e) => e !== own && e !== lower(d.financeEmail))),
      address: d.address || p.address || '',
      labels: union(p.labels, d.visited ? ['Visited'] : []),
      lastContacted: [p.lastContacted, d.lastContacted].filter(Boolean).sort().pop() || '',
      notionId: d.notionId,
    };
    const have = new Set(crm.log.map((e) => e.id));
    const add = [];
    const push = (entry) => { if (!have.has(entry.id)) add.push(newLogEntry(entry)); };
    d.calls.forEach((call, i) => push({ id: `notion-${d.notionId}-call-${i}`, type: 'call', at: `${call.date}T12:00:00.000Z`, text: call.text }));
    if (d.notes) push({ id: `notion-${d.notionId}-notes`, type: 'note', at: d.lastContacted ? `${d.lastContacted}T12:00:00.000Z` : undefined, text: d.notes });
    const total = d.orders.reduce((s, o) => s + orderValue(o), 0);
    const bits = [`${d.orders.length} order${d.orders.length === 1 ? '' : 's'} (£${total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`];
    if (d.calls.length) bits.push(`${d.calls.length} call note${d.calls.length === 1 ? '' : 's'}`);
    if (d.lastContacted) bits.push(`last contacted ${d.lastContacted}`);
    push({ id: `notion-${d.notionId}-import`, type: 'auto', text: `Brought over from Notion: ${bits.join(', ')}` });
    return { ...crm, stage: crm.stage || (d.orders.length ? 'Customer' : 'Prospect'), profile, log: [...add, ...crm.log] };
  };
}

function orderInput(customerId, o, archive) {
  const value = orderValue(o);
  const paymentText = { Paid: 'paid', Unpaid: 'unpaid', Terms: 'on terms', Prizes: 'prize' }[o.payment] || lower(o.payment);
  const note = [
    `Imported from the Notion dealer tracker. Invoice ${o.invoice}, ${o.date}.`,
    isPrize(o) ? `Prize order worth £${Number(o.value).toFixed(2)}, given free.` : `£${value.toFixed(2)}, ${paymentText}${o.due ? `, due ${o.due}` : ''}.`,
    isFulfilled(o) ? '' : `Notion status: ${o.status}.`,
  ].filter(Boolean).join(' ');
  return {
    customer: { toAssociate: { id: customerId } },
    name: o.invoice,
    processedAt: `${o.date}T12:00:00Z`,
    currency: 'GBP',
    lineItems: [{
      title: `${isPrize(o) ? 'Prize order' : 'Trade order'} ${o.invoice}`,
      quantity: 1,
      priceSet: { shopMoney: { amount: value.toFixed(2), currencyCode: 'GBP' } },
      taxable: false,
      requiresShipping: false,
    }],
    financialStatus: isPaid(o) ? 'PAID' : 'PENDING',
    ...(isFulfilled(o) ? { fulfillmentStatus: 'FULFILLED' } : {}),
    tags: [IMPORT_TAG],
    sourceIdentifier: o.notionId,
    note,
    ...(archive ? { closedAt: new Date().toISOString() } : {}),
  };
}

const CREATE_ORDER = `mutation ImportOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) { order { id name } userErrors { field message } }
}`;
// No receipts or shipping emails, and no stock moved: these are history.
const ORDER_OPTIONS = { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: 'BYPASS' };
const RATE_LIMITED = /too many|rate limit|limit reached|try again/i;

async function createOrder(customerId, o, archive) {
  let order = orderInput(customerId, o, archive);
  for (let attempt = 0; attempt < 4; attempt++) {
    let data;
    try {
      data = await gql(CREATE_ORDER, { order, options: ORDER_OPTIONS });
    } catch (err) {
      if (RATE_LIMITED.test(err.message) && attempt < 3) { await sleep(61000); continue; }
      throw err;
    }
    const errors = data.orderCreate.userErrors;
    if (!errors.length) return data.orderCreate.order;
    if (errors.some((e) => RATE_LIMITED.test(e.message)) && attempt < 3) { await sleep(61000); continue; }
    // If Shopify won't take the invoice number as the order name, fall back
    // to its own numbering; the invoice is still in the line and the note.
    if (order.name && errors.some((e) => /name/i.test(`${e.field} ${e.message}`))) {
      const { name, ...rest } = order;
      order = rest;
      continue;
    }
    throw new Error(`${o.invoice}: ${errors.map((e) => e.message).join('; ')}`);
  }
  throw new Error(`${o.invoice}: Shopify is limiting new orders right now. Run the import again in a few minutes.`);
}

/**
 * Imports one row. `onStep(text)` reports progress. Returns what it did.
 * Orders are only created when `withOrders` (the app has write_orders).
 */
export async function importRow(row, { archive = true, withOrders = true } = {}, onStep = () => {}) {
  const d = row.dealer;
  const result = { created: false, linked: false, tagged: false, orders: 0, addressAdded: false, warnings: [] };
  let c;
  if (row.choice === 'create') {
    onStep('Creating trade account');
    c = await createCustomer(d, row.company);
    result.created = true;
  } else {
    const picked = chosenCustomer(row);
    if (!picked) throw new Error('The chosen Shopify customer is gone.');
    c = await refreshCustomer(picked.id);
    if (!c) throw new Error(`${picked.name} isn't in Shopify any more.`);
    result.linked = true;
    if (!c.tags.includes(TAGS.dealer)) {
      onStep('Making them a trade account');
      assertOk(await gql('mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }', { id: c.id, tags: [TAGS.dealer] }));
      c.tags = [...c.tags, TAGS.dealer];
      result.tagged = true;
    }
  }
  if (!c.hasAddress && (d.address || row.company)) {
    onStep('Adding their address');
    result.addressAdded = await addAddress(c, d, row.company).catch(() => false);
    if (!result.addressAdded) result.warnings.push("Shopify didn't accept the Notion address, so it's only in Trade Hub.");
  }
  onStep('Saving details and notes');
  await writeCrm(c, crmFrom(row, c));

  const todo = withOrders ? ordersToCreate(row) : [];
  if (todo.length) {
    // A starter offer is spent once their order count passes the count it
    // was given at, so back-dated orders would use it up: move it along.
    const fresh = await refreshCustomer(c.id);
    const waitingOffer = fresh && offerStatus(fresh) === 'Waiting' ? fresh.offer : null;
    for (const [i, o] of todo.entries()) {
      onStep(`Creating order ${i + 1} of ${todo.length} (${o.invoice})`);
      const made = await createOrder(c.id, o, archive);
      o.state = 'done';
      o.why = `Imported as ${made.name}`;
      result.orders += 1;
    }
    if (waitingOffer) {
      const offer = { ...waitingOffer, ordersAtAssignment: Number(waitingOffer.ordersAtAssignment || 0) + result.orders };
      assertOk(await gql('mutation KeepOffer($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
        m: [{ ownerId: c.id, namespace: 'tapedup', key: 'starter_offer', type: 'json', value: JSON.stringify(offer) }],
      }));
    }
  }
  await refreshCustomer(c.id);
  row.choice = `link:${c.id}`; // a second run links instead of creating again
  return result;
}
