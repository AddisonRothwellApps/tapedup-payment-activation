// Promotions: time-boxed trade deals (Black Friday...) for every trade
// account at once. Each one shows what's on offer and what it costs, who
// it's for, the email that announces it (drafted in bulk into the Outbox,
// where each waits for approval) and the orders that earned free rolls.
// The data and rules live in ../promotions.js.
import { state, label, sublabel, todayISO, setTag } from '../store.js';
import { html, raw, esc, icon, money, fmtDate, ago, toast, openDrawer, busy, loadingBlock, adminUrl } from '../ui.js';
import {
  promoState, loadPromotions, savePromotion, newPromotionId, perk, phase, headline, eligibility, qualifyingOrders,
  thresholdOrders, discountStatus, AUDIENCES, COST_NOTES, DAYS_LEFT, FREE_ROLL_DESIGNS,
} from '../promotions.js';
import { emailState, loadEmailTemplates, saveEmailTemplates } from '../email-templates.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { TRADE_SERVER } from '../env.js';

let loading = null;
let loadError = '';
const discounts = new Map(); // discount gid -> status | 'loading' | { error }
const ui = { open: null, picked: new Set(), filter: 'all', withEmail: true }; // open: promo shown; picked: accounts ticked in the table

const PHASE = { upcoming: ['Upcoming', 'new'], live: ['Live', 'active'], ended: ['Ended', 'lapsed'] };

function ensureLoaded(el) {
  if ((promoState.loaded && emailState.loaded) || loading) return;
  loading = Promise.all([promoState.loaded ? null : loadPromotions(), emailState.loaded ? null : loadEmailTemplates()])
    .catch((err) => { loadError = err.message; })
    .finally(() => { loading = null; if (location.hash.startsWith('#/promotions')) render(el); });
}

function ensureDiscount(el, id) {
  if (!id || discounts.has(id)) return;
  discounts.set(id, 'loading');
  discountStatus(id).then((s) => discounts.set(id, s)).catch((err) => discounts.set(id, { error: err.message }))
    .finally(() => { if (location.hash.startsWith('#/promotions')) render(el); });
}

export function render(el) {
  ensureLoaded(el);
  if (!promoState.loaded || !emailState.loaded) {
    el.innerHTML = String(html`<div class="page">${loadError ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${loadError}</div></div>` : loadingBlock('Loading promotions…')}</div>`);
    return;
  }
  const today = todayISO();
  const list = [...promoState.list].sort((a, b) => String(b.startsOn).localeCompare(String(a.startsOn)));
  if (!ui.open && list.length) ui.open = (list.find((p) => phase(p, today) !== 'ended') || list[0]).id;
  const open = list.find((p) => p.id === ui.open);

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Offers</p><h1 class="h1">Promotions</h1>
          <p class="muted" style="margin:4px 0 0">Time-boxed trade deals. Nothing is on until you activate it for the dealers you choose; then draft the announcement for them in one go and see which orders earned free rolls.</p></div>
        <div class="page-head__actions"><button class="btn btn--outline" data-new>${icon('plus')}New promotion</button></div>
      </div>
      ${!promoState.saved ? html`<div class="notice notice--info">${icon('info')}<div><strong>Black Friday 2026 is set up but not saved yet.</strong> Check it over, then press Save so both copies of Trade Hub see it.
        <div style="margin-top:10px"><button class="btn btn--sm" data-save-first>${icon('check', 'i--sm')}Save</button></div></div></div>` : ''}
      ${list.length > 1 ? html`<div class="seg" role="group" aria-label="Promotion">${list.map((p) => html`<button data-open="${p.id}" aria-pressed="${String(p.id === ui.open)}">${p.name}</button>`)}</div>` : ''}
      ${open ? promotionView(el, open, today) : html`<div class="card empty">${icon('tag')}<strong class="strong">No promotions yet</strong><button class="btn" data-new>${icon('plus')}Create one</button></div>`}
    </div>`);

  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openEditor(el, null)));
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { ui.open = b.dataset.open; ui.picked.clear(); render(el); }));
  const first = el.querySelector('[data-save-first]');
  if (first) first.addEventListener('click', () => busy(first, () => savePromotion(open)).then(() => { toast('Saved'); render(el); }).catch(() => {}));
  if (open) wire(el, open);
}

