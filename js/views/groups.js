// Groups: businesses with several centres. The list shows each group with
// its centres; a group's page adds up their orders (each centre keeps its own
// account, emails and orders), and you add, rename or remove centres there.
// The customer page shows the group card (mountGroupCard) too.
import { state, label, stageOf, orderSummary } from '../store.js';
import { html, raw, icon, money, money0, fmtDate, ago, toast, openDrawer, busy, armed, loadingBlock } from '../ui.js';
import { SERVER_FEATURES } from '../server.js';
import { TRADE_SERVER } from '../env.js';
import { prospectState, loadProspects } from '../prospects.js';
import { groupState, loadGroups, groupById, groupOfCustomer, siteNameOf, createGroup, updateGroup, deleteGroup, addSite, renameSite, removeSite } from '../groups.js';

const FIRST = 10;
const ui = { showAll: false, groupId: null };

/** A group's centres with what we know about each. */
function sitesOf(g) {
  const cust = g.customers.map((m) => {
    const c = state.customers.get(m.customerId);
    return {
      kind: 'customer', key: m.customerId, customerId: m.customerId, c,
      site: m.siteName || (c ? label(c) : 'Customer not loaded'),
      account: c ? label(c) : m.customerId, email: c ? c.email : '', stage: c ? stageOf(c).stage : '',
      orders: c ? c.numberOfOrders : 0, spend: c ? c.amountSpent : 0, lastAt: c ? c.lastOrderAt : null,
    };
  });
  const pros = g.prospects.map((p) => ({ kind: 'prospect', key: `p${p.id}`, prospectId: p.id, site: p.siteName || p.company, account: p.company, email: p.email || '', stage: p.stage, orders: 0, spend: 0, lastAt: null }));
  return [...cust, ...pros].sort((a, b) => (b.orders - a.orders) || a.site.localeCompare(b.site));
}

const totals = (sites) => ({
  spend: sites.reduce((n, s) => n + (s.spend || 0), 0),
  orders: sites.reduce((n, s) => n + (s.orders || 0), 0),
  stocking: sites.filter((s) => s.orders > 0).length,
  lastAt: sites.map((s) => s.lastAt).filter(Boolean).sort().pop() || null,
});

function serverOnly(el, title) {
  el.innerHTML = String(html`<div class="page"><div class="page-head"><div><p class="eyebrow">Sales</p><h1 class="h1">${title}</h1></div></div>
    <div class="card"><p class="muted" style="margin:0">Groups are at <a href="${TRADE_SERVER}/#/groups" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p></div></div>`);
}

function ensureLoaded(el, again) {
  if (groupState.loaded) return true;
  el.innerHTML = String(html`<div class="page">${groupState.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${groupState.error}</div></div>` : loadingBlock('Loading groups…')}</div>`);
  if (!groupState.error) loadGroups().then(() => { if (el.isConnected) again(); });
  return false;
}

export function render(el, id) {
  if (!SERVER_FEATURES) { serverOnly(el, 'Groups'); return; }
  if (!ensureLoaded(el, () => render(el, id))) return;
  if (!prospectState.loaded && !prospectState.loading && !prospectState.error) loadProspects().then(() => { if (el.isConnected && location.hash.startsWith('#/groups')) render(el, id); });
  if (id) { renderGroup(el, Number(id)); return; }

  const list = groupState.list.map((g) => ({ g, sites: sitesOf(g) }));
  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Sales</p><h1 class="h1">Groups</h1>
          <p class="muted" style="margin:4px 0 0">Businesses with more than one centre. Each centre keeps its own account and orders; the group adds them up, and the agent can mention a sister site that already stocks us.</p></div>
        <div class="page-head__actions"><button class="btn" data-new>${icon('plus')}New group</button></div>
      </div>
      ${list.length ? html`<div class="card card--flush"><div class="table-wrap"><table class="table">
        <thead><tr><th>Group</th><th>Centres</th><th>Stocking us</th><th class="r">Orders</th><th class="r">Spend</th><th class="hide-sm">Last order</th></tr></thead>
        <tbody>${list.map(({ g, sites }) => { const t = totals(sites); return html`<tr data-href="#/groups/${g.id}" style="cursor:pointer">
          <td><a class="strong" href="#/groups/${g.id}">${g.name}</a><div class="small muted clip" style="max-width:320px">${sites.map((s) => s.site).join(' · ')}</div></td>
          <td>${sites.length}</td>
          <td>${t.stocking ? html`<span class="badge badge--cyan">${t.stocking} of ${sites.length}</span>` : html`<span class="muted small">None yet</span>`}</td>
          <td class="r">${t.orders}</td><td class="r">${money0(t.spend)}</td>
          <td class="hide-sm">${t.lastAt ? ago(t.lastAt) : '—'}</td></tr>`; })}</tbody>
      </table></div></div>`
      : html`<section class="card empty">${icon('building-2')}<strong class="strong">No groups yet</strong><span>Make one for a business with several centres, then add each centre to it.</span></section>`}
    </div>`);
  el.querySelector('[data-new]').addEventListener('click', () => openGroupEditor(null, (r) => { location.hash = `#/groups/${r.id}`; }));
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
}

