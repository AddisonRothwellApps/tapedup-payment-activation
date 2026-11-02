// One trade account: who they are (the details card), how they're ordering,
// their starter offer, account switches (trade / terms / stage / note) and
// the comms log.
import {
  state, insights, isDealer, isTerms, label, sublabel, shortTape, offerStatus, describeOffer, offerHeadline, defaultTemplate, STATUS, STAGES, LOG_TYPES, TAGS, stageOf,
  setTag, setStage, saveNote, saveProfile, lastContact, orderSummary, addLog, updateLog, deleteLog, removeOffer, revenueSeries, todayISO, addDaysISO,
} from '../store.js';
import { html, raw, icon, money, money0, ago, fmtDate, dueLabel, trendBadge, statusChip, toast, openDrawer, busy, armed, columnChart, barList, adminUrl } from '../ui.js';
import { openGiveOffer, offerStatusChip } from './offers.js';

const pretty = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const expanded = new Set();

export function render(el, numericId) {
  const c = state.byNumericId.get(numericId);
  if (!c) {
    el.innerHTML = String(html`<div class="page"><a class="back" href="#/customers">${icon('arrow-left', 'i--sm')}Customers</a>
      <div class="card empty">${icon('users')}<span>That customer isn't in the list. They may have been deleted in Shopify.</span></div></div>`);
    return;
  }
  const s = insights(c);
  const allOrders = state.ordersByCustomer.get(c.numericId) || [];
  const offerState = offerStatus(c);
  const today = todayISO();
  const log = [...c.crm.log].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const tpl = defaultTemplate();
  const windowNote = state.ordersWindowStart && c.numberOfOrders > s.orders.length
    ? `Order history here goes back to ${fmtDate(state.ordersWindowStart)}; lifetime totals come straight from Shopify.` : '';
  // Imported customers were "created" on import day; their first order says how long they've really been buying.
  const oldest = allOrders.length ? allOrders[allOrders.length - 1].at : null;
  const since = oldest && oldest < c.createdAt ? oldest : c.createdAt;
  const contacted = lastContact(c);
  const onlyImported = s.orders.length > 0 && s.orders.every((o) => o.imp);

  el.innerHTML = String(html`
    <div class="page">
      <a class="back" href="#/customers">${icon('arrow-left', 'i--sm')}Customers</a>
      <div class="page-head">
        <div style="min-width:0">
          <p class="eyebrow">${isDealer(c) ? 'Trade account' : 'No longer a trade account'}</p>
          <h1 class="h1">${label(c)}</h1>
          <div class="row row--wrap" style="margin-top:10px;gap:8px">
            ${isTerms(c) ? html`<span class="badge">Pays on terms</span>` : ''}
            ${(() => { const st = stageOf(c); return html`<span class="badge ${st.guessed ? '' : 'badge--cyan'}" title="${st.guessed ? 'Suggested from their orders: not set yet' : 'Pipeline stage'}">${st.stage}${st.guessed ? '?' : ''}</span>`; })()}
            ${statusChip(s.status, STATUS)}
            <span class="muted small">${[sublabel(c), c.email, c.phone, [c.city, c.country].filter(Boolean).join(', '), contacted ? `Last contacted ${ago(contacted)}` : ''].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div class="page-head__actions">
          ${c.email ? html`<a class="btn btn--outline btn--sm" href="mailto:${c.email}" target="_blank" rel="noopener" data-email>${icon('mail', 'i--sm')}Email</a>` : ''}
          ${c.phone ? html`<a class="btn btn--outline btn--sm" href="tel:${c.phone.replace(/\s/g, '')}" data-call>${icon('phone', 'i--sm')}Call</a>` : ''}
          <button class="btn btn--sm" data-log>${icon('notebook-pen', 'i--sm')}Log activity</button>
          <a class="btn btn--ghost btn--sm" href="${adminUrl(`customers/${c.numericId}`)}" target="_top">${icon('external-link', 'i--sm')}Shopify</a>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat__label">Lifetime spend</span><span class="stat__value">${money0(c.amountSpent)}</span><span class="stat__sub">Customer since ${fmtDate(since)}</span></div>
        <div class="stat"><span class="stat__label">Orders</span><span class="stat__value">${c.numberOfOrders}</span><span class="stat__sub">${s.gap ? `Usually every ${Math.round(s.gap)} days` : 'Not enough orders for a pattern'}</span></div>
        <div class="stat"><span class="stat__label">Average order</span><span class="stat__value">${money0(s.aov)}</span><span class="stat__sub">Across all orders</span></div>
        <div class="stat"><span class="stat__label">Last order</span><span class="stat__value">${s.daysSince === null ? '—' : s.daysSince === 0 ? 'Today' : `${s.daysSince} day${s.daysSince === 1 ? '' : 's'}`}</span><span class="stat__sub">${s.lastAt ? `ago · ${fmtDate(s.lastAt)}` : 'Never ordered'}</span></div>
        <div class="stat"><span class="stat__label">Last 90 days</span><span class="stat__value">${s.trend ? money0(s.trend.cur) : '—'}</span><span class="stat__sub">${s.trend ? html`${trendBadge(s.trend)}<span>vs ${money0(s.trend.prev)} the 90 before</span>` : 'Shown once they order regularly'}</span></div>
      </div>

      <div class="grid grid--side">
        <div class="stack">
          <section class="card">
            <div class="card__head"><h2 class="h2">Spend by month</h2><span class="muted small">Last 12 months</span></div>
            ${s.orders.length ? html`<div data-chart></div>` : html`<div class="empty">${icon('receipt')}<span>No orders ${state.ordersWindowStart ? `since ${fmtDate(state.ordersWindowStart)}` : 'yet'}.</span></div>`}
            ${windowNote ? html`<p class="muted small" style="margin:8px 0 0">${windowNote}</p>` : ''}
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Best tapes</h2><span class="muted small">Units bought</span></div>
            ${s.products.length ? barList(s.products, { value: (p) => p.units, label: (p) => shortTape(p.title), format: (v) => `${v} units`, sub: (p) => money0(p.revenue) })
              : html`<p class="muted small" style="margin:0">${onlyImported ? 'Their orders came over from Notion as invoice totals, so there are no tapes to rank yet.' : 'Nothing bought in the synced order history.'}</p>`}
          </section>

          <section class="card card--flush">
            <div class="card__head"><h2 class="h2">Orders</h2><span class="muted small">${allOrders.length} shown</span></div>
            ${allOrders.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
              <thead><tr><th>Order</th><th>Date</th><th class="hide-sm">Items</th><th class="r">Total</th><th>Payment</th><th class="hide-sm">Fulfilment</th></tr></thead>
              <tbody>${allOrders.map((o) => html`
                <tr data-href="${o.id}" data-order="${o.id}">
                  <td class="nowrap"><span class="strong">${o.name}</span> ${o.x ? html`<span class="badge">Cancelled</span>` : ''}</td>
                  <td class="nowrap">${fmtDate(o.at)}</td>
                  <td class="hide-sm clip" style="max-width:180px">${orderSummary(o)}</td>
                  <td class="r">${money(o.total)}</td>
                  <td class="nowrap">${pretty(o.pay)}</td>
                  <td class="hide-sm nowrap">${pretty(o.ful)}</td>
                </tr>
                ${expanded.has(o.id) ? html`<tr><td colspan="6" style="background:var(--surface-subtle)">
                  <div class="list">${o.lines.map(([title, variant, qty, amount]) => html`<div class="list__item"><span class="list__main">${title}${variant ? html` <span class="muted">· ${variant}</span>` : ''}</span><span class="num">${qty} ×</span><span class="num" style="width:90px;text-align:right">${money(amount)}</span></div>`)}</div>
                  <a class="btn btn--ghost btn--sm" style="margin-top:8px" href="${adminUrl(`orders/${o.id}`)}" target="_top">${icon('external-link', 'i--sm')}Open in Shopify</a>
                </td></tr>` : ''}`)}</tbody></table></div>`
              : html`<div class="empty">${icon('receipt')}<span>No orders in the synced history.</span></div>`}
          </section>
        </div>

        <div class="stack">
          ${detailsCard(c, contacted)}

          <section class="card">
            <div class="card__head"><h2 class="h2">Starter offer</h2>${offerState ? offerStatusChip(offerState) : ''}</div>
            ${c.offer ? html`
              <div class="offer">
                <div><div class="offer__off">${offerHeadline(c.offer)}</div>
                  ${c.offer.packPrice && c.offer.tradeTotal ? html`<div class="muted small">Trade price ${money(c.offer.tradeTotal)} · ${Math.round(Number(c.offer.discountValue) * 10) / 10}% off their order</div>` : ''}</div>
                <ul class="offer__items">${(c.offer.items || []).map((i) => html`<li><b>${i.quantity} ×</b> ${i.title}</li>`)}</ul>
                <div class="muted small">${c.offer.templateName || 'Custom offer'} · given ${c.offer.assignedAt ? ago(c.offer.assignedAt) : ''}${c.offer.expiresOn ? ` · until ${fmtDate(c.offer.expiresOn)}` : ''}</div>
              </div>
              <div class="row row--wrap" style="margin-top:12px">
                <button class="btn btn--sm" data-offer-change>${icon('pencil', 'i--sm')}${offerState === 'Waiting' ? 'Change' : 'Give a new one'}</button>
                <button class="btn btn--danger btn--sm" data-offer-remove>Remove</button>
              </div>`
            : html`
              <p class="muted small" style="margin:0 0 12px">${isDealer(c) && !c.numberOfOrders ? 'New trade account with no orders yet: a good moment for an opening order.' : 'No starter offer.'}</p>
              <button class="btn btn--accent btn--sm" data-offer-give>${icon('gift', 'i--sm')}${tpl ? `Give ${tpl.name}` : 'Give a starter offer'}</button>`}
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Account</h2></div>
            <div class="form">
              <label class="check"><input type="checkbox" data-tag="${TAGS.dealer}" ${isDealer(c) ? raw('checked') : ''}><span><span class="strong">Trade account</span><br><span class="muted small">Trade pricing, B2B shipping and the dealer area (tag "${TAGS.dealer}")</span></span></label>
              <label class="check"><input type="checkbox" data-tag="${TAGS.terms}" ${isTerms(c) ? raw('checked') : ''}><span><span class="strong">Pays on terms</span><br><span class="muted small">Can order now, pay by invoice (tag "${TAGS.terms}")</span></span></label>
              <label class="field"><span>Pipeline stage</span><select class="select" data-stage>${(() => { const cur = stageOf(c); return html`${cur.guessed ? html`<option value="" selected>Not set (looks like ${cur.stage})</option>` : ''}${STAGES.map((st) => html`<option ${!cur.guessed && cur.stage === st ? raw('selected') : ''}>${st}</option>`)}`; })()}</select></label>
              <label class="field"><span>Note (also shown in Shopify)</span><textarea class="textarea" data-note>${c.note}</textarea></label>
              <button class="btn btn--outline btn--sm" data-save-note style="justify-self:start">Save note</button>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Activity</h2><button class="btn btn--sm" data-log>${icon('plus', 'i--sm')}Log</button></div>
            ${log.length ? html`<div class="timeline">${log.map((e) => timelineItem(e, today))}</div>`
              : html`<p class="muted small" style="margin:0">No calls, emails or notes yet. Log one to start the history.</p>`}
          </section>
        </div>
      </div>
    </div>`);

  if (s.orders.length) {
    columnChart(el.querySelector('[data-chart]'), revenueSeries(s.orders, 365), { unit: 'Spend', height: 200 });
  }
  el.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => openLogDrawer(c)));
  el.querySelector('[data-edit-details]').addEventListener('click', () => openDetailsDrawer(c));
  const email = el.querySelector('[data-email]');
  if (email) email.addEventListener('click', () => setTimeout(() => openLogDrawer(c, 'email'), 300));
  const call = el.querySelector('[data-call]');
  if (call) call.addEventListener('click', () => setTimeout(() => openLogDrawer(c, 'call'), 300));

  el.querySelectorAll('[data-order]').forEach((tr) => tr.addEventListener('click', () => {
    if (expanded.has(tr.dataset.order)) expanded.delete(tr.dataset.order); else expanded.add(tr.dataset.order);
    render(el, numericId);
  }));

  const give = el.querySelector('[data-offer-give]');
  if (give) give.addEventListener('click', () => openGiveOffer({ customers: [c] }));
  const change = el.querySelector('[data-offer-change]');
  if (change) change.addEventListener('click', () => (offerState === 'Waiting' ? openGiveOffer({ customers: [c], offer: c.offer }) : openGiveOffer({ customers: [c] })));
  const remove = el.querySelector('[data-offer-remove]');
  if (remove) armed(remove, () => busy(remove, () => removeOffer(c)).then(() => toast('Starter offer removed')).catch(() => {}), 'Click again to remove');

  el.querySelectorAll('[data-tag]').forEach((cb) => cb.addEventListener('change', () => {
    const on = cb.checked;
    const what = cb.dataset.tag === TAGS.dealer ? 'Trade account' : 'Pays on terms';
    busy(cb, () => setTag(c, cb.dataset.tag, on, `${what} turned ${on ? 'on' : 'off'}`))
      .then(() => toast(`${what} ${on ? 'on' : 'off'} for ${label(c)}`))
      .catch(() => { cb.checked = !on; });
  }));
  el.querySelector('[data-stage]').addEventListener('change', (e) => {
    const stage = e.target.value;
    busy(e.target, () => setStage(c, stage)).then(() => toast(stage ? `Moved to ${stage}` : 'Stage cleared')).catch(() => {});
  });
  el.querySelector('[data-save-note]').addEventListener('click', (e) => {
    const note = el.querySelector('[data-note]').value;
    busy(e.currentTarget, () => saveNote(c, note)).then(() => toast('Note saved')).catch(() => {});
  });
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => busy(b, () => updateLog(c, b.dataset.done, { done: true })).then(() => toast('Follow-up done')).catch(() => {})));
  el.querySelectorAll('[data-del]').forEach((b) => armed(b, () => busy(b, () => deleteLog(c, b.dataset.del)).then(() => toast('Deleted')).catch(() => {}), 'Delete?'));
}

function detailsCard(c, contacted) {
  const p = c.crm.profile;
  const rows = [
    ['Company', c.company],
    ['Contact', c.contact || (c.name !== c.email && c.name !== c.company ? c.name : '')],
    ['Email', c.email],
    ['Other emails', (p.otherEmails || []).join(', ')],
    ['Finance email', p.financeEmail],
    ['Phone', c.phone],
    ['Address', p.address],
    ['Last contact', contacted ? `${fmtDate(contacted)} (${ago(contacted)})` : ''],
  ].filter(([, v]) => v);
  return html`<section class="card">
    <div class="card__head"><h2 class="h2">Details</h2><button class="btn btn--ghost btn--sm" data-edit-details>${icon('pencil', 'i--sm')}Edit</button></div>
    ${rows.length ? html`<dl class="details">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : html`<p class="muted small" style="margin:0">No details yet.</p>`}
    ${(p.labels || []).length ? html`<div class="row row--wrap" style="gap:6px;margin-top:12px">${p.labels.map((l) => html`<span class="badge">${l}</span>`)}</div>` : ''}
    ${p.notionId ? html`<p class="faint small" style="margin:12px 0 0">Brought over from Notion</p>` : ''}
  </section>`;
}

/** Edits the CRM profile. The email and phone they sign in with stay in Shopify; these are for you. */
function openDetailsDrawer(c) {
  const p = c.crm.profile;
  const field = (key, text, value, attrs = '') => html`<label class="field"><span>${text}</span><input class="input" data-p="${key}" value="${value || ''}" ${raw(attrs)} autocomplete="off"></label>`;
  openDrawer({
    eyebrow: label(c),
    title: 'Edit details',
    body: html`<form class="form" onsubmit="return false">
      ${field('company', 'Company / gym', c.company)}
      ${field('contact', 'Contact', c.contact, 'placeholder="Who you deal with"')}
      <div class="form-row">${field('phone', 'Phone', p.phone || c.phone, 'type="tel"')}${field('financeEmail', 'Finance email', p.financeEmail, 'type="email"')}</div>
      ${field('otherEmails', 'Other emails', (p.otherEmails || []).join(', '), 'placeholder="Separate with commas"')}
      <label class="field"><span>Address</span><textarea class="textarea" data-p="address" rows="2">${p.address || ''}</textarea></label>
      <label class="field"><span>Last contacted</span><input class="input" type="date" data-p="lastContacted" value="${(p.lastContacted || '').slice(0, 10)}" max="${todayISO()}"></label>
      <label class="check"><input type="checkbox" data-visited ${(p.labels || []).includes('Visited') ? raw('checked') : ''}><span>Visited in person</span></label>
      <p class="muted small" style="margin:0">Logging a call, email or visit updates "last contact" by itself. The email and phone they sign in with are changed in Shopify (${c.email || 'no email'}).</p>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save</button>`,
    onMount(api) {
      api.$('[data-save]').addEventListener('click', (e) => {
        const v = (k) => api.$(`[data-p="${k}"]`).value.trim();
        const labels = (p.labels || []).filter((l) => l !== 'Visited');
        if (api.$('[data-visited]').checked) labels.push('Visited');
        const patch = {
          company: v('company'), contact: v('contact'), phone: v('phone'), financeEmail: v('financeEmail'),
          otherEmails: v('otherEmails').split(/[,;\s]+/).filter((x) => x.includes('@')),
          address: v('address'), lastContacted: v('lastContacted'), labels,
        };
        if (!patch.company) { toast('Add the company name', 'err'); return; }
        busy(e.currentTarget, () => saveProfile(c, patch)).then(() => { toast('Details saved'); api.close(); }).catch(() => {});
      });
    },
  });
}

function timelineItem(e, today) {
  const type = LOG_TYPES[e.type] || LOG_TYPES.note;
  const due = e.followUp ? dueLabel(e.followUp, today) : null;
  return html`<div class="tl">
    <span class="tl__icon ${e.type === 'auto' ? 'tl__icon--auto' : ''}">${icon(type.icon, 'i--sm')}</span>
    <div class="tl__body">
      <div class="tl__meta"><span class="strong">${type.label}</span><span>${fmtDate(e.at)}</span>
        ${e.followUp ? html`<span class="followup ${e.done ? 'followup--done' : due.kind ? `followup--${due.kind}` : ''}">${icon('calendar', 'i--sm')}${e.done ? `Followed up (${fmtDate(e.followUp)})` : due.text}</span>` : ''}</div>
      ${e.text ? html`<div class="tl__text">${e.text}</div>` : ''}
      <div class="row" style="gap:4px">
        ${e.followUp && !e.done ? html`<button class="btn btn--ghost btn--sm" data-done="${e.id}">${icon('check', 'i--sm')}Done</button>` : ''}
        ${e.type === 'auto' ? '' : html`<button class="btn btn--ghost btn--sm" data-del="${e.id}" aria-label="Delete entry">${icon('trash-2', 'i--sm')}</button>`}
      </div>
    </div>
  </div>`;
}

export function openLogDrawer(c, type = 'call') {
  const today = todayISO();
  openDrawer({
    eyebrow: label(c),
    title: 'Log activity',
    body: html`<form class="form" onsubmit="return false">
      <div class="field"><span>What was it?</span><div class="seg" role="group" aria-label="Type" data-types>
        ${Object.entries(LOG_TYPES).filter(([k]) => k !== 'auto').map(([k, t]) => html`<button type="button" data-type="${k}" aria-pressed="${String(k === type)}">${t.label}</button>`)}
      </div></div>
      <label class="field"><span>When</span><input class="input" type="date" data-date value="${today}" max="${today}"></label>
      <label class="field"><span>What happened</span><textarea class="textarea" data-text placeholder="Spoke to the buyer, they want 2 boxes of DOODLE before the comp…"></textarea></label>
      <div class="field"><span>Follow up (optional)</span>
        <input class="input" type="date" data-follow min="${today}">
        <div class="row row--wrap" style="gap:6px">${[[2, '2 days'], [7, '1 week'], [14, '2 weeks'], [30, '1 month']].map(([d, l]) => html`<button type="button" class="btn btn--ghost btn--sm" data-plus="${d}">+${l}</button>`)}</div>
      </div>
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save</button>`,
    onMount(api) {
      let current = type;
      api.$$('[data-type]').forEach((b) => b.addEventListener('click', () => {
        current = b.dataset.type;
        api.$$('[data-type]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
      api.$$('[data-plus]').forEach((b) => b.addEventListener('click', () => { api.$('[data-follow]').value = addDaysISO(today, Number(b.dataset.plus)); }));
      api.$('[data-text]').focus();
      api.$('[data-save]').addEventListener('click', (e) => {
        const text = api.$('[data-text]').value.trim();
        const date = api.$('[data-date]').value || today;
        const followUp = api.$('[data-follow]').value;
        if (!text && !followUp) { toast('Write what happened, or set a follow-up', 'err'); return; }
        const at = date === today ? new Date().toISOString() : `${date}T12:00:00.000Z`;
        busy(e.currentTarget, () => addLog(c, { type: current, text, at, followUp })).then(() => { toast('Logged'); api.close(); }).catch(() => {});
      });
    },
  });
}
