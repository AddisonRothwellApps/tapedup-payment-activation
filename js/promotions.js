// Trade promotions: time-boxed deals for every trade account at once (Black
// Friday, a summer restock push...), as opposed to a starter offer, which is
// one account's first order.
//
// A promotion is saved as an app-data metafield on this app
// (tapedup_admin.promotions) so both copies of Trade Hub share it. Each one
// carries up to two perks:
//   - threshold:  "10% off orders over £150". A real Shopify automatic order
//                 discount, limited to a customer segment of everyone tagged
//                 with the promotion's activation tag (promo-bf26 for Black
//                 Friday 2026) and set to combine with product discounts so it
//                 stacks on B2B trade pricing. Nobody gets it until they're
//                 activated here, which adds the tag. Its id is kept so its
//                 status can be shown.
//   - free-rolls: "4 free rolls with every 24". Not a checkout discount: B2B
//                 trade pricing doesn't combine with other product discounts,
//                 so a buy-X-get-Y discount would knock trade pricing off the
//                 whole order. Instead qualifying orders are listed here and
//                 the free rolls are packed in by hand.
// Plus the tag that activates it for an account, the email template that
// announces it, and which qualifying orders have had their free rolls packed.
import { gql, assertOk } from './api.js';
import { state, isDealer, insights, stageOf, countable, numericId } from './store.js';

const NS = 'tapedup_admin';
const KEY = 'promotions';
const DAY = 86400000;

// Who a promotion can go to, in the order the screen lists them. Every one is
// a trade account (tagged b2b); prospects and trade leads have no trade
// pricing yet, so a trade deal means nothing to them.
export const AUDIENCES = [
  { key: 'active', label: 'Ordering now', hint: 'Ordered within their usual gap. The main audience: a reason to stock up before Christmas.' },
  { key: 'quiet', label: 'Gone quiet', hint: 'Overdue or lapsed. Black Friday is a good, no-pressure reason to get back in touch.' },
  { key: 'new', label: 'Account opened, no order yet', hint: 'Has trade prices but hasn\'t ordered. If they have a starter offer, Shopify gives them whichever saves more.' },
];

// The free rolls come from designs that are current and have the most margin
// in them at trade price. Comic and Icons are thin at trade; Caution and
// Bold Bolder are discontinued.
export const FREE_ROLL_DESIGNS = ['DOODLE', 'PRO Rayon', 'Black', 'White'];

export const BF26 = {
  id: 'bf26-trade',
  name: 'Black Friday 2026: trade',
  startsOn: '2026-11-19',
  endsOn: '2026-11-30',
  perks: [
    { kind: 'threshold', minSpend: 150, percent: 10, discountId: 'gid://shopify/DiscountAutomaticNode/1936838033732' },
    { kind: 'free-rolls', everyRolls: 24, freeRolls: 4, designs: FREE_ROLL_DESIGNS },
  ],
  // Activating an account adds this tag; the Shopify discount is limited to
  // the "Promo: Black Friday 2026 trade (activated)" segment (customer_tags
  // CONTAINS 'promo-bf26'), so the offer is off for everyone until then.
  activationTag: 'promo-bf26',
  templateKey: 'trade-bf26',
  packed: {},
  emailed: [],
};

export const promoState = { list: null, loaded: false, error: '' };

export async function loadPromotions() {
  const data = await gql(`query Promotions { currentAppInstallation { metafield(namespace: "${NS}", key: "${KEY}") { value } } }`);
  const raw = data.currentAppInstallation.metafield && data.currentAppInstallation.metafield.value;
  let list = null;
  try { list = raw ? JSON.parse(raw) : null; } catch (err) { list = null; }
  // First open: start with the Black Friday 2026 trade promotion already set up.
  promoState.list = Array.isArray(list) ? list : [structuredClone(BF26)];
  // Saved before promotions had activation tags: Black Friday 2026 uses promo-bf26.
  promoState.list.forEach((p) => { if (p.id === BF26.id && !p.activationTag) p.activationTag = BF26.activationTag; });
  promoState.saved = Array.isArray(list);
  promoState.loaded = true;
  return promoState.list;
}

export async function savePromotions(list) {
  assertOk(await gql('mutation SavePromotions($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
    m: [{ ownerId: state.appInstallationId, namespace: NS, key: KEY, type: 'json', value: JSON.stringify(list) }],
  }));
  promoState.list = list;
  promoState.saved = true;
}

export async function savePromotion(promo) {
  const list = promoState.list.some((p) => p.id === promo.id)
    ? promoState.list.map((p) => (p.id === promo.id ? promo : p))
    : [...promoState.list, promo];
  await savePromotions(list);
}

export const newPromotionId = () => `promo${Date.now().toString(36)}`;
export const perk = (p, kind) => (p.perks || []).find((x) => x.kind === kind) || null;

/** 'upcoming' | 'live' | 'ended' for a YYYY-MM-DD window, inclusive of the end day. */
export function phase(p, today) {
  if (today < p.startsOn) return 'upcoming';
  if (today > p.endsOn) return 'ended';
  return 'live';
}

/** The headline for a card: "10% off over £150 + 4 free rolls per 24". */
export function headline(p) {
  const t = perk(p, 'threshold');
  const f = perk(p, 'free-rolls');
  return [
    t && `${t.percent}% off over £${t.minSpend}`,
    f && `${f.freeRolls} free rolls per ${f.everyRolls}`,
  ].filter(Boolean).join(' + ') || 'No perks yet';
}

