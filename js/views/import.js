// Import from Notion: choose the export file, check how each dealer lines up
// with a Shopify customer, then bring them over. What gets written is in
// importer.js; this screen is the review step in front of it.
import { state, hasScope, label, isDealer, syncOrders, IMPORT_TAG } from '../store.js';
import { parseFile, buildPlan, importRow, chosenCustomer, ordersToCreate, orderValue, isPrize } from '../importer.js';
import { html, raw, icon, money, fmtDate, toast, loadingBlock, adminUrl } from '../ui.js';

// Module-level so the screen survives re-renders (every customer saved
// during the import redraws it) and leaving and coming back mid-import.
const imp = { stage: 'pick', fileName: '', dealers: null, rows: [], error: '', archive: true, ack: false, progress: null, results: new Map() };
let mounted = null;
const redraw = () => { if (mounted && location.hash.startsWith('#/import')) render(mounted); };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pretty = { Fullfilled: 'Fulfilled' };

async function plan(dealers) {
  imp.stage = 'planning';
  imp.error = '';
  redraw();
  try {
    imp.rows = await buildPlan(dealers);
    imp.dealers = dealers;
    imp.results = new Map();
    imp.ack = false;
    imp.stage = 'review';
  } catch (err) {
    imp.error = `Couldn't check the dealers against Shopify: ${err.message}`;
    imp.stage = 'pick';
  }
  redraw();
}

function totals() {
  const live = imp.rows.filter((r) => r.choice !== 'skip');
  const todo = live.flatMap(ordersToCreate);
  return {
    dealers: live.length,
    linked: live.filter((r) => r.choice.startsWith('link:')).length,
    created: live.filter((r) => r.choice === 'create').length,
    skipped: imp.rows.length - live.length,
    orders: todo.length,
    value: todo.reduce((s, o) => s + orderValue(o), 0),
    already: live.reduce((n, r) => n + r.orders.length - ordersToCreate(r).length, 0),
    calls: live.reduce((n, r) => n + r.dealer.calls.length, 0),
  };
}

function whatHappens(row) {
  const d = row.dealer;
  if (row.choice === 'skip') return 'Not imported';
  if (row.choice === 'create') return `New trade account${d.email ? ` for ${d.email}` : d.phone ? ', phone only (no email to sign in with)' : ', no email or phone'}`;
  const c = chosenCustomer(row);
  if (!c) return '';
  return `Adds to ${label(c)}${isDealer(c) ? '' : ' and makes them a trade account (tag "b2b")'}`;
}

function choiceSelect(row, i) {
  const ids = new Set(row.candidates.map((x) => x.customer.id));
  const others = [...state.customers.values()].filter((c) => !ids.has(c.id)).sort((a, b) => label(a).localeCompare(label(b)));
  const opt = (value, text) => html`<option value="${value}" ${row.choice === value ? raw('selected') : ''}>${text}</option>`;
  return html`<select class="select input--sm" data-choice="${i}" aria-label="Shopify customer for ${row.dealer.name}" ${imp.stage === 'review' ? '' : 'disabled'}>
    ${[[true, 'Looks like'], [false, 'Might be']].map(([strong, heading]) => {
      const list = row.candidates.filter((x) => x.strong === strong);
      return list.length ? html`<optgroup label="${heading}">${list.map((x) => opt(`link:${x.customer.id}`, `${label(x.customer)} · ${x.customer.email || 'no email'} (${x.how})`))}</optgroup>` : '';
    })}
    <optgroup label="Or">${opt('create', 'Create a new trade account')}${opt('skip', "Skip, don't import")}</optgroup>
    ${others.length ? html`<optgroup label="Other trade accounts">${others.map((c) => opt(`link:${c.id}`, `${label(c)} · ${c.email || 'no email'}`))}</optgroup>` : ''}
  </select>`;
}

function orderState(o) {
  if (o.state === 'new') return html`<span class="muted">${imp.stage === 'done' ? 'Not created' : 'Will be created'}</span>`;
  return html`<span class="status status--active">${o.why}</span>`;
}

