// Dealer email templates: one per pipeline step, saved as an app-data
// metafield on this app (tapedup_admin.email_templates) so Trade Hub in
// Shopify admin, trade.tapedup.co.uk and the trade server all read one set.
//
// Bodies are plain text: a blank line starts a new paragraph, and {fields}
// are filled in per dealer. The server adds the signature and, on emails to
// prospects, the TapedUp Limited line with an unsubscribe link.
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
  ['sender_name', 'Your name'],
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
      subject: 'Free climbing tape for {gym_name}?',
      body: `Hi {first_name|there},

I'm {sender_name} from TapedUp. We make the world's first customised zinc oxide climbing tape: medical grade, 100% cotton, latex free, and printed with proper designs instead of the plain white roll everyone else ships.

I'd love to send {gym_name} a free sample pack so your team can try it on the wall. No catch, no invoice. Just reply with the best delivery address and I'll get it out this week.

If your climbers like it, we do trade pricing for gyms and shops. It tends to sell itself off the counter, mostly because everyone asks where you got it.`,
    },
    {
      key: 'reintro', name: 'Re-introduction (spoke before)', stage: 'Not now', firstTouch: true, optOut: true, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'TapedUp again, with free samples for {gym_name}',
      body: `Hi {first_name|there},

We spoke a while back about TapedUp climbing tape for {gym_name}. Since then we've added new designs and set up proper trade accounts for gyms and shops.

If it's worth another look, I'll happily send a free sample pack. Just reply with an address and it's on its way.`,
    },
    {
      key: 'followup-1', name: 'Follow-up 1', stage: 'Contacted', firstTouch: false, optOut: true, delayDays: 4, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Re: Free climbing tape for {gym_name}?',
      body: `Hi {first_name|there},

Just bumping this back up your inbox in case it got buried under the setting rota. The free sample pack for {gym_name} is still yours: reply with an address and I'll send it over.

Thanks,`,
    },
    {
      key: 'followup-2', name: 'Follow-up 2 (last one)', stage: 'Contacted', firstTouch: false, optOut: true, delayDays: 9, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Re: Free climbing tape for {gym_name}?',
      body: `Hi {first_name|there},

Last one from me, promise. If tape isn't something {gym_name} needs right now, no problem at all, and I won't keep chasing.

If it is, the samples are ready to go whenever you are. Just reply with where to send them.

Happy climbing,`,
    },
    {
      key: 'sample-confirm', name: 'Sample on its way', stage: 'Replied', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'Your TapedUp samples are on the way',
      body: `Hi {first_name|there},

Brilliant, thank you. Your sample pack is being packed now and should be with you in a few days.

I'll check in once you've had a chance to try it on the wall. Any questions before then, just reply here.`,
    },
    {
      key: 'sample-checkin', name: 'Sample check-in', stage: 'Sample sent', firstTouch: false, optOut: false, delayDays: 5, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'How did the TapedUp samples hold up?',
      body: `Hi {first_name|there},

Your samples should have landed by now. How did they hold up?

If {gym_name} would like to stock them, I can set up a trade account today: trade pricing on every design and a starter order to get your counter going. Just say the word.`,
    },
    {
      key: 'account-walkthrough', name: 'Trade account walkthrough', stage: 'Account opened', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'friendly', offerTemplateId: '', active: true,
      subject: 'Your TapedUp trade account is ready',
      body: `Hi {first_name|there},

Your TapedUp trade account is set up. Ordering takes about two minutes:

1. Go to tapedup.co.uk and sign in with this email address. You'll get a one-time code by email, so there's no password to remember.
2. Once you're signed in, trade prices show on every design.
3. Check out by card, or on account if we've agreed terms.

If we've set you up with a starter offer, it comes off automatically at checkout.

Anything unclear, reply here and I'll sort it.`,
    },
    {
      key: 'reorder', name: 'Reorder reminder', stage: 'Active dealer', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'friendly', offerTemplateId: '', active: true,
      subject: 'Running low on {usual_tapes}?',
      body: `Hi {first_name|there},

It's been a little while since {gym_name}'s last order on {last_order_date}, so I thought I'd check whether you're running low on {usual_tapes}.

If you'd like the same again, reply and I'll set it up, or order any time at tapedup.co.uk.`,
    },
    {
      key: 'winback', name: 'Win-back', stage: 'Lapsed', firstTouch: false, optOut: false, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true,
      subject: 'New designs since your last TapedUp order',
      body: `Hi {first_name|there},

We've not seen an order from {gym_name} for a while, and we've added new designs since. If you'd like to restock, I can put a reorder offer on your account. Just reply and I'll set it up.

And if something put you off, I'd genuinely like to know.`,
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
