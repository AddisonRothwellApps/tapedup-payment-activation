// Promotions: time-boxed trade deals (Black Friday...) for every trade
// account at once. Each one shows what's on offer and what it costs, who
// it's for, the email that announces it (drafted in bulk into the Outbox,
// where each waits for approval) and the orders that earned free rolls.
// The data and rules live in ../promotions.js.
import { state, label, sublabel, todayISO } from '../store.js';
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
const ui = { open: null, unpicked: new Set() }; // open: promo id shown in full; unpicked: customer ids left out of the send

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
          <p class="muted" style="margin:4px 0 0">Time-boxed deals for every trade account at once. Set who it's for, draft the announcement for all of them in one go, and see which orders earned their free rolls.</p></div>
        <div class="page-head__actions"><button class="btn btn--outline" data-new>${icon('plus')}New promotion</button></div>
      </div>
      ${!promoState.saved ? html`<div class="notice notice--info">${icon('info')}<div><strong>Black Friday 2026 is set up but not saved yet.</strong> Check it over, then press Save so both copies of Trade Hub see it.
        <div style="margin-top:10px"><button class="btn btn--sm" data-save-first>${icon('check', 'i--sm')}Save</button></div></div></div>` : ''}
      ${list.length > 1 ? html`<div class="seg" role="group" aria-label="Promotion">${list.map((p) => html`<button data-open="${p.id}" aria-pressed="${String(p.id === ui.open)}">${p.name}</button>`)}</div>` : ''}
      ${open ? promotionView(el, open, today) : html`<div class="card empty">${icon('tag')}<strong class="strong">No promotions yet</strong><button class="btn" data-new>${icon('plus')}Create one</button></div>`}
    </div>`);

  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openEditor(el, null)));
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { ui.open = b.dataset.open; ui.unpicked.clear(); render(el); }));
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
  const toSend = elig.chosen.filter((r) => !ui.unpicked.has(r.c.id) && !r.emailed);
  const tpl = emailState.set.templates.find((x) => x.key === p.templateKey);
  const freeOrders = qualifyingOrders(p);
  const toPack = freeOrders.filter((r) => !r.packed);
  const over = thresholdOrders(p);
  const [phaseLabel, phaseTone] = PHASE[ph];

  return html`
    <section class="card" style="display:grid;gap:14px">
      <div class="row row--between row--wrap">
        <div><h2 class="h2">${p.name}</h2>
          <div class="muted small" style="margin-top:4px">${fmtDate(p.startsOn)} to ${fmtDate(p.endsOn)}${ph === 'live' ? ` · ${DAYS_LEFT(p)} day${DAYS_LEFT(p) === 1 ? '' : 's'} left` : ''}</div></div>
        <div class="row"><span class="status status--${phaseTone}">${phaseLabel}</span><button class="btn btn--ghost btn--sm" data-edit>${icon('pencil', 'i--sm')}Edit</button></div>
      </div>
      <div class="offer__off">${headline(p)}</div>
      <div class="stats">
        <div class="stat"><span class="stat__label">Trade accounts it goes to</span><span class="stat__value">${elig.chosen.length}</span><span class="stat__sub">${elig.blocked.length} can't be emailed</span></div>
        <div class="stat"><span class="stat__label">Emailed so far</span><span class="stat__value">${(p.emailed || []).length}</span><span class="stat__sub">${toSend.length} still to send</span></div>
        <div class="stat"><span class="stat__label">Orders over £${t ? t.minSpend : '—'}</span><span class="stat__value">${over.length}</span><span class="stat__sub">${money(over.reduce((n, o) => n + o.total, 0))} in the window</span></div>
        <div class="stat"><span class="stat__label">Free rolls to pack</span><span class="stat__value">${toPack.reduce((n, r) => n + r.free, 0)}</span><span class="stat__sub">${toPack.length} order${toPack.length === 1 ? '' : 's'} waiting</span></div>
      </div>
    </section>

    <div class="grid grid--2">
      <section class="card">
        <div class="card__head"><h2 class="h2">Who gets it</h2></div>
        <div class="notice notice--info" style="margin-bottom:14px">${icon('info')}<div>
          <strong>Every trade account (tagged b2b) is eligible at checkout.</strong> The 10% discount is limited to the <em>Trade accounts (b2b)</em> customer segment in Shopify, so retail customers never see it. Choose here who gets the email.
          Prospects and trade leads are left out: they don't have trade prices yet.</div></div>
        <div class="list">${AUDIENCES.map((a) => html`
          <label class="list__item check" style="align-items:flex-start">
            <input type="checkbox" data-aud="${a.key}" ${p.audience && p.audience[a.key] ? raw('checked') : ''}>
            <span class="list__main"><span class="strong">${a.label} <span class="badge" style="margin-left:6px">${elig.groups[a.key].length}</span></span><span class="muted small">${a.hint}</span></span>
          </label>`)}</div>
        ${elig.blocked.length ? html`<details style="margin-top:12px"><summary class="small strong" style="cursor:pointer">${elig.blocked.length} trade account${elig.blocked.length === 1 ? '' : 's'} won't be emailed</summary>
          <div class="list" style="margin-top:8px">${elig.blocked.map((r) => html`<div class="list__item"><span class="list__main"><a class="strong" href="#/customers/${r.c.numericId}">${label(r.c)}</a><span class="muted small">${r.reason}</span></span></div>`)}</div></details>` : ''}
      </section>

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
    </div>

    <section class="card">
      <div class="card__head"><h2 class="h2">The email</h2>
        <div class="row row--wrap">${tpl ? html`<a class="btn btn--ghost btn--sm" href="#/templates" data-edit-tpl="${tpl.key}">${icon('pencil', 'i--sm')}Edit in Templates</a>` : ''}</div></div>
      ${!tpl ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>No email template "${p.templateKey}". Pick one in Edit, or add it on the Templates screen.</div></div>` : html`
        ${tpl.isNew ? html`<div class="notice notice--info" style="margin-bottom:12px">${icon('info')}<div><strong>This template isn't saved yet.</strong> Read it over, then save it so the trade server can use it.
          <div style="margin-top:10px"><button class="btn btn--sm" data-save-tpl>${icon('check', 'i--sm')}Save the template</button></div></div></div>` : ''}
        <div class="small muted">Subject</div><div class="strong" style="margin-bottom:10px">${tpl.subject}</div>
        <div class="email-preview" style="white-space:pre-wrap;font-size:var(--text-sm);line-height:1.55;background:var(--surface-subtle);border:1px solid var(--border-subtle);border-radius:var(--radius-card);padding:14px 16px;max-height:340px;overflow:auto">${previewText(tpl.body)}</div>
        <p class="muted small" style="margin:8px 0 0">{fields} are filled in for each dealer and your signature is added. It answers in their existing email thread where there is one.</p>`}

      <h3 class="h3" style="margin-top:20px">Send to ${toSend.length} trade account${toSend.length === 1 ? '' : 's'}</h3>
      ${elig.chosen.length ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th class="w-check"></th><th>Account</th><th>Group</th><th>Email</th><th>Last order</th><th></th></tr></thead>
        <tbody>${elig.chosen.map((r) => html`<tr class="${r.emailed ? 'muted' : ''}">
          <td class="w-check"><input type="checkbox" data-pick="${r.c.id}" ${r.emailed ? raw('disabled') : !ui.unpicked.has(r.c.id) ? raw('checked') : ''} aria-label="Send to ${label(r.c)}"></td>
          <td><a class="cust" href="#/customers/${r.c.numericId}"><span class="cust__name">${label(r.c)}</span><span class="cust__sub">${sublabel(r.c)}</span></a></td>
          <td class="nowrap small">${(AUDIENCES.find((a) => a.key === r.audience) || {}).label}</td>
          <td class="small">${r.c.email}</td>
          <td class="nowrap small">${r.c.lastOrderAt ? ago(r.c.lastOrderAt) : 'Never'}</td>
          <td class="nowrap small">${r.emailed ? 'Drafted' : ''}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">Nobody chosen. Tick a group above.</p>`}
      <div class="row row--wrap" style="margin-top:14px">
        <button class="btn" data-send ${!SERVER_FEATURES || !tpl || tpl.isNew || !toSend.length ? raw('disabled') : ''}>${icon('send', 'i--sm')}Draft ${toSend.length} email${toSend.length === 1 ? '' : 's'} into the Outbox</button>
        <span class="muted small">${SERVER_FEATURES ? 'Nothing sends yet: each waits in the Outbox for you to approve, from trade@ and within the daily sending limits.' : html`Sending works at <a href="${TRADE_SERVER}/#/promotions" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.`}</span>
      </div>
    </section>

    ${f ? html`<section class="card card--flush">
      <div class="card__head"><h2 class="h2">Free rolls to pack</h2><span class="muted small">Trade orders of ${f.everyRolls}+ rolls placed ${fmtDate(p.startsOn)} to ${fmtDate(p.endsOn)}. Check the order note for their choice.</span></div>
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
  return html`${link} <span class="status status--${s.status === 'ACTIVE' ? 'active' : s.status === 'SCHEDULED' ? 'new' : 'lapsed'}">${s.status.toLowerCase()}</span>, trade accounts only, stacks on trade pricing.`;
}

function wire(el, p) {
  const $ = (s) => el.querySelector(s);
  $('[data-edit]').addEventListener('click', () => openEditor(el, p));
  el.querySelectorAll('[data-aud]').forEach((b) => b.addEventListener('change', () => {
    const next = { ...p, audience: { ...(p.audience || {}), [b.dataset.aud]: b.checked } };
    busy(null, () => savePromotion(next)).then(() => render(el)).catch(() => render(el));
  }));
  el.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('change', () => {
    if (b.checked) ui.unpicked.delete(b.dataset.pick); else ui.unpicked.add(b.dataset.pick);
    render(el);
  }));
  const saveTpl = $('[data-save-tpl]');
  if (saveTpl) saveTpl.addEventListener('click', () => busy(saveTpl, () => saveEmailTemplates(emailState.set)).then(() => { toast('Template saved'); render(el); }).catch(() => {}));
  const send = $('[data-send]');
  if (send) send.addEventListener('click', () => sendAll(el, p, send));
  el.querySelectorAll('[data-packed]').forEach((b) => b.addEventListener('click', () => {
    const packed = { ...(p.packed || {}) };
    if (packed[b.dataset.packed]) delete packed[b.dataset.packed]; else packed[b.dataset.packed] = new Date().toISOString();
    busy(b, () => savePromotion({ ...p, packed })).then(() => render(el)).catch(() => {});
  }));
}

async function sendAll(el, p, btn) {
  const rows = eligibility(p).chosen.filter((r) => !ui.unpicked.has(r.c.id) && !r.emailed);
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
  // Remember who's had it, so a second press only drafts for the rest.
  const emailed = [...new Set([...(p.emailed || []), ...r.done.map((d) => d.customerId)])];
  await savePromotion({ ...p, emailed, emailedAt: new Date().toISOString() }).catch((err) => toast(err.message, 'err'));
  window.dispatchEvent(new Event('outbox-changed'));
  render(el);
  if (!r.failed.length) { toast(`${r.drafted} email${r.drafted === 1 ? '' : 's'} drafted. Approve them in the Outbox.`); return; }
  const names = new Map(rows.map((x) => [x.c.id, label(x.c)]));
  openDrawer({
    eyebrow: 'Promotion email',
    title: `${r.drafted} drafted, ${r.failed.length} skipped`,
    body: html`<p class="muted" style="margin-top:0">The drafted ones are waiting in the Outbox. These were skipped:</p>
      <div class="list">${r.failed.map((x) => html`<div class="list__item"><span class="list__main"><span class="strong">${names.get(x.customerId) || x.customerId}</span><span class="muted small">${x.reason}</span></span></div>`)}</div>`,
    foot: html`<a class="btn" href="#/outbox" data-close>${icon('inbox', 'i--sm')}Go to the Outbox</a>`,
  });
}

function openEditor(el, existing) {
  const d = existing ? structuredClone(existing) : {
    id: '', name: '', startsOn: todayISO(), endsOn: todayISO(), perks: [], audience: { active: true, quiet: true, new: true }, templateKey: '', packed: {}, emailed: [],
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
        <p class="muted small" style="margin:0">Create it in Shopify: Discounts → Amount off order → Automatic, eligibility "Trade accounts (b2b)", minimum purchase, combines with product and shipping discounts. Paste its id here so its status shows.</p>
      </fieldset>
      <fieldset class="card" style="box-shadow:none;padding:14px 16px;display:grid;gap:10px"><legend class="h3" style="margin:0">Free rolls</legend>
        <div class="grid grid--2" style="gap:12px">
          <label class="field"><span>Free rolls</span><input class="input" type="number" min="0" step="1" data-r="freeRolls" value="${f.freeRolls}" placeholder="Leave blank for none"></label>
          <label class="field"><span>For every … rolls ordered</span><input class="input" type="number" min="1" step="1" data-r="everyRolls" value="${f.everyRolls}"></label>
        </div>
        <label class="field"><span>Designs they can choose from</span><input class="input" data-r="designs" value="${(f.designs || []).join(', ')}"></label>
      </fieldset>
      <label class="field"><span>Announcement email</span><select class="select" data-f="templateKey">
        <option value="">Choose a template</option>${usable.map((x) => html`<option value="${x.key}" ${x.key === d.templateKey ? raw('selected') : ''}>${x.name}</option>`)}</select></label>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save promotion</button>`,
    onMount(api) {
      api.$('[data-save]').addEventListener('click', (e) => {
        const v = (s) => api.$(s).value.trim();
        const next = { ...d, id: d.id || newPromotionId(), name: v('[data-f="name"]'), startsOn: v('[data-f="startsOn"]'), endsOn: v('[data-f="endsOn"]'), templateKey: v('[data-f="templateKey"]') };
        const perks = [];
        const pct = Number(v('[data-t="percent"]'));
        if (pct > 0) perks.push({ kind: 'threshold', percent: pct, minSpend: Number(v('[data-t="minSpend"]')) || 0, discountId: v('[data-t="discountId"]') });
        const free = Number(v('[data-r="freeRolls"]'));
        if (free > 0) perks.push({ kind: 'free-rolls', freeRolls: free, everyRolls: Number(v('[data-r="everyRolls"]')) || 1, designs: v('[data-r="designs"]').split(',').map((s) => s.trim()).filter(Boolean) });
        next.perks = perks;
        const problem = !next.name ? 'Give it a name.'
          : !next.startsOn || !next.endsOn || next.endsOn < next.startsOn ? 'The end date has to be on or after the start.'
          : !perks.length ? 'Add a % off or free rolls.'
          : null;
        if (problem) { toast(problem, 'err'); return; }
        busy(e.currentTarget, () => savePromotion(next)).then(() => { ui.open = next.id; discounts.clear(); toast(`Saved ${next.name}`); api.close(); render(el); }).catch(() => {});
      });
    },
  });
}