function promotionView(el, p, today) {
  const ph = phase(p, today);
  const t = perk(p, 'threshold');
  const f = perk(p, 'free-rolls');
  if (t) ensureDiscount(el, t.discountId);
  const elig = eligibility(p);
  const shown = elig.rows.filter((r) => ui.filter === 'all' || (ui.filter === 'activated' ? r.active : r.audience === ui.filter));
  const picked = elig.rows.filter((r) => ui.picked.has(r.c.id));
  const tpl = emailState.set.templates.find((x) => x.key === p.templateKey);
  const freeOrders = qualifyingOrders(p);
  const toPack = freeOrders.filter((r) => !r.packed);
  const over = thresholdOrders(p);
  const [phaseLabel, phaseTone] = PHASE[ph];
  const canEmail = SERVER_FEATURES && tpl && !tpl.isNew;
  const filters = [['all', 'All', elig.rows.length], ...AUDIENCES.map((a) => [a.key, a.label, elig.groups[a.key].length]), ['activated', 'Activated', elig.activated.length]];

  return html`
    <section class="card" style="display:grid;gap:14px">
      <div class="row row--between row--wrap">
        <div><h2 class="h2">${p.name}</h2>
          <div class="muted small" style="margin-top:4px">${fmtDate(p.startsOn)} to ${fmtDate(p.endsOn)}${ph === 'live' ? ` · ${DAYS_LEFT(p)} day${DAYS_LEFT(p) === 1 ? '' : 's'} left` : ''}</div></div>
        <div class="row"><span class="status status--${phaseTone}">${phaseLabel}</span><button class="btn btn--ghost btn--sm" data-edit>${icon('pencil', 'i--sm')}Edit</button></div>
      </div>
      <div class="offer__off">${headline(p)}</div>
      <div class="stats">
        <div class="stat"><span class="stat__label">Activated for</span><span class="stat__value">${elig.activated.length}</span><span class="stat__sub">of ${elig.rows.length} trade accounts</span></div>
        <div class="stat"><span class="stat__label">Emailed</span><span class="stat__value">${elig.activated.filter((r) => r.emailed).length}</span><span class="stat__sub">${elig.activated.filter((r) => !r.emailed).length} activated, not emailed</span></div>
        <div class="stat"><span class="stat__label">Orders over £${t ? t.minSpend : '—'}</span><span class="stat__value">${over.length}</span><span class="stat__sub">${money(over.reduce((n, o) => n + o.total, 0))} from activated accounts</span></div>
        <div class="stat"><span class="stat__label">Free rolls to pack</span><span class="stat__value">${toPack.reduce((n, r) => n + r.free, 0)}</span><span class="stat__sub">${toPack.length} order${toPack.length === 1 ? '' : 's'} waiting</span></div>
      </div>
    </section>

    <section class="card card--flush">
      <div class="card__head"><h2 class="h2">Who it's activated for</h2>
        <div class="seg" role="group" aria-label="Show">${filters.map(([k, l, n]) => html`<button data-filter="${k}" aria-pressed="${String(ui.filter === k)}">${l} · ${n}</button>`)}</div></div>
      <div style="padding:0 20px">
        <div class="notice notice--info">${icon('info')}<div>
          <strong>Nobody gets this until you activate it for them.</strong> Activating adds the <code>${p.activationTag || '—'}</code> tag, which puts the account in the Shopify segment the ${t ? `${t.percent}% discount` : 'discount'} is limited to, and makes their orders count for free rolls. Deactivate to take it away again. Prospects and trade leads aren't listed: they don't have trade prices yet.</div></div>
      </div>
      ${shown.length ? html`<div class="table-wrap" style="margin-top:12px"><table class="table">
        <thead><tr><th class="w-check"><input type="checkbox" data-pick-all ${shown.every((r) => ui.picked.has(r.c.id)) ? raw('checked') : ''} aria-label="Select all shown"></th><th>Account</th><th>Group</th><th>Last order</th><th>Offer</th><th>Email</th></tr></thead>
        <tbody>${shown.map((r) => html`<tr>
          <td class="w-check"><input type="checkbox" data-pick="${r.c.id}" ${ui.picked.has(r.c.id) ? raw('checked') : ''} aria-label="Select ${label(r.c)}"></td>
          <td><a class="cust" href="#/customers/${r.c.numericId}"><span class="cust__name">${label(r.c)}</span><span class="cust__sub">${r.c.email || sublabel(r.c)}</span></a></td>
          <td class="nowrap small">${(AUDIENCES.find((a) => a.key === r.audience) || {}).label}</td>
          <td class="nowrap small">${r.c.lastOrderAt ? ago(r.c.lastOrderAt) : 'Never'}</td>
          <td class="nowrap">${r.active ? html`<span class="status status--active">Activated</span>` : html`<span class="status status--lead">Not active</span>`}</td>
          <td class="nowrap small">${r.noEmail ? html`<span class="muted">${r.noEmail}</span>` : r.emailed ? 'Drafted' : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<div class="empty">${icon('users')}<span>Nobody here.</span></div>`}
      <div class="row row--wrap" style="padding:14px 20px 18px;gap:10px;border-top:1px solid var(--border-subtle)">
        <button class="btn" data-activate ${picked.filter((r) => !r.active).length ? '' : raw('disabled')}>${icon('zap', 'i--sm')}Activate for ${picked.filter((r) => !r.active).length} selected</button>
        <label class="check" style="align-items:center"><input type="checkbox" data-with-email ${ui.withEmail && canEmail ? raw('checked') : ''} ${canEmail ? '' : raw('disabled')}><span>and draft the announcement email for them</span></label>
        <button class="btn btn--ghost" data-deactivate ${picked.filter((r) => r.active).length ? '' : raw('disabled')}>Deactivate ${picked.filter((r) => r.active).length}</button>
        <button class="btn btn--outline" data-email-only ${canEmail && picked.filter((r) => r.active && !r.emailed && !r.noEmail).length ? '' : raw('disabled')}>${icon('send', 'i--sm')}Email ${picked.filter((r) => r.active && !r.emailed && !r.noEmail).length} activated</button>
        <span class="muted small" style="flex-basis:100%">${canEmail ? 'Emails wait in the Outbox for your approval and go from trade@ within the daily limits.' : !SERVER_FEATURES ? html`Activating works here; emailing works at <a href="${TRADE_SERVER}/#/promotions" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.` : 'Save the email template below to email from here.'}</span>
      </div>
    </section>

    <div class="grid grid--2">
      <section class="card">
        <div class="card__head"><h2 class="h2">The deal and what it costs</h2></div>
        <div class="list">
          ${t ? html`<div class="list__item" style="align-items:flex-start">${icon('percent')}<span class="list__main">
            <span class="strong">${t.percent}% off trade orders over £${t.minSpend}</span>
            <span class="small">${discountLine(t)}</span>
            <span class="muted small">${COST_NOTES.threshold(t)}</span></span></div>` : ''}
          ${f ? html`<div class="list__item" style="align-items:flex-start">${icon('gift')}<span class="list__main">
            <span class="strong">${f.freeRolls} free rolls with every ${f.everyRolls} rolls</span>
            <span class="small">Packed by hand from ${(f.designs || FREE_ROLL_DESIGNS).join(', ')}. Not a checkout discount: trade pricing doesn't combine with other product discounts, so this keeps it intact.</span>
            <span class="muted small">${COST_NOTES.freeRolls(f)}</span></span></div>` : ''}
        </div>
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">The email</h2>
          ${tpl ? html`<a class="btn btn--ghost btn--sm" href="#/templates">${icon('pencil', 'i--sm')}Edit in Templates</a>` : ''}</div>
        ${!tpl ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>No email template "${p.templateKey}". Pick one in Edit, or add it on the Templates screen.</div></div>` : html`
          ${tpl.isNew ? html`<div class="notice notice--info" style="margin-bottom:12px">${icon('info')}<div><strong>This template isn't saved yet.</strong> Read it over, then save it so the trade server can use it.
            <div style="margin-top:10px"><button class="btn btn--sm" data-save-tpl>${icon('check', 'i--sm')}Save the template</button></div></div></div>` : ''}
          <div class="small muted">Subject</div><div class="strong" style="margin-bottom:10px">${tpl.subject}</div>
          <div class="email-preview" style="white-space:pre-wrap;font-size:var(--text-sm);line-height:1.55;background:var(--surface-subtle);border:1px solid var(--border-subtle);border-radius:var(--radius-card);padding:14px 16px;max-height:340px;overflow:auto">${previewText(tpl.body)}</div>
          <p class="muted small" style="margin:8px 0 0">{fields} are filled in for each dealer and your signature is added. It answers in their existing email thread where there is one.</p>`}
      </section>
    </div>

    ${f ? html`<section class="card card--flush">
      <div class="card__head"><h2 class="h2">Free rolls to pack</h2><span class="muted small">Orders of ${f.everyRolls}+ rolls from activated accounts, ${fmtDate(p.startsOn)} to ${fmtDate(p.endsOn)}. Check the order note for their choice.</span></div>
      ${freeOrders.length ? html`<div class="table-wrap" style="margin-top:8px"><table class="table">
        <thead><tr><th>Order</th><th>Account</th><th>Placed</th><th class="r">Rolls</th><th class="r">Free rolls</th><th></th></tr></thead>
        <tbody>${freeOrders.map((r) => html`<tr>
          <td><a href="${adminUrl(`/orders/${r.o.id}`)}" target="_blank" rel="noopener">${r.o.name}</a></td>
          <td><a href="#/customers/${r.c.numericId}">${label(r.c)}</a></td>
          <td class="nowrap">${fmtDate(r.o.at)}</td>
          <td class="r">${r.rolls}</td><td class="r strong">${r.free}</td>
          <td class="r nowrap"><button class="btn btn--sm ${r.packed ? 'btn--ghost' : ''}" data-packed="${r.o.id}">${icon(r.packed ? 'rotate-ccw' : 'check', 'i--sm')}${r.packed ? 'Packed: undo' : 'Mark packed'}</button></td>
        </tr>`)}</tbody></table></div>` : html`<div class="empty">${icon('package')}<span>No qualifying orders yet. They appear here as orders sync.</span></div>`}
    </section>` : ''}`;
}

// The template's plain text with **bold**, *italics* and __underline__ shown as they'll look, and {fields} highlighted.
const previewText = (text) => raw(esc(text)
  .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
  .replace(/__(?=\S)([^_\n]*?\S)__/g, '<u>$1</u>')
  .replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
  .replace(/\{([a-z_]+)(\|[^{}]*)?\}/g, '<span class="badge badge--cyan" style="height:auto;padding:1px 6px;text-transform:none;letter-spacing:0;font-size:12px">$1</span>'));

function discountLine(t) {
  if (!t.discountId) return html`<span class="muted">No Shopify discount linked: create an automatic order discount for the Trade accounts (b2b) segment and add its id in Edit.</span>`;
  const s = discounts.get(t.discountId);
  const link = html`<a href="${adminUrl(`/discounts/${String(t.discountId).split('/').pop()}`)}" target="_blank" rel="noopener">Shopify discount</a>`;
  if (!s || s === 'loading') return html`${link}: checking…`;
  if (s.error) return html`${link}: couldn't check (${s.error})`;
  if (s.status === 'MISSING') return html`<span class="muted">The linked Shopify discount no longer exists.</span>`;
  return html`${link} <span class="status status--${s.status === 'ACTIVE' ? 'active' : s.status === 'SCHEDULED' ? 'new' : 'lapsed'}">${s.status.toLowerCase()}</span>, activated accounts only, stacks on trade pricing.`;
}

function wire(el, p) {
  const $ = (s) => el.querySelector(s);
  $('[data-edit]').addEventListener('click', () => openEditor(el, p));
  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { ui.filter = b.dataset.filter; render(el); }));
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('change', () => {
    if (b.checked) ui.picked.add(b.dataset.pick); else ui.picked.delete(b.dataset.pick);
    render(el);
  }));
  const all = $('[data-pick-all]');
  if (all) all.addEventListener('change', () => {
    el.querySelectorAll('[data-pick]').forEach((b) => { if (all.checked) ui.picked.add(b.dataset.pick); else ui.picked.delete(b.dataset.pick); });
    render(el);
  });
  const withEmail = $('[data-with-email]');
  if (withEmail) withEmail.addEventListener('change', () => { ui.withEmail = withEmail.checked; });
  const saveTpl = $('[data-save-tpl]');
  if (saveTpl) saveTpl.addEventListener('click', () => busy(saveTpl, () => saveEmailTemplates(emailState.set)).then(() => { toast('Template saved'); render(el); }).catch(() => {}));
  const act = $('[data-activate]');
  if (act) act.addEventListener('click', () => activate(el, p, act, true));
  const deact = $('[data-deactivate]');
  if (deact) armedOnce(deact, () => activate(el, p, deact, false));
  const mail = $('[data-email-only]');
  if (mail) mail.addEventListener('click', () => {
    const rows = eligibility(p).rows.filter((r) => ui.picked.has(r.c.id) && r.active && !r.emailed && !r.noEmail);
    draftEmails(el, p, rows, mail);
  });
  el.querySelectorAll('[data-packed]').forEach((b) => b.addEventListener('click', () => {
    const packed = { ...(p.packed || {}) };
    if (packed[b.dataset.packed]) delete packed[b.dataset.packed]; else packed[b.dataset.packed] = new Date().toISOString();
    busy(b, () => savePromotion({ ...p, packed })).then(() => render(el)).catch(() => {});
  }));
}

