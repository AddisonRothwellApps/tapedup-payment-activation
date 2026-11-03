// One trade account: who they are (the details card), how they're ordering,
// their starter offer, account switches (trade / terms / stage / note) and
// the comms log.
import {
  state, insights, isDealer, isLead, isTerms, label, sublabel, shortTape, offerStatus, describeOffer, offerHeadline, defaultTemplate, STATUS, STAGES, LOG_TYPES, TAGS, stageOf,
  setTag, setStage, saveNote, saveProfile, lastContact, orderSummary, addLog, updateLog, deleteLog, removeOffer, revenueSeries, todayISO, addDaysISO,
} from '../store.js';
import { html, raw, icon, money, money0, ago, fmtDate, dueLabel, trendBadge, statusChip, toast, openDrawer, busy, armed, columnChart, barList, adminUrl } from '../ui.js';
import { emailCardShell, mountEmailCard, draftPickerShell, mountDraftPicker } from './email-card.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { TRADE_SERVER } from '../env.js';
import { samplesCardShell, mountSamplesCard } from './samples-card.js';
import { ensureForm, saveBar, detailsFormCard, mountDetailsForm } from './customer-form.js';
import { openGiveOffer, offerStatusChip } from './offers.js';

const pretty = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const expanded = new Set();
// "View more" on orders and activity, remembered while you stay on one customer.
const more = { id: null, orders: false, log: false };
const FIRST = 5;


