// The agent's knowledge base: short articles saved as the app-data
// metafield tapedup_admin.knowledge. The trade server reads the articles
// switched on for the agent and answers customer questions from them only,
// so keeping these right keeps its replies right.
import { gql, assertOk } from './api.js';
import { state } from './store.js';

const NS = 'tapedup_admin';
const KEY = 'knowledge';

export const CATEGORIES = ['Products', 'Pricing', 'Samples', 'Ordering', 'Delivery', 'Company', 'How to reply'];

const a = (id, category, title, body) => ({ id, category, title, body, active: true });

// Starter articles, from what TapedUp has told dealers by email and the
// current Shopify prices. Edit them on the Knowledge base screen.
export const DEFAULT_ARTICLES = [
  a('k-tape', 'Products', 'Our tape', `TapedUp makes customised zinc oxide climbing tape with printed designs, instead of the plain white roll everyone else sells.
It is medical grade, 100% cotton, latex free and hypoallergenic.
Every roll is 7.5m long. Zinc oxide tape comes in three widths: 1.25cm, 2.5cm and 5cm.
PRO Rayon tape comes in 2 x 0.5cm (two thin rolls) and 3.8cm.`),
  a('k-range', 'Products', 'Current range and discontinued designs', `Current designs:
- Plain: Black, White
- Colours: Doodle, Icons
- Complex colours: Comic
- PRO Rayon

Discontinued: Caution and Bold Bolder. Don't offer or quote them. If someone asks for one, say it has been discontinued and suggest Doodle, Icons or Comic instead.`),
  a('k-prices', 'Pricing', 'Trade prices', `Trade price per 7.5m roll (shelf price in brackets):

Plain (Black, White): 1.25cm £1.02 (£2.45) · 2.5cm £1.44 (£3.45) · 5cm £2.27 (£5.45)
Colours (Doodle, Icons): 1.25cm £1.23 (£2.95) · 2.5cm £1.65 (£3.95) · 5cm £2.48 (£5.95)
Complex colours (Comic): 1.25cm £1.35 (£3.25) · 2.5cm £2.60 (£6.25) · 5cm £3.44 (£8.25)
PRO Rayon: 2 x 0.5cm £1.85 (£4.45) · 3.8cm £3.10 (£7.45)

Trade prices give dealers a 50% margin on the shelf price (worked out on the price before VAT).
There is no minimum order.`),
  a('k-starter', 'Pricing', 'Starter offer and free display stand', `New trade accounts can have our starter offer: 85 rolls across the range for £100, delivered free.
That's over £125 of stock at trade price, and it sells for over £300 at shelf prices.
It comes with a free counter display stand (worth £25) for the reception desk or shop counter.
The offer is added to their trade account and is ready at checkout for 30 days.
To take it, they reply and we open their trade account with the offer on it.`),
  a('k-stand', 'Pricing', 'Display stands', `A counter display stand costs £25. It's free with the starter offer, and free with any order over £100.
Once a dealer has a stand they don't need to buy another, unless they want an extra one.`),
  a('k-vat', 'Pricing', 'VAT', `TapedUp is not VAT registered yet, so there is no VAT on our invoices and our prices don't include VAT.
Dealers still charge VAT on their own sales if they're VAT registered.`),
  a('k-samples', 'Samples', 'Free sample pack', `Gyms and shops can have a free sample pack, delivered free. No catch and no invoice.
We need the full delivery address including the postcode.
It's one sample pack per business and per address.
Once it has arrived we check in to see how it went on the wall.`),
  a('k-ordering', 'Ordering', 'Trade accounts and how to order', `Dealers order online at tapedup.co.uk. They sign in with their email address and get a one-time code (no password). Trade prices show once they're signed in.
Payment is by card at checkout. Payment on terms (paying by invoice later) is only by agreement with Addison, so never offer it.
There is no minimum order.`),
  a('k-delivery', 'Delivery', 'Delivery', `We ship UK-wide.
Delivery is free on orders over £100. Orders under £100 pay £6.49 delivery.
Don't promise delivery dates: say we'll confirm once the order is in.`),
  a('k-company', 'Company', 'About TapedUp', `TapedUp is a UK company and the UK's first personalised climbing tape brand, started by Addison and Freya.
Our tape is stocked by climbing centres and outdoor shops across the UK.
Website: tapedup.co.uk`),
  a('k-check', 'How to reply', 'Always check with Addison', `Flag these for Addison instead of answering: bespoke or custom designs for a gym, payment terms or credit accounts, discounts beyond the starter offer, delivery dates, stock levels, complaints, and anything not covered in these articles.`),
];

export const knowledgeState = { articles: null, saved: false, loaded: false };

export async function loadKnowledge() {
  const data = await gql(`query Knowledge { currentAppInstallation { metafield(namespace: "${NS}", key: "${KEY}") { value } } }`);
  const raw = data.currentAppInstallation.metafield && data.currentAppInstallation.metafield.value;
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch (err) { saved = null; }
  knowledgeState.saved = !!(saved && Array.isArray(saved.articles));
  knowledgeState.articles = knowledgeState.saved ? saved.articles : structuredClone(DEFAULT_ARTICLES);
  knowledgeState.loaded = true;
  return knowledgeState.articles;
}

export async function saveKnowledge(articles) {
  const clean = articles.map(({ id, category, title, body, active, updatedAt }) => ({ id, category, title, body, active: active !== false, updatedAt: updatedAt || new Date().toISOString() }));
  assertOk(await gql('mutation SaveKnowledge($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
    m: [{ ownerId: state.appInstallationId, namespace: NS, key: KEY, type: 'json', value: JSON.stringify({ version: 1, articles: clean }) }],
  }));
  knowledgeState.articles = clean;
  knowledgeState.saved = true;
}

export const newArticleId = () => `k-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