function renderGroup(el, id) {
  const g = groupById(id);
  if (!g) {
    el.innerHTML = String(html`<div class="page"><a class="back" href="#/groups">${icon('arrow-left', 'i--sm')}Groups</a><div class="card empty">${icon('building-2')}<span>That group doesn't exist any more.</span></div></div>`);
    return;
  }
  if (ui.groupId !== id) Object.assign(ui, { groupId: id, showAll: false });
  const sites = sitesOf(g);
  const t = totals(sites);
  const siteOf = new Map(sites.filter((s) => s.c).map((s) => [s.c.numericId, s.site]));
  const orders = sites.filter((s) => s.c).flatMap((s) => (state.ordersByCustomer.get(s.c.numericId) || []).map((o) => ({ ...o, site: s.site, numericId: s.c.numericId })))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const shown = ui.showAll ? orders : orders.slice(0, FIRST);

  el.innerHTML = String(html`
    <div class="page">
      <a class="back" href="#/groups">${icon('arrow-left', 'i--sm')}Groups</a>
      <div class="page-head">
        <div style="min-width:0"><p class="eyebrow">Group · ${sites.length} centre${sites.length === 1 ? '' : 's'}</p><h1 class="h1">${g.name}</h1>
          ${g.notes ? html`<p class="muted" style="margin:6px 0 0;white-space:pre-line">${g.notes}</p>` : ''}</div>
        <div class="page-head__actions row row--wrap">
          <button class="btn btn--outline btn--sm" data-edit>${icon('pencil', 'i--sm')}Rename or notes</button>
          <button class="btn btn--sm" data-add>${icon('plus', 'i--sm')}Add a centre</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat__label">Combined spend</span><span class="stat__value">${money0(t.spend)}</span><span class="stat__sub">All centres, lifetime</span></div>
        <div class="stat"><span class="stat__label">Orders</span><span class="stat__value">${t.orders}</span><span class="stat__sub">Across all centres</span></div>
        <div class="stat"><span class="stat__label">Stocking us</span><span class="stat__value">${t.stocking} of ${sites.length}</span><span class="stat__sub">${t.stocking && t.stocking < sites.length ? 'The rest are the next to win' : t.stocking ? 'Every centre' : 'None yet'}</span></div>
        <div class="stat"><span class="stat__label">Last order</span><span class="stat__value">${t.lastAt ? fmtDate(t.lastAt) : '—'}</span><span class="stat__sub">${t.lastAt ? ago(t.lastAt) : 'Never ordered'}</span></div>
      </div>

      <section class="card card--flush">
        <div class="card__head" style="padding:16px 20px 0"><h2 class="h2">Centres</h2><span class="muted small">Each orders and is emailed on its own</span></div>
        ${sites.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
          <thead><tr><th>Centre</th><th class="hide-sm">Email</th><th>Stage</th><th class="r">Orders</th><th class="r hide-sm">Spend</th><th class="hide-sm">Last order</th><th></th></tr></thead>
          <tbody>${sites.map((s) => html`<tr>
            <td>${s.c ? html`<a class="strong" href="#/customers/${s.c.numericId}">${s.site}</a>` : html`<span class="strong">${s.site}</span>`}
              <div class="small muted">${s.kind === 'prospect' ? html`<span class="badge" title="Not in Shopify until they reply">Prospect</span> ` : ''}${s.site !== s.account ? s.account : ''}</div></td>
            <td class="small hide-sm">${s.email || html`<span class="muted">No email</span>`}</td>
            <td class="small">${s.stage || '—'}</td>
            <td class="r">${s.orders}</td>
            <td class="r hide-sm">${s.spend ? money0(s.spend) : '—'}</td>
            <td class="small hide-sm">${s.lastAt ? ago(s.lastAt) : '—'}</td>
            <td class="nowrap r"><button class="btn btn--ghost btn--sm" data-rename="${s.key}" aria-label="Rename ${s.site}">${icon('pencil', 'i--sm')}</button><button class="btn btn--ghost btn--sm" data-unlink="${s.key}" aria-label="Take ${s.site} out of the group">${icon('unlink', 'i--sm')}</button></td>
          </tr>`)}</tbody></table></div>`
          : html`<div class="empty">${icon('building-2')}<span>No centres yet. Add each of their centres, as a customer or a prospect.</span></div>`}
      </section>

      <section class="card card--flush">
        <div class="card__head" style="padding:16px 20px 0"><h2 class="h2">Orders from every centre</h2><span class="muted small">${orders.length > FIRST && !ui.showAll ? `Latest ${FIRST} of ${orders.length}` : `${orders.length} order${orders.length === 1 ? '' : 's'}`}</span></div>
        ${orders.length ? html`<div class="table-wrap" style="margin-top:6px"><table class="table">
          <thead><tr><th>Order</th><th>Centre</th><th>Date</th><th class="hide-sm">Items</th><th class="r">Total</th></tr></thead>
          <tbody>${shown.map((o) => html`<tr>
            <td class="nowrap"><span class="strong">${o.name}</span> ${o.x ? html`<span class="badge">Cancelled</span>` : ''}</td>
            <td><a href="#/customers/${o.numericId}">${siteOf.get(o.numericId)}</a></td>
            <td class="nowrap">${fmtDate(o.at)}</td>
            <td class="hide-sm clip" style="max-width:220px">${orderSummary(o)}</td>
            <td class="r">${money(o.total)}</td></tr>`)}</tbody></table></div>
          ${orders.length > FIRST ? html`<div style="padding:10px 16px 14px"><button class="btn btn--ghost btn--sm" data-more>${ui.showAll ? `Show the latest ${FIRST}` : `View all ${orders.length} orders`}</button></div>` : ''}`
          : html`<div class="empty">${icon('receipt')}<span>No orders from these centres in the synced history.</span></div>`}
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">Delete group</h2></div>
        <p class="muted small" style="margin:0 0 10px">Deletes the group only. Every centre keeps its account, emails and orders.</p>
        <button class="btn btn--danger btn--ghost btn--sm" data-delete>${icon('trash-2', 'i--sm')}Delete ${g.name}</button>
      </section>
    </div>`);

  const again = () => render(el, id);
  const ref = (key) => (key.startsWith('p') ? { prospectId: Number(key.slice(1)) } : { customerId: key });
  el.querySelector('[data-edit]').addEventListener('click', () => openGroupEditor(g, again));
  el.querySelector('[data-add]').addEventListener('click', () => openAddSite(g, again));
  const more = el.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { ui.showAll = !ui.showAll; again(); });
  el.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => {
    const s = sites.find((x) => x.key === b.dataset.rename);
    openRename(s, ref(s.key), again);
  }));
  el.querySelectorAll('[data-unlink]').forEach((b) => armed(b, () => busy(b, () => removeSite(ref(b.dataset.unlink)))
    .then(() => { toast('Taken out of the group'); again(); }).catch(() => {}), 'Remove?'));
  const del = el.querySelector('[data-delete]');
  armed(del, () => busy(del, () => deleteGroup(g.id)).then(() => { toast(`${g.name} deleted`); location.hash = '#/groups'; }).catch(() => {}), 'Click again to delete the group');
}

export function openGroupEditor(g, done) {
  openDrawer({
    eyebrow: 'Groups', title: g ? `Edit ${g.name}` : 'New group',
    body: html`<div class="form">
      <label class="field"><span>Group name</span><input class="input" data-name value="${g ? g.name : ''}" placeholder="e.g. The Climbing Academy"></label>
      <label class="field"><span>Notes (optional)</span><textarea class="textarea" data-notes placeholder="Who buys for the group, head office, how they like to order…">${g ? g.notes : ''}</textarea></label>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}${g ? 'Save' : 'Create group'}</button>`,
    onMount(d) {
      d.$('[data-name]').focus();
      d.$('[data-save]').addEventListener('click', (e) => {
        const name = d.$('[data-name]').value.trim();
        const notes = d.$('[data-notes]').value.trim();
        if (!name) { toast('Give the group a name', 'err'); return; }
        busy(e.currentTarget, () => (g ? updateGroup(g.id, { name, notes }) : createGroup(name, notes)))
          .then((r) => { toast(g ? 'Saved' : `${name} created`); d.close(); done(r || g); }).catch(() => {});
      });
    },
  });
}

function openRename(s, ref, done) {
  openDrawer({
    eyebrow: s.account, title: 'Centre name',
    body: html`<div class="form"><label class="field"><span>What to call this centre in the group</span><input class="input" data-site value="${s.site}" placeholder="e.g. TCA Bristol (The Arc)">
      <span class="muted small">Used on the group page and when the agent mentions it to a sister site.</span></label></div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save</button>`,
    onMount(d) {
      d.$('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, () => renameSite({ ...ref, siteName: d.$('[data-site]').value.trim() }))
        .then(() => { toast('Saved'); d.close(); done(); }).catch(() => {}));
    },
  });
}

/** Search customers and prospects to add as a centre of this group. */
function openAddSite(g, done) {
  const inGroup = new Set([...g.customers.map((c) => c.customerId), ...g.prospects.map((p) => `p${p.id}`)]);
  const pool = [
    ...[...state.customers.values()].map((c) => ({ key: c.id, ref: { customerId: c.id }, name: label(c), sub: [c.email, c.city].filter(Boolean).join(' · '), kind: 'Customer', other: groupOfCustomer(c.id) })),
    ...prospectState.items.filter((p) => !p.customer_id).map((p) => ({ key: `p${p.id}`, ref: { prospectId: p.id }, name: p.company, sub: [p.email, p.city].filter(Boolean).join(' · '), kind: 'Prospect', other: p.group_id ? groupById(p.group_id) : null })),
  ].filter((x) => !inGroup.has(x.key));
  const word = g.name.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !['the', 'climbing', 'centre', 'bouldering'].includes(w))[0] || '';
  openDrawer({
    eyebrow: g.name, title: 'Add a centre', wide: true,
    body: html`<div class="form">
      <input class="input" type="search" data-q placeholder="Search by name, email or town" value="${word}">
      <div class="list" data-results></div>
    </div>`,
    foot: html`<button class="btn" data-close>Done</button>`,
    onMount(d) {
      const q = d.$('[data-q]');
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const hits = pool.filter((x) => !term || [x.name, x.sub].some((v) => String(v).toLowerCase().includes(term))).slice(0, 40);
        d.$('[data-results]').innerHTML = String(hits.length ? html`${hits.map((x) => html`<div class="list__item">
          <span class="list__main"><span class="strong">${x.name}</span><span class="small muted">${x.kind}${x.sub ? ` · ${x.sub}` : ''}${x.other ? ` · in ${x.other.name}` : ''}</span></span>
          <button class="btn btn--sm ${inGroup.has(x.key) ? 'btn--ghost' : ''}" data-pick="${x.key}" ${inGroup.has(x.key) ? raw('disabled') : ''}>${inGroup.has(x.key) ? 'Added' : x.other ? 'Move here' : 'Add'}</button></div>`)}`
          : html`<p class="muted small" style="margin:8px 0">No customers or prospects match.</p>`);
        d.$$('[data-pick]').forEach((b) => b.addEventListener('click', () => {
          const x = pool.find((y) => y.key === b.dataset.pick);
          busy(b, () => addSite(g.id, x.ref)).then(() => { inGroup.add(x.key); toast(`${x.name} added`); draw(); done(); }).catch(() => {});
        }));
      };
      q.addEventListener('input', draw);
      draw();
      q.focus();
    },
  });
}

// ---- The group card on a customer's page ----------------------------------

export const groupCardShell = () => (SERVER_FEATURES ? html`<section class="card" data-group-card><div class="card__head"><h2 class="h2">Group</h2></div><p class="muted small" style="margin:0">Loading…</p></section>` : '');

export function mountGroupCard(box, c) {
  if (!box) return;
  const draw = () => {
    if (!box.isConnected) return;
    const g = groupOfCustomer(c.id);
    if (!g) {
      box.innerHTML = String(html`<div class="card__head"><h2 class="h2">Group</h2></div>
        <p class="muted small" style="margin:0 0 10px">Part of a business with other centres? Put them in a group: each centre keeps its own account and orders, and the agent can mention the ones already stocking us.</p>
        <button class="btn btn--outline btn--sm" data-join>${icon('building-2', 'i--sm')}Add to a group</button>`);
      box.querySelector('[data-join]').addEventListener('click', () => openJoin(c, draw));
      return;
    }
    const sites = sitesOf(g).filter((s) => s.customerId !== c.id);
    const t = totals(sitesOf(g));
    box.innerHTML = String(html`<div class="card__head"><h2 class="h2">Group</h2><a class="small" href="#/groups/${g.id}">Open</a></div>
      <p style="margin:0 0 4px"><a class="strong" href="#/groups/${g.id}">${g.name}</a></p>
      <p class="muted small" style="margin:0 0 10px">${siteNameOf(g, { customerId: c.id }) ? `This centre: ${siteNameOf(g, { customerId: c.id })} · ` : ''}${t.stocking} of ${sitesOf(g).length} centres stock us · ${money0(t.spend)} combined</p>
      ${sites.length ? html`<div class="list">${sites.slice(0, 6).map((s) => html`<div class="list__item"><span class="list__main">
        ${s.c ? html`<a class="strong" href="#/customers/${s.c.numericId}">${s.site}</a>` : html`<span class="strong">${s.site}</span>`}
        <span class="small muted">${s.orders ? `${s.orders} order${s.orders === 1 ? '' : 's'}${s.lastAt ? `, last ${ago(s.lastAt)}` : ''}` : s.stage || 'Prospect'}</span></span></div>`)}</div>` : ''}`);
  };
  loadGroups().then(draw);
  draw();
}

function openJoin(c, done) {
  const groups = groupState.list;
  openDrawer({
    eyebrow: label(c), title: 'Add to a group',
    body: html`<div class="form">
      <label class="field"><span>Group</span><select class="select" data-group>
        ${groups.map((g) => html`<option value="${g.id}">${g.name}</option>`)}<option value="new" ${groups.length ? '' : raw('selected')}>New group…</option></select></label>
      <label class="field" data-newwrap ${groups.length ? raw('hidden') : ''}><span>New group name</span><input class="input" data-newname placeholder="e.g. The Climbing Academy"></label>
      <label class="field"><span>This centre's name in the group (optional)</span><input class="input" data-site value="${label(c)}"></label>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Add</button>`,
    onMount(d) {
      const sel = d.$('[data-group]');
      sel.addEventListener('change', () => { d.$('[data-newwrap]').hidden = sel.value !== 'new'; });
      d.$('[data-save]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        let id = sel.value;
        if (id === 'new') {
          const name = d.$('[data-newname]').value.trim();
          if (!name) throw new Error('Give the new group a name');
          id = (await createGroup(name)).id;
        }
        await addSite(Number(id), { customerId: c.id, siteName: d.$('[data-site]').value.trim() });
      }).then(() => { toast('Added to the group'); d.close(); done(); }).catch(() => {}));
    },
  });
}