function rowView(row, i) {
  const d = row.dealer;
  const todo = ordersToCreate(row);
  const result = imp.results.get(i);
  const running = imp.progress && imp.progress.index === i;
  return html`<div class="imp__row ${row.choice === 'skip' ? 'is-skipped' : ''}">
    <div class="field">
      <span>Company</span>
      <input class="input input--sm" data-company="${i}" value="${row.company}" ${imp.stage === 'review' ? '' : 'disabled'} aria-label="Company name for ${d.name}">
      <span class="imp__meta">${[d.contact, d.email || 'No email', d.phone].filter(Boolean).join(' · ')}</span>
    </div>
    <div class="field">
      <span>In Shopify</span>
      ${choiceSelect(row, i)}
      <span class="imp__meta">${whatHappens(row)}</span>
    </div>
    <div class="imp__orders">
      <span class="strong">${todo.length ? `${plural(todo.length, 'order')} · ${money(todo.reduce((s, o) => s + orderValue(o), 0))}` : d.orders.length ? 'No new orders' : 'No orders in Notion'}</span>
      <span class="imp__meta">${[row.orders.length - todo.length ? `${row.orders.length - todo.length} already in Shopify` : '', d.calls.length ? plural(d.calls.length, 'call note') : '', d.lastContacted ? `Last contacted ${fmtDate(d.lastContacted)}` : ''].filter(Boolean).join(' · ')}</span>
    </div>
    ${running ? html`<div class="imp__wide imp__status">${raw('<span class="spinner spinner--sm" aria-hidden="true"></span>')}<span>${imp.progress.step}…</span></div>` : ''}
    ${result ? html`<div class="imp__wide imp__status imp__status--${result.status}">${icon(result.status === 'ok' ? 'check' : result.status === 'err' ? 'circle-alert' : 'minus', 'i--sm')}<span>${result.text}</span>
      ${result.customerId ? html`<a href="#/customers/${result.customerId}">Open</a>` : ''}</div>` : ''}
    ${row.notes.length && row.choice !== 'skip' ? html`<ul class="imp__wide imp__notes">${row.notes.map((n) => html`<li>${n}</li>`)}</ul>` : ''}
    ${d.orders.length || d.calls.length ? html`<details class="imp__wide"><summary>${[d.orders.length ? plural(d.orders.length, 'order') : '', d.calls.length ? plural(d.calls.length, 'call note') : ''].filter(Boolean).join(' and ')} in Notion</summary>
      ${d.orders.length ? html`<div class="table-wrap"><table class="table table--compact">
        <thead><tr><th>Date</th><th>Invoice</th><th class="r">Value</th><th>Payment</th><th class="hide-sm">Status</th><th></th></tr></thead>
        <tbody>${row.orders.map((o) => html`<tr>
          <td class="nowrap">${fmtDate(o.date)}</td><td class="nowrap">${o.invoice}</td>
          <td class="r nowrap">${isPrize(o) ? html`£0 <span class="muted">(prize, ${money(o.value)})</span>` : money(orderValue(o))}</td>
          <td>${o.payment}${o.due && o.payment !== 'Paid' ? html` <span class="muted">· due ${fmtDate(o.due)}</span>` : ''}</td>
          <td class="hide-sm">${pretty[o.status] || o.status}</td>
          <td class="small">${orderState(o)}</td></tr>`)}</tbody></table></div>` : ''}
      ${d.calls.map((c) => html`<p class="small" style="margin:10px 0 0"><span class="strong">Call, ${fmtDate(c.date)}:</span> ${c.text}</p>`)}
    </details>` : ''}
  </div>`;
}