// Two clicks for anything that takes an offer away, like the rest of the app.
function armedOnce(btn, fn) {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
    btn.dataset.armed = '1';
    const before = btn.innerHTML;
    btn.textContent = 'Click again to deactivate';
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = before; } }, 4000);
  });
}

/** Adds (or removes) the activation tag on every picked account, logging it on their timeline; then, if asked, drafts the email. */
async function activate(el, p, btn, on) {
  if (!p.activationTag) { toast('This promotion has no activation tag. Add one in Edit.', 'err'); return; }
  if (on && !promoState.saved) await savePromotion(p).catch(() => {});
  const rows = eligibility(p).rows.filter((r) => ui.picked.has(r.c.id) && r.active !== on);
  if (!rows.length) return;
  const done = [];
  const failed = [];
  await busy(btn, async () => {
    for (const r of rows) {
      try {
        await setTag(r.c, p.activationTag, on, `${p.name}: ${on ? 'activated' : 'deactivated'} (${headline(p)})`);
        done.push(r);
      } catch (err) { failed.push({ r, reason: err.message }); }
    }
  }).catch(() => {});
  ui.picked.clear();
  render(el);
  if (failed.length) toast(`${failed.length} couldn't be ${on ? 'activated' : 'deactivated'}: ${failed[0].reason}`, 'err');
  else toast(`${on ? 'Activated' : 'Deactivated'} for ${done.length} account${done.length === 1 ? '' : 's'}`);
  if (on && ui.withEmail && SERVER_FEATURES) {
    const tpl = emailState.set.templates.find((x) => x.key === p.templateKey);
    const toMail = done.filter((r) => !r.emailed && !r.noEmail);
    if (tpl && !tpl.isNew && toMail.length) await draftEmails(el, p, toMail, null);
  }
}

