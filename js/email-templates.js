// Dealer email templates: one per pipeline step, saved as an app-data
// metafield on this app (tapedup_admin.email_templates) so Trade Hub in
// Shopify admin, trade.tapedup.co.uk and the trade server all read one set.
//
// Bodies are plain text: a blank line starts a new paragraph, and {fields}
// are filled in per dealer. The server adds the signature and, on emails to
// prospects, the TapedUp Limited line with "reply STOP to opt out".
import { gql, assertOk } from './api.js';
import { state } from './store.js';

const NS = 'tapedup_admin';
const KEY = 'email_templates';

export const FIELDS = [
  ['first_name', 'First name'],
  ['gym_name', 'Company'],
  ['city', 'Town'],
  ['contact_name', 'Contact name'],
  ['last_order_date', 'Last order date'],
  ['usual_tapes', 'Usual tapes'],
  ['sender_name', 'Your first name'],
];

export const TONES = [
  ['brand', 'TapedUp voice: confident, then a joke'],
  ['friendly', 'Friendly professional'],
  ['direct', 'Short and direct'],
];

// Written in the storefront's voice: claim first, joke second; "you" and
// "we"; no emoji; climbing words used without explaining them.
export const DEFAULT_SET = {
  version: 1,
  signature: { name: '', title: '', company: 'TapedUp', phone: '', website: 'tapedup.co.uk' },
  templates: [
    {
      key: 'intro', name: 'Intro and free samples', stage: 'Prospect', firstTouch: true, optOut: true, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Climbing tape for {gym_name}',
      preview: 'Fancy a free sample pack for {gym_name}? No catch, no invoice.',
      body: `Hi {first_name|there},

{sender_name} here from TapedUp. We make printed zinc oxide climbing tape: the same medical-grade, 100% cotton, latex-free tape your climbers already use, just with proper designs on it instead of plain white.

Fancy a free sample pack for {gym_name}? No catch, no invoice. Just reply with your address and I'll get it in the post this week.

If your climbers get on with it, we do trade prices for gyms and shops. It tends to sell itself off the counter, mostly because everyone asks where you got it.

Cheers,`,
    },
    {
      key: 'reintro', name: 'Re-introduction (spoke before)', stage: 'Not now', firstTouch: true, optOut: true, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'New designs from TapedUp for {gym_name}',
      preview: 'Fancy a free sample pack? Just reply with your address.',
      body: `Hi {first_name|there},

{sender_name} from TapedUp again. We chatted a while back about our climbing tape for {gym_name}. Since then we've added new designs and proper trade accounts, so it felt worth another shout.

Fancy a free sample pack? Just reply with your address and it's on its way.

Cheers,`,
    },
    {
      key: 'followup-1', name: 'Follow-up 1', stage: 'Contacted', firstTouch: false, optOut: true, delayDays: 4, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Re: Climbing tape for {gym_name}',
      body: `Hi {first_name|there},

Just bumping this back up your inbox in case it got buried under the setting rota. The free sample pack for {gym_name} is still yours: reply with your address and I'll send it over.

Cheers,`,
    },
    {
      key: 'followup-2', name: 'Follow-up 2 (last one)', stage: 'Contacted', firstTouch: false, optOut: true, delayDays: 9, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Re: Climbing tape for {gym_name}',
      body: `Hi {first_name|there},

Last one from me, promise. If tape's not on the list for {gym_name} right now, no worries at all and I'll stop chasing.

If it is, the samples are ready whenever you are. Just reply with where to send them.

Happy climbing,`,
    },
    {
      key: 'sample-confirm', name: 'Sample on its way (with prices and starter offer)', stage: 'Replied', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Your TapedUp samples are on the way',
      body: `Hi {first_name|there},

Brilliant, your free sample pack is booked in and should be with {gym_name} in a few days. Put it on the wall and watch how fast the plain white roll gets left behind.

While you wait, here's how stocking TapedUp works.

Trade price per 7.5m roll (shelf price in brackets):

Plain: Black and White
1.25cm £1.02 (£2.45) · 2.5cm £1.44 (£3.45) · 5cm £2.27 (£5.45)

Colours: Doodle and Caution
1.25cm £1.23 (£2.95) · 2.5cm £1.65 (£3.95) · 5cm £2.48 (£5.95)

Complex colours: Icons
1.25cm £1.23 (£2.95) · 2.5cm £1.65 (£3.95) · 5cm £2.48 (£5.95)

PRO Rayon
2 x 0.5cm £1.85 (£4.45) · 3.8cm £3.10 (£7.45)

That's a 50% margin on every roll. We're not VAT registered yet, so there's no VAT on our invoices. No minimum order, and delivery is free over £100.

The easiest way in is our starter offer: 85 rolls across plain, colours, Icons and PRO Rayon for £100, delivered free. That's over £125 of stock at trade price, and it sells for over £300 on your shelf. It also comes with a free counter display stand (worth £25) for your reception desk or shop, which is where most of the sales happen.

Want the starter offer? Just reply "starter" and I'll open your trade account with it ready at checkout. Or try the samples first and I'll check in once they've had a few sessions.

Cheers,`,
    },
    {
      key: 'pricing', name: 'Prices and starter offer', stage: 'Replied', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'TapedUp trade prices for {gym_name}',
      body: `Hi {first_name|there},

Here's everything you need to stock TapedUp at {gym_name}.

Trade price per 7.5m roll (shelf price in brackets):

Plain: Black and White
1.25cm £1.02 (£2.45) · 2.5cm £1.44 (£3.45) · 5cm £2.27 (£5.45)

Colours: Doodle and Caution
1.25cm £1.23 (£2.95) · 2.5cm £1.65 (£3.95) · 5cm £2.48 (£5.95)

Complex colours: Icons
1.25cm £1.23 (£2.95) · 2.5cm £1.65 (£3.95) · 5cm £2.48 (£5.95)

PRO Rayon
2 x 0.5cm £1.85 (£4.45) · 3.8cm £3.10 (£7.45)

That's a 50% margin on every roll. We're not VAT registered yet, so there's no VAT on our invoices. No minimum order, and delivery is free over £100.

The easiest way in is our starter offer: 85 rolls across plain, colours, Icons and PRO Rayon for £100, delivered free. That's over £125 of stock at trade price, and it sells for over £300 on your shelf. It also comes with a free counter display stand (worth £25) for your reception desk or shop, which is where most of the sales happen.

Want it? Just reply "starter" and I'll open your trade account with the offer ready at checkout. Any questions, reply here.

Cheers,`,
    },
    {
      key: 'sample-checkin', name: 'Sample check-in', stage: 'Sample sent', firstTouch: false, optOut: false, delayDays: 5, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'How did the TapedUp samples hold up?',
      body: `Hi {first_name|there},

Your samples should have landed by now. How did they hold up on the wall?

If you fancy stocking them at {gym_name}, I can set up a trade account today. Our starter offer gets you 85 rolls for £100 with a free counter display stand, which is the easiest way to get going. Just say the word.

Cheers,`,
    },
    {
      key: 'account-walkthrough', name: 'Trade account walkthrough', stage: 'Account opened', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'friendly', offerTemplateId: '', active: true,
      subject: 'Your TapedUp trade account is ready',
      body: `Hi {first_name|there},

You're all set: {gym_name}'s TapedUp trade account is live. Ordering takes about two minutes:

1. Head to tapedup.co.uk and sign in with this email address. We'll email you a one-time code, so there's no password to remember.
2. Once you're in, trade prices show on every design.
3. Pay by card at checkout (or on account, if we've agreed that with you).

If you've got the starter offer, it comes off automatically at checkout.

Any questions, just reply here.

Cheers,`,
    },
    {
      key: 'reorder', name: 'Reorder reminder', stage: 'Active dealer', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'friendly', offerTemplateId: '', active: true,
      subject: 'Running low on {usual_tapes}?',
      body: `Hi {first_name|there},

It's been a little while since {gym_name}'s last order on {last_order_date}, so I thought I'd check in. Running low on {usual_tapes}?

If you want the same again, just reply and I'll sort it, or order any time at tapedup.co.uk.

Cheers,`,
    },
    {
      key: 'winback', name: 'Win-back', stage: 'Lapsed', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'New designs since your last TapedUp order',
      body: `Hi {first_name|there},

We've not seen an order from {gym_name} in a while, and we've added some new designs since. If you fancy a restock, just reply and I'll set it up for you.

And if something put you off, I'd genuinely like to know. No hard feelings either way.

Cheers,`,
    },
  ],
};