export function render(el) {
  mounted = el;
  const head = html`<a class="back" href="#/setup">${icon('arrow-left', 'i--sm')}Setup</a>
    <div class="page-head"><div><p class="eyebrow">Setup</p><h1 class="h1">Import from Notion</h1></div>
      ${imp.stage === 'review' || imp.stage === 'done' ? html`<div class="page-head__actions"><button class="btn btn--ghost" data-reset>${icon('file-up')}Choose another file</button></div>` : ''}</div>`;

  if (imp.stage === 'pick' || imp.stage === 'planning') {
    el.innerHTML = String(html`<div class="page">${head}
      <section class="card">
        <div class="card__head"><h2 class="h2">Bring over the dealer tracker</h2></div>
        <div class="stack" style="gap:12px">
          <p class="small" style="margin:0">Each dealer in the export becomes a trade account here, or is added to the one they already have: company name, contact, emails, phone, address, last-contacted date and call notes. Their Notion orders become real Shopify orders, dated when they were placed, so they show in the dealer's order history on the website and in the totals here.</p>
          <p class="muted small" style="margin:0">Nothing changes until you've checked who's who and pressed Import. Running it again later only adds what's missing.</p>
          ${imp.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${imp.error}</div></div>` : ''}
          ${imp.stage === 'planning' ? loadingBlock('Matching dealers to Shopify customers…', imp.fileName)
            : html`<label class="btn" style="justify-self:start">${icon('file-up')}Choose the export file<input type="file" accept=".json,application/json" data-file hidden></label>`}
        </div>
      </section></div>`);
    const file = el.querySelector('[data-file]');
    if (file) file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      imp.fileName = f.name;
      try { await plan(parseFile(await f.text())); } catch (err) { imp.error = err.message; imp.stage = 'pick'; redraw(); }
    });
    return;
  }

  const t = totals();
  const canOrders = hasScope('write_orders');
  const busy = imp.stage === 'running';
  const done = [...imp.results.values()];
  const failed = done.filter((r) => r.status === 'err').length;
  el.innerHTML = String(html`<div class="page">${head}
    ${imp.stage === 'done' ? html`<div class="notice ${failed ? 'notice--warn' : 'notice--ok'}">${icon(failed ? 'circle-alert' : 'check')}<div>
        <strong>${failed ? `Done, but ${plural(failed, 'dealer')} didn't finish.` : 'All done.'}</strong>
        ${plural(done.filter((r) => r.created).length, 'new trade account')}, ${done.filter((r) => r.linked).length} added to existing customers, ${plural(done.reduce((n, r) => n + (r.orders || 0), 0), 'order')} created.
        ${failed ? 'Fix what the red lines say (or just try again): running it again picks up where it stopped.' : ''}
        ${done.some((r) => r.orders) ? `Imported orders are tagged "${IMPORT_TAG}" in Shopify.` : ''}</div></div>` : ''}

    ${imp.stage === 'done' ? '' : html`<div class="stats">
      <div class="stat"><span class="stat__label">Dealers</span><span class="stat__value">${t.dealers}</span><span class="stat__sub">${t.linked} matched · ${t.created} new${t.skipped ? ` · ${t.skipped} skipped` : ''}</span></div>
      <div class="stat"><span class="stat__label">Orders to create</span><span class="stat__value">${canOrders ? t.orders : 0}</span><span class="stat__sub">${canOrders ? money(t.value) : 'Needs the create-orders permission'}</span></div>
      <div class="stat"><span class="stat__label">Already in Shopify</span><span class="stat__value">${t.already}</span><span class="stat__sub">Skipped, not doubled up</span></div>
      <div class="stat"><span class="stat__label">Call notes</span><span class="stat__value">${t.calls}</span><span class="stat__sub">Go into each activity log</span></div>
    </div>`}

    ${!canOrders ? html`<div class="notice notice--warn">${icon('circle-alert')}<div><strong>Orders can't be created yet.</strong> Trade Hub needs the "create orders" permission, which comes with the next app update (approve it when Shopify asks). You can bring over the dealers and notes now and run this again for the orders later.</div></div>`
      : t.orders && imp.stage === 'review' ? html`<div class="notice notice--warn">${icon('circle-alert')}<div><strong>These are real orders.</strong> They'll count in Shopify's sales reports and analytics on the dates they were placed, and in any app that copies Shopify orders into your accounts. Your invoices already cover them, so make sure that app won't record them twice. No emails go to dealers and no stock is used.</div></div>` : ''}
    ${busy ? html`<div class="notice notice--info">${icon('refresh-cw')}<div><strong>Importing ${imp.progress ? `${imp.progress.index + 1} of ${imp.rows.length}` : ''}…</strong> Keep Trade Hub open until it finishes.</div></div>` : ''}

    <section class="card card--flush">
      <div class="card__head"><h2 class="h2">Dealers</h2><span class="muted small">${imp.fileName} · check who each one is in Shopify</span></div>
      <div class="imp">${imp.rows.map(rowView)}</div>
    </section>

    ${imp.stage === 'review' ? html`<section class="card"><div class="form">
      ${canOrders && t.orders ? html`<label class="check"><input type="checkbox" data-archive ${imp.archive ? raw('checked') : ''}><span><span class="strong">Archive the imported orders</span><br><span class="muted small">They still show in the dealer's order history; they just stay out of your open orders in Shopify.</span></span></label>
      <label class="check"><input type="checkbox" data-ack ${imp.ack ? raw('checked') : ''}><span>I understand ${plural(t.orders, 'order')} worth ${money(t.value)} will be added to Shopify's sales history.</span></label>` : ''}
      <div class="row row--wrap"><button class="btn" data-run ${t.dealers && (imp.ack || !canOrders || !t.orders) ? '' : 'disabled'}>${icon('download')}Import ${plural(t.dealers, 'dealer')}${canOrders && t.orders ? ` and ${plural(t.orders, 'order')}` : ''}</button>
        <a class="btn btn--ghost" href="${adminUrl(`orders?query=tag%3A${IMPORT_TAG}`)}" target="_top">${icon('external-link', 'i--sm')}Imported orders in Shopify</a></div>
    </div></section>` : ''}
    ${imp.stage === 'done' ? html`<div class="row row--wrap"><a class="btn" href="#/customers">${icon('users')}See customers</a>${failed ? html`<button class="btn btn--outline" data-again>${icon('refresh-cw')}Try again</button>` : ''}</div>` : ''}
  </div>`);

  const reset = el.querySelector('[data-reset]');
  if (reset) reset.addEventListener('click', () => { Object.assign(imp, { stage: 'pick', rows: [], dealers: null, error: '', results: new Map() }); redraw(); });
  el.querySelectorAll('[data-company]').forEach((input) => input.addEventListener('input', () => { imp.rows[Number(input.dataset.company)].company = input.value; }));
  el.querySelectorAll('[data-choice]').forEach((select) => select.addEventListener('change', () => { imp.rows[Number(select.dataset.choice)].choice = select.value; redraw(); }));
  const archive = el.querySelector('[data-archive]');
  if (archive) archive.addEventListener('change', () => { imp.archive = archive.checked; });
  const ack = el.querySelector('[data-ack]');
  if (ack) ack.addEventListener('change', () => { imp.ack = ack.checked; redraw(); });
  const runBtn = el.querySelector('[data-run]');
  if (runBtn) runBtn.addEventListener('click', run);
  const again = el.querySelector('[data-again]');
  if (again) again.addEventListener('click', () => plan(imp.dealers));
}

async function run() {
  const live = imp.rows.filter((r) => r.choice !== 'skip');
  const seen = new Map();
  for (const r of live) {
    if (!r.company.trim()) { toast(`Give ${r.dealer.name} a company name`, 'err'); return; }
    if (!r.choice.startsWith('link:')) continue;
    const id = r.choice.slice(5);
    if (seen.has(id)) { toast(`${seen.get(id)} and ${r.dealer.name} are set to the same Shopify customer`, 'err'); return; }
    seen.set(id, r.dealer.name);
  }
  imp.stage = 'running';
  imp.results = new Map();
  const withOrders = hasScope('write_orders');
  for (const [i, row] of imp.rows.entries()) {
    if (row.choice === 'skip') { imp.results.set(i, { status: 'skip', text: 'Skipped' }); continue; }
    imp.progress = { index: i, step: 'Starting' };
    redraw();
    try {
      const r = await importRow(row, { archive: imp.archive, withOrders }, (step) => { imp.progress.step = step; redraw(); });
      const c = chosenCustomer(row);
      const bits = [r.created ? 'New trade account' : `Added to ${label(c)}`];
      if (r.tagged) bits.push('tagged "b2b"');
      if (r.orders) bits.push(plural(r.orders, 'order'));
      if (r.addressAdded) bits.push('address added');
      imp.results.set(i, { status: 'ok', ...r, customerId: c && c.numericId, text: [bits.join(' · '), ...r.warnings].join('. ') });
    } catch (err) {
      imp.results.set(i, { status: 'err', text: err.message || 'Something went wrong' });
    }
  }
  imp.progress = null;
  imp.stage = 'done';
  redraw();
  syncOrders(); // picks up the new orders for the dashboard and customer pages
}