async function draftEmails(el, p, rows, btn) {
  if (!rows.length) return;
  const r = await busy(btn, async () => {
    // The server takes up to 250 at a time; trade lists are far smaller, but stay safe.
    const out = { drafted: 0, done: [], failed: [] };
    for (let i = 0; i < rows.length; i += 200) {
      const res = await serverApi('/api/outbox/bulk', { method: 'POST', body: { items: rows.slice(i, i + 200).map((x) => ({ customerId: x.c.id, templateKey: p.templateKey })) } });
      out.drafted += res.drafted; out.done.push(...res.done); out.failed.push(...res.failed);
    }
    return out;
  }).catch(() => null);
  if (!r) return;
  // Remember who's had it, so nobody is drafted twice.
  const emailed = [...new Set([...(p.emailed || []), ...r.done.map((d) => d.customerId)])];
  await savePromotion({ ...p, emailed, emailedAt: new Date().toISOString() }).catch((err) => toast(err.message, 'err'));
  window.dispatchEvent(new Event('outbox-changed'));
  ui.picked.clear();
  render(el);
  if (!r.failed.length) { toast(`${r.drafted} email${r.drafted === 1 ? '' : 's'} drafted. Approve them in the Outbox.`); return; }
  const names = new Map(rows.map((x) => [x.c.id, label(x.c)]));
  openDrawer({
    eyebrow: 'Promotion email',
    title: `${r.drafted} drafted, ${r.failed.length} skipped`,
    body: html`<p class="muted" style="margin-top:0">The drafted ones are waiting in the Outbox. These were skipped (their offer is still activated):</p>
      <div class="list">${r.failed.map((x) => html`<div class="list__item"><span class="list__main"><span class="strong">${names.get(x.customerId) || x.customerId}</span><span class="muted small">${x.reason}</span></span></div>`)}</div>`,
    foot: html`<a class="btn" href="#/outbox" data-close>${icon('inbox', 'i--sm')}Go to the Outbox</a>`,
  });
}