export function render(el, numericId) {
  const c = state.byNumericId.get(numericId);
  if (!c) {
    el.innerHTML = String(html`<div class="page"><a class="back" href="#/customers">${icon('arrow-left', 'i--sm')}Customers</a>
      <div class="card empty">${icon('users')}<span>That customer isn't in the list. They may have been deleted in Shopify.</span></div></div>`);
    return;
  }
  if (more.id !== c.id) Object.assign(more, { id: c.id, orders: false, log: false });
  ensureForm(c);
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
      ${saveBar()}
      <a class="back" href="#/customers">${icon('arrow-left', 'i--sm')}Customers</a>
      <div class="page-head">
        <div style="min-width:0">
          <p class="eyebrow">${isDealer(c) ? 'Trade account' : isLead(c) ? 'Trade lead: no trade pricing yet' : 'No longer a trade account'}</p>
          <h1 class="h1">${label(c)}</h1>
          <div class="row row--wrap" style="margin-top:10px;gap:8px">
            ${isTerms(c) ? html`<span class="badge">Pays on terms</span>` : ''}
            ${(() => { const st = stageOf(c); return html`<span class="badge ${st.guessed ? '' : 'badge--cyan'}" title="${st.guessed ? 'Suggested from their orders: not set yet' : 'Pipeline stage'}">${st.stage}${st.guessed ? '?' : ''}</span>`; })()}
            ${statusChip(s.status, STATUS)}
            <span class="muted small">${[sublabel(c), c.email, c.phone, [c.city, c.country].filter(Boolean).join(', '), contacted ? `Last contacted ${ago(contacted)}` : ''].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div class="page-head__actions">
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
            <div class="card__head"><h2 class="h2">Orders</h2><span class="muted small">${allOrders.length > FIRST && !more.orders ? `Latest ${FIRST} of ${allOrders.length}` : `${allOrders.length} order${allOrders.length === 1 ? '' : 's'}`}</span></div>
            ${allOrders.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
              <thead><tr><th>Order</th><th>Date</th><th class="hide-sm">Items</th><th class="r">Total</th><th>Payment</th><th class="hide-sm">Fulfilment</th></tr></thead>
              <tbody>${(more.orders ? allOrders : allOrders.slice(0, FIRST)).map((o) => html`
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
                </td></tr>` : ''}`)}</tbody></table></div>
              ${allOrders.length > FIRST ? html`<div style="padding:10px 16px 14px"><button class="btn btn--ghost btn--sm" data-more="orders">${more.orders ? 'Show the latest 5' : `View all ${allOrders.length} orders`}</button></div>` : ''}`
              : html`<div class="empty">${icon('receipt')}<span>No orders in the synced history.</span></div>`}
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Activity</h2><button class="btn btn--sm" data-log>${icon('plus', 'i--sm')}Log</button></div>
            ${log.length ? html`<div class="timeline">${(more.log ? log : log.slice(0, FIRST)).map((e) => timelineItem(e, today))}</div>
              ${log.length > FIRST ? html`<button class="btn btn--ghost btn--sm" style="margin-top:8px" data-more="log">${more.log ? 'Show the latest 5' : `View all ${log.length} entries`}</button>` : ''}`
              : html`<p class="muted small" style="margin:0">No calls, emails or notes yet. Log one to start the history.</p>`}
          </section>

          ${emailCardShell()}
        </div>

        <div class="stack">
          ${detailsFormCard(c)}

          ${quickActions(c)}

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

          ${samplesCardShell()}


          <section class="card">
            <div class="card__head"><h2 class="h2">Remove or delete</h2></div>
            ${SERVER_FEATURES ? html`<p class="muted small" style="margin:0 0 10px">Take ${label(c)} out of Trade Hub, or delete them from Shopify if they've never ordered.</p>
              <button class="btn btn--danger btn--ghost btn--sm" data-remove>${icon('trash-2', 'i--sm')}Remove or delete…</button>`
              : html`<p class="muted small" style="margin:0">Remove or delete accounts at <a href="${TRADE_SERVER}/#/customers/${c.numericId}" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p>`}
          </section>
        </div>
      </div>
    </div>`);

  if (s.orders.length) {
    columnChart(el.querySelector('[data-chart]'), revenueSeries(s.orders, 365), { unit: 'Spend', height: 200 });
  }
  mountSamplesCard(el.querySelector('[data-samples-card]'), c);
  mountDetailsForm(el, c, () => render(el, numericId));
  mountEmailCard(el.querySelector('[data-email-card]'), c);
  mountDraftPicker(el.querySelector('[data-draft-picker]'), c);
  el.querySelectorAll('[data-more]').forEach((b) => b.addEventListener('click', () => { more[b.dataset.more] = !more[b.dataset.more]; render(el, numericId); }));
  el.querySelectorAll('[data-qa]').forEach((b) => b.addEventListener('click', () => openLogDrawer(c, b.dataset.qa)));
  const rm = el.querySelector('[data-remove]');
  if (rm) rm.addEventListener('click', () => openRemove(c));
  el.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => openLogDrawer(c)));

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

  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => busy(b, () => updateLog(c, b.dataset.done, { done: true })).then(() => toast('Follow-up done')).catch(() => {})));
  el.querySelectorAll('[data-del]').forEach((b) => armed(b, () => busy(b, () => deleteLog(c, b.dataset.del)).then(() => toast('Deleted')).catch(() => {}), 'Delete?'));
}

/** The things you do most, in one place at the top of the side column. */
function quickActions(c) {
  return html`<section class="card">
    <div class="card__head"><h2 class="h2">Quick actions</h2></div>
    <div class="qa">
      <button class="btn btn--outline btn--sm" data-qa="call">${icon('phone', 'i--sm')}Log a call</button>
      <button class="btn btn--outline btn--sm" data-qa="meeting">${icon('handshake', 'i--sm')}Log a visit</button>
      <button class="btn btn--outline btn--sm" data-qa="note">${icon('notebook-pen', 'i--sm')}Add a note</button>
      ${c.phone ? html`<a class="btn btn--outline btn--sm" href="tel:${c.phone.replace(/\s/g, '')}">${icon('phone-outgoing', 'i--sm')}Call</a>` : ''}
    </div>
    ${draftPickerShell()}
  </section>`;
}

/** Remove from Trade Hub (trade tags off, stays in Shopify) or delete from Shopify (no orders only). */
function openRemove(c) {
  const canDelete = !c.numberOfOrders;
  openDrawer({
    eyebrow: label(c), title: 'Remove or delete',
    body: html`<div class="form">
      <label class="check"><input type="radio" name="mode" value="remove" checked><span><span class="strong">Remove from Trade Hub</span><br>
        <span class="muted small">Takes off the trade tags, so they lose trade pricing and leave Trade Hub. They stay in Shopify as a normal customer, with their ${c.numberOfOrders} order${c.numberOfOrders === 1 ? '' : 's'}. Unsent drafts are cancelled.</span></span></label>
      <label class="check"><input type="radio" name="mode" value="delete" ${canDelete ? '' : raw('disabled')}><span><span class="strong">Delete from Shopify for good</span><br>
        <span class="muted small">${canDelete ? "Deletes the customer and our email history with them. This can't be undone." : "Not possible: Shopify won't delete a customer who has orders."}</span></span></label>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--danger" data-go>${icon('trash-2', 'i--sm')}Remove</button>`,
    onMount(api) {
      const go = api.$('[data-go]');
      const sync = () => { go.innerHTML = String(html`${icon('trash-2', 'i--sm')}${api.$('input[name="mode"]:checked').value === 'delete' ? 'Delete for good' : 'Remove'}`); };
      api.$$('input[name="mode"]').forEach((r) => r.addEventListener('change', sync));
      armed(go, () => {
        const mode = api.$('input[name="mode"]:checked').value;
        busy(go, () => serverApi(`/api/accounts/${c.numericId}/remove`, { method: 'POST', body: { mode } }))
          .then(() => {
            state.customers.delete(c.id); state.byNumericId.delete(c.numericId);
            toast(mode === 'delete' ? `${label(c)} deleted` : `${label(c)} removed from Trade Hub`);
            api.close();
            location.hash = '#/customers';
          }).catch(() => {});
      }, 'Click again to confirm');
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