// What the agent may say about TapedUp when it drafts replies. Kept with the
// templates (set.agent) and edited on the Agent screen. Mirrors the trade
// server's default.
export const DEFAULT_FACTS = `TapedUp makes customised zinc oxide climbing tape: medical grade, 100% cotton, latex free, printed with designs (not plain white).
We offer gyms and climbing shops a free sample pack, delivered free. We need a delivery address to send it.
Trade accounts: gyms and shops get trade pricing on every design. Dealers order at tapedup.co.uk, signing in with their email address (one-time code, no password). Card payment at checkout; payment on terms only by agreement with Addison.
A starter offer can be added to a new trade account for their first order.
Website: tapedup.co.uk. Based in the UK, we ship UK-wide.`;

export const emailState = { set: null, saved: false, loaded: false };

export async function loadEmailTemplates() {
  const data = await gql(`query EmailTemplates { currentAppInstallation { metafield(namespace: "${NS}", key: "${KEY}") { value } } }`);
  const raw = data.currentAppInstallation.metafield && data.currentAppInstallation.metafield.value;
  let saved = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch (err) { saved = null; }
  emailState.saved = !!(saved && Array.isArray(saved.templates));
  emailState.set = emailState.saved ? saved : structuredClone(DEFAULT_SET);
  // Templates added in a later version show up (unsaved) alongside saved ones.
  if (emailState.saved) {
    const have = new Set(saved.templates.map((t) => t.key));
    DEFAULT_SET.templates.filter((t) => !have.has(t.key)).forEach((t) => saved.templates.push({ ...structuredClone(t), isNew: true }));
  }
  emailState.loaded = true;
  return emailState.set;
}

export async function saveEmailTemplates(set) {
  set = { ...set, templates: set.templates.map(({ isNew, ...t }) => t) };
  assertOk(await gql('mutation SaveEmailTemplates($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
    m: [{ ownerId: state.appInstallationId, namespace: NS, key: KEY, type: 'json', value: JSON.stringify(set) }],
  }));
  emailState.set = set;
  emailState.saved = true;
}

/** Merge fields typed in a template that aren't ones we know how to fill. */
export function unknownFields(text) {
  const known = new Set(FIELDS.map(([k]) => k));
  return [...new Set([...String(text || '').matchAll(/\{([a-z_]+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]).filter((k) => !known.has(k)))];
}