/** Which audience a trade account falls in, or null if it isn't one. */
export function audienceOf(c, now = Date.now()) {
  if (!isDealer(c)) return null;
  const s = insights(c, now).status;
  if (s === 'lead') return 'new';
  if (s === 'risk' || s === 'lapsed') return 'quiet';
  return 'active'; // new (first order recently), active, due
}

export const isActivated = (c, p) => !!p.activationTag && c.tags.includes(p.activationTag);

/**
 * Every trade account the promotion could be offered to, with its audience,
 * whether it's been activated, whether the email has been drafted, and why
 * it can't be emailed (opted out, Lost, no address). Lost accounts aren't
 * offered it at all.
 */
export function eligibility(p, now = Date.now()) {
  const rows = [];
  for (const c of state.customers.values()) {
    const a = audienceOf(c, now);
    if (!a) continue;
    const lost = stageOf(c, now).stage === 'Lost';
    if (lost && !isActivated(c, p)) continue;
    const noEmail = !c.email ? 'No email address' : c.crm.optOut ? 'Opted out of email' : lost ? 'Marked Lost' : '';
    rows.push({ c, audience: a, active: isActivated(c, p), emailed: (p.emailed || []).includes(c.id), noEmail });
  }
  const order = { active: 0, quiet: 1, new: 2 };
  rows.sort((x, y) => (order[x.audience] - order[y.audience]) || String(x.c.lastOrderAt || '').localeCompare(String(y.c.lastOrderAt || '')) * -1);
  const groups = Object.fromEntries(AUDIENCES.map((au) => [au.key, rows.filter((r) => r.audience === au.key)]));
  return { rows, groups, activated: rows.filter((r) => r.active) };
}

// Tape rolls in an order: every tape line (stickers, magnets and the like don't count).
const isTape = (title) => /tape/i.test(String(title || ''));
export const rollsIn = (o) => o.lines.reduce((n, [title, , qty]) => n + (isTape(title) ? qty : 0), 0);

/**
 * Trade orders placed during the promotion that earned free rolls, newest
 * first, each with how many free rolls to pack and whether that's been done.
 */
export function qualifyingOrders(p) {
  const f = perk(p, 'free-rolls');
  if (!f) return [];
  const from = Date.parse(`${p.startsOn}T00:00:00`);
  const to = Date.parse(`${p.endsOn}T23:59:59`);
  return state.orders
    .filter((o) => countable(o) && !o.imp && o.cust)
    .filter((o) => { const t = Date.parse(o.at); return t >= from && t <= to; })
    .map((o) => ({ o, c: state.byNumericId.get(o.cust), rolls: rollsIn(o) }))
    .filter((r) => r.c && isDealer(r.c) && isActivated(r.c, p) && r.rolls >= f.everyRolls)
    .map((r) => ({ ...r, free: Math.floor(r.rolls / f.everyRolls) * f.freeRolls, packed: !!(p.packed || {})[r.o.id] }));
}

/** Activated accounts' orders in the window over the spend threshold (the 10% applies to these at checkout). */
export function thresholdOrders(p) {
  const t = perk(p, 'threshold');
  if (!t) return [];
  const from = Date.parse(`${p.startsOn}T00:00:00`);
  const to = Date.parse(`${p.endsOn}T23:59:59`);
  return state.orders.filter((o) => countable(o) && !o.imp && o.cust && state.byNumericId.get(o.cust) && isActivated(state.byNumericId.get(o.cust), p)
    && Date.parse(o.at) >= from && Date.parse(o.at) <= to && o.total >= t.minSpend * (1 - t.percent / 100));
}

/** Live status of the Shopify discount behind a threshold perk. */
export async function discountStatus(id) {
  if (!id) return null;
  const data = await gql(`query PromoDiscount($id: ID!) { discountNode(id: $id) { id discount { __typename
    ... on DiscountAutomaticBasic { title status startsAt endsAt } } } }`, { id });
  const d = data.discountNode && data.discountNode.discount;
  return d ? { title: d.title, status: d.status, startsAt: d.startsAt, endsAt: d.endsAt, numericId: numericId(id) } : { status: 'MISSING' };
}

// What each perk costs, worked out from the landed costs and trade prices in
// the Margins data (Nov 2026). Shown so the deal can be judged at a glance.
export const COST_NOTES = {
  threshold: (t) => `On a £${t.minSpend} trade order (about 42% profit, ~£${Math.round(t.minSpend * 0.42)}) you give £${Math.round(t.minSpend * t.percent / 100)} and keep ~£${Math.round(t.minSpend * 0.42 - t.minSpend * t.percent / 100)}. Bigger orders keep the same ${t.percent}% away from a bigger margin.`,
  freeRolls: (f) => `${f.freeRolls} rolls cost £1.50 to £5.20 landed (Doodle 1.25cm at 37p up to Pro 5cm at £1.29). Against ${f.everyRolls} rolls at trade, that's roughly 3 to 8% of the order: cheaper than it looks to the dealer, who sees £5 to £12 of trade value.`,
};

export const DAYS_LEFT = (p, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(`${p.endsOn}T23:59:59`) - now) / DAY));