function openEditor(el, existing) {
  const d = existing ? structuredClone(existing) : {
    id: '', name: '', startsOn: todayISO(), endsOn: todayISO(), perks: [], activationTag: '', templateKey: '', packed: {}, emailed: [],
  };
  const t = perk(d, 'threshold') || { kind: 'threshold', minSpend: '', percent: '', discountId: '' };
  const f = perk(d, 'free-rolls') || { kind: 'free-rolls', everyRolls: '', freeRolls: '', designs: FREE_ROLL_DESIGNS };
  const usable = emailState.set.templates.filter((x) => x.active !== false);
  openDrawer({
    eyebrow: 'Promotion',
    title: existing ? 'Edit promotion' : 'New promotion',
    wide: true,
    body: html`<form class="form" onsubmit="return false">
      <label class="field"><span>Name</span><input class="input" data-f="name" value="${d.name}" placeholder="e.g. Summer restock 2027"></label>
      <div class="grid grid--2" style="gap:12px">
        <label class="field"><span>Starts</span><input class="input" type="date" data-f="startsOn" value="${d.startsOn}"></label>
        <label class="field"><span>Ends (inclusive)</span><input class="input" type="date" data-f="endsOn" value="${d.endsOn}"></label>
      </div>
      <fieldset class="card" style="box-shadow:none;padding:14px 16px;display:grid;gap:10px"><legend class="h3" style="margin:0">Spend threshold</legend>
        <div class="grid grid--2" style="gap:12px">
          <label class="field"><span>% off</span><input class="input" type="number" min="0" max="100" step="1" data-t="percent" value="${t.percent}" placeholder="Leave blank for none"></label>
          <label class="field"><span>On trade orders over (£)</span><input class="input" type="number" min="0" step="1" data-t="minSpend" value="${t.minSpend}"></label>
        </div>
        <label class="field"><span>Shopify discount id</span><input class="input" data-t="discountId" value="${t.discountId}" placeholder="gid://shopify/DiscountAutomaticNode/…"></label>
        <p class="muted small" style="margin:0">Create it in Shopify: Discounts → Amount off order → Automatic, eligibility = the segment for this promotion's activation tag, minimum purchase, combines with product and shipping discounts. Paste its id here so its status shows.</p>
      </fieldset>
      <fieldset class="card" style="box-shadow:none;padding:14px 16px;display:grid;gap:10px"><legend class="h3" style="margin:0">Free rolls</legend>
        <div class="grid grid--2" style="gap:12px">
          <label class="field"><span>Free rolls</span><input class="input" type="number" min="0" step="1" data-r="freeRolls" value="${f.freeRolls}" placeholder="Leave blank for none"></label>
          <label class="field"><span>For every … rolls ordered</span><input class="input" type="number" min="1" step="1" data-r="everyRolls" value="${f.everyRolls}"></label>
        </div>
        <label class="field"><span>Designs they can choose from</span><input class="input" data-r="designs" value="${(f.designs || []).join(', ')}"></label>
      </fieldset>
      <label class="field"><span>Activation tag</span><input class="input" data-f="activationTag" value="${d.activationTag || ''}" placeholder="e.g. promo-summer27"></label>
      <p class="muted small" style="margin:-6px 0 0">Activating an account adds this tag. Limit the Shopify discount to a customer segment of everyone with it (customer_tags CONTAINS '…'), so nobody gets it until you activate them.</p>
      <label class="field"><span>Announcement email</span><select class="select" data-f="templateKey">
        <option value="">Choose a template</option>${usable.map((x) => html`<option value="${x.key}" ${x.key === d.templateKey ? raw('selected') : ''}>${x.name}</option>`)}</select></label>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save promotion</button>`,
    onMount(api) {
      api.$('[data-save]').addEventListener('click', (e) => {
        const v = (s) => api.$(s).value.trim();
        const next = { ...d, id: d.id || newPromotionId(), name: v('[data-f="name"]'), startsOn: v('[data-f="startsOn"]'), endsOn: v('[data-f="endsOn"]'), templateKey: v('[data-f="templateKey"]'), activationTag: v('[data-f="activationTag"]').toLowerCase().replace(/[^a-z0-9-]+/g, '-') };
        const perks = [];
        const pct = Number(v('[data-t="percent"]'));
        if (pct > 0) perks.push({ kind: 'threshold', percent: pct, minSpend: Number(v('[data-t="minSpend"]')) || 0, discountId: v('[data-t="discountId"]') });
        const free = Number(v('[data-r="freeRolls"]'));
        if (free > 0) perks.push({ kind: 'free-rolls', freeRolls: free, everyRolls: Number(v('[data-r="everyRolls"]')) || 1, designs: v('[data-r="designs"]').split(',').map((s) => s.trim()).filter(Boolean) });
        next.perks = perks;
        const problem = !next.name ? 'Give it a name.'
          : !next.startsOn || !next.endsOn || next.endsOn < next.startsOn ? 'The end date has to be on or after the start.'
          : !perks.length ? 'Add a % off or free rolls.'
          : !next.activationTag ? 'Give it an activation tag.'
          : null;
        if (problem) { toast(problem, 'err'); return; }
        busy(e.currentTarget, () => savePromotion(next)).then(() => { ui.open = next.id; discounts.clear(); toast(`Saved ${next.name}`); api.close(); render(el); }).catch(() => {});
      });
    },
  });
}
