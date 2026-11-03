// Prospects: the outreach list. Import the prospects CSV (from the Notion
// clean-up spreadsheet), fix missing emails, then draft intros in bulk.
// Every draft waits in the Outbox for approval, so nothing goes out from here.
import { html, raw, icon, ago, toast, openDrawer, busy, armed, loadingBlock } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { prospectState, loadProspects, updateProspect } from '../prospects.js';
import { TRADE_SERVER } from '../env.js';
import { groupState, loadGroups, groupById, createGroup, addSite, removeSite } from '../groups.js';

const ui = { q: '', filter: 'ready', selected: new Set() };
const FILTERS = [
  ['ready', 'Ready to email'],
  ['no-email', 'Needs an email'],
  ['contacted', 'Contacted'],
  ['closed', 'Not now / Lost'],
  ['all', 'All'],
];

function matches(p) {
  const q = ui.q.trim().toLowerCase();
  if (q && ![p.company, p.contact, p.email, p.city, p.group_id && (groupById(p.group_id) || {}).name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
  switch (ui.filter) {
    case 'ready': return !!p.email && !p.opt_out && p.stage === 'Prospect' && !p.waiting;
    case 'no-email': return !p.email && !['Lost'].includes(p.stage);
    case 'contacted': return p.stage === 'Contacted';
    case 'closed': return ['Not now', 'Lost'].includes(p.stage);
    default: return true;
  }
}

export function render(el) {
  if (!SERVER_FEATURES) {
    el.innerHTML = String(html`<div class="page"><div class="page-head"><div><p class="eyebrow">Sales</p><h1 class="h1">Prospects</h1></div></div>
      <div class="card"><p class="muted" style="margin:0">Prospects and outreach are at <a href="${TRADE_SERVER}/#/prospects" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p></div></div>`);
    return;
  }
  if (!groupState.loaded && !groupState.loading && !groupState.error) loadGroups().then(() => { if (el.isConnected && location.hash.startsWith('#/prospects')) render(el); });
  if (!prospectState.loaded) {
    el.innerHTML = String(html`<div class="page">${prospectState.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${prospectState.error}</div></div>` : loadingBlock('Loading prospects…')}</div>`);
    if (!prospectState.error) loadProspects().then(() => { if (location.hash.startsWith('#/prospects')) render(el); });
    return;
  }
  const all = prospectState.items;
  const list = all.filter(matches);
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter((p) => { const f = ui.filter; ui.filter = k; const m = matches(p); ui.filter = f; return m; }).length]));
  [...ui.selected].forEach((id) => { if (!list.some((p) => p.id === id)) ui.selected.delete(id); });
  const pickable = list.filter((p) => p.email && !p.opt_out);

  el.innerHTML = String(html`
    <div class="page page--wide">
      <div class="page-head">
        <div><p class="eyebrow">Sales</p><h1 class="h1">Prospects</h1>
          <p class="muted" style="margin:4px 0 0">Gyms and shops to contact. They move to Customers the moment they reply.</p></div>
        <div class="page-head__actions row row--wrap">
          <label class="btn btn--outline">${icon('file-up')}Import CSV<input type="file" accept=".csv,text/csv" data-file hidden></label>
          <button class="btn" data-draft ${ui.selected.size ? '' : raw('disabled')}>${icon('pencil')}Draft emails${ui.selected.size ? ` (${ui.selected.size})` : ''}</button>
        </div>
      </div>
      ${!all.length ? html`<div class="card empty">${icon('target')}<span>No prospects yet. Import <strong>prospects_import.csv</strong> (columns: company, contact, email, phone, city, website, source, notion_url, template, priority).</span></div>` : html`
      <div class="row row--wrap" style="gap:6px;margin-bottom:12px">
        ${FILTERS.map(([k, name]) => html`<button class="btn btn--sm ${ui.filter === k ? '' : 'btn--ghost'}" data-filter="${k}">${name} <span class="muted">${counts[k]}</span></button>`)}
        <input class="input input--sm" type="search" placeholder="Search" value="${ui.q}" data-q aria-label="Search prospects" style="width:200px;margin-left:auto">
      </div>
      <div class="card card--flush"><div class="table-wrap"><table class="table">
        <thead><tr>
          <th style="width:36px"><input type="checkbox" data-all aria-label="Select all" ${pickable.length && pickable.every((p) => ui.selected.has(p.id)) ? raw('checked') : ''}></th>
          <th>Company</th><th>Email</th><th>Town</th><th>Template</th><th>Priority</th><th>Stage</th><th></th></tr></thead>
        <tbody>${list.slice(0, 400).map((p) => html`<tr>
          <td>${p.email && !p.opt_out ? html`<input type="checkbox" data-sel="${p.id}" aria-label="Select ${p.company}" ${ui.selected.has(p.id) ? raw('checked') : ''}>` : ''}</td>
          <td><div class="strong">${p.company}</div><div class="small muted">${p.group_id && groupById(p.group_id) ? html`<a href="#/groups/${p.group_id}" title="Part of a group">${icon('building-2', 'i--sm')}${groupById(p.group_id).name}</a>${p.contact || p.notion_url ? ' · ' : ''}` : ''}${p.contact || ''}${p.contact && p.notion_url ? ' · ' : ''}${p.notion_url ? html`<a href="${p.notion_url}" target="_blank" rel="noopener">Notion</a>` : ''}</div></td>
          <td class="small">${p.email || html`<span class="status status--due">No email</span>`}</td>
          <td class="small">${p.city || ''}</td>
          <td class="small">${p.template === 'reintro' ? 'Re-introduction' : 'Intro'}</td>
          <td class="small muted">${p.priority || ''}</td>
          <td class="small">${p.stage}${p.waiting ? html` <span class="badge badge--cyan" title="Draft waiting in the outbox">In outbox</span>` : ''}${p.last_contacted ? html`<div class="muted">${ago(p.last_contacted)}</div>` : ''}</td>
          <td><button class="btn btn--ghost btn--sm" data-edit="${p.id}">${icon('pencil', 'i--sm')}Edit</button></td></tr>`)}</tbody>
      </table></div>${list.length > 400 ? html`<p class="muted small" style="padding:12px 16px;margin:0">Showing 400 of ${list.length}. Search to narrow it down.</p>` : ''}</div>`}
    </div>`);

  el.querySelector('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await serverApi('/api/prospects/import', { method: 'POST', body: { csv: await file.text() } });
      toast(`${r.added} added, ${r.updated} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
      if (r.skipped.length) showSkipped(r.skipped);
      await loadProspects({ force: true });
      render(el);
    } catch (err) { toast(err.message, 'err'); }
  });
  el.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { ui.filter = b.dataset.filter; render(el); }));
  const q = el.querySelector('[data-q]');
  if (q) q.addEventListener('input', () => {
    ui.q = q.value; const pos = q.selectionStart; render(el);
    const again = el.querySelector('[data-q]'); again.focus(); again.setSelectionRange(pos, pos);
  });
  el.querySelectorAll('[data-sel]').forEach((cb) => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.sel);
    if (cb.checked) ui.selected.add(id); else ui.selected.delete(id);
    render(el);
  }));
  const allBox = el.querySelector('[data-all]');
  if (allBox) allBox.addEventListener('change', () => {
    pickable.slice(0, 50).forEach((p) => (allBox.checked ? ui.selected.add(p.id) : ui.selected.delete(p.id)));
    if (allBox.checked && pickable.length > 50) toast('Selected the first 50: drafts go out in batches of 50');
    render(el);
  });
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(all.find((p) => p.id === Number(b.dataset.edit)), () => render(el))));
  const draft = el.querySelector('[data-draft]');
  draft.addEventListener('click', () => busy(draft, () => serverApi('/api/prospects/draft', { method: 'POST', body: { ids: [...ui.selected].slice(0, 50) } }))
    .then(async (r) => {
      toast(`${r.drafted} draft${r.drafted === 1 ? '' : 's'} added to the outbox for approval${r.failed.length ? `; ${r.failed.length} couldn't be drafted` : ''}`, r.failed.length ? 'err' : '');
      if (r.failed.length) showSkipped(r.failed.map((f) => ({ company: (prospectState.items.find((p) => p.id === f.id) || {}).company || f.id, reason: f.reason })), 'Not drafted');
      ui.selected.clear();
      window.dispatchEvent(new Event('outbox-changed'));
      await loadProspects({ force: true });
      render(el);
    }).catch(() => {}));
}

function showSkipped(rows, title = 'Skipped') {
  openDrawer({
    title, eyebrow: 'Prospects',
    body: html`<div class="list">${rows.map((r) => html`<div class="list__item"><span class="list__main"><span class="strong">${r.company}</span><span class="small muted">${r.reason}</span></span></div>`)}</div>`,
    foot: html`<button class="btn" data-close>Done</button>`,
  });
}

function openEdit(p, done) {
  if (!p) return;
  const f = (key, name, value, type = 'text') => html`<label class="field"><span>${name}</span><input class="input" type="${type}" data-p="${key}" value="${value || ''}"></label>`;
  openDrawer({
    title: p.company, eyebrow: 'Prospect',
    body: html`<div class="form">
      ${f('company', 'Company', p.company)}
      <div class="form-row">${f('contact', 'Contact name', p.contact)}${f('email', 'Email', p.email, 'email')}</div>
      <div class="form-row">${f('phone', 'Phone', p.phone)}${f('city', 'Town', p.city)}</div>
      ${f('website', 'Website', p.website)}
      <div class="form-row">
        <label class="field"><span>First email</span><select class="select" data-p="template">
          <option value="intro" ${p.template !== 'reintro' ? raw('selected') : ''}>Intro and free samples</option>
          <option value="reintro" ${p.template === 'reintro' ? raw('selected') : ''}>Re-introduction (spoke before)</option></select></label>
        <label class="field"><span>Stage</span><select class="select" data-p="stage">${['Prospect', 'Contacted', 'Not now', 'Lost'].map((s) => html`<option ${s === p.stage ? raw('selected') : ''}>${s}</option>`)}</select></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Group (business with several centres)</span><select class="select" data-group>
          <option value="">Not in a group</option>${groupState.list.map((g) => html`<option value="${g.id}" ${Number(p.group_id) === g.id ? raw('selected') : ''}>${g.name}</option>`)}<option value="new">New group…</option></select></label>
        <label class="field"><span>Centre name in the group</span><input class="input" data-site value="${p.site_name || ''}" placeholder="${p.company}"></label>
      </div>
      <label class="field" data-newwrap hidden><span>New group name</span><input class="input" data-newname placeholder="e.g. The Climbing Academy"></label>
      <label class="field"><span>Notes</span><textarea class="textarea" data-p="notes">${p.notes || ''}</textarea></label>
      ${p.opt_out ? html`<div class="notice notice--warn">${icon('circle-alert')}<div>Opted out of email. Nothing will be sent to them.</div></div>` : ''}
    </div>`,
    foot: html`<button class="btn btn--ghost" data-merge>${icon('merge', 'i--sm')}Merge with…</button><button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save</button>`,
    onMount: (d) => {
      const sel = d.$('[data-group]');
      sel.addEventListener('change', () => { d.$('[data-newwrap]').hidden = sel.value !== 'new'; });
      d.$('[data-merge]').addEventListener('click', () => { d.close(); openMergeProspect(p, done); });
      d.$('[data-save]').addEventListener('click', (e) => {
        const patch = Object.fromEntries(d.$$('[data-p]').map((i) => [i.dataset.p, i.value.trim()]));
        if (!patch.email) delete patch.email;
        const site = d.$('[data-site]').value.trim();
        busy(e.currentTarget, async () => {
          await updateProspect(p.id, patch);
          let gid = sel.value;
          if (gid === 'new') {
            const name = d.$('[data-newname]').value.trim();
            if (!name) throw new Error('Give the new group a name');
            gid = String((await createGroup(name)).id);
          }
          if (gid && (Number(gid) !== Number(p.group_id) || site !== (p.site_name || ''))) await addSite(Number(gid), { prospectId: p.id, siteName: site });
          else if (!gid && p.group_id) await removeSite({ prospectId: p.id });
          if (gid !== String(p.group_id || '') || site !== (p.site_name || '')) await loadProspects({ force: true });
        }).then(() => { toast('Saved'); d.close(); done(); }).catch(() => {});
      });
    },
  });
}

/** Two prospects for the same centre: this one stays, the other's email becomes an extra address on it. */
function openMergeProspect(p, done) {
  const others = prospectState.items.filter((x) => x.id !== p.id && !x.customer_id);
  const domain = String(p.email || '').split('@')[1] || '';
  openDrawer({
    eyebrow: p.company, title: 'Merge with another prospect', wide: true,
    body: html`<div class="form">
      <p class="muted small" style="margin:0">For the same centre listed twice. <strong>${p.company}</strong>${p.email ? ` (${p.email})` : ''} stays, with its email as the main one. The other prospect's email becomes an extra address here (so replies from it still land here), and its emails, notes and details move across. Different centres of one business belong in a group instead.</p>
      <input class="input" type="search" data-q placeholder="Search prospects" value="${domain && !/^(gmail|hotmail|outlook|yahoo|icloud|btinternet)\./.test(domain) ? domain : p.company.split(/\s+/)[0]}">
      <div class="list" data-results></div>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button>`,
    onMount(d) {
      const q = d.$('[data-q]');
      const draw = () => {
        const term = q.value.trim().toLowerCase();
        const hits = others.filter((x) => !term || [x.company, x.email, x.city].some((v) => String(v || '').toLowerCase().includes(term))).slice(0, 30);
        d.$('[data-results]').innerHTML = String(hits.length ? html`${hits.map((x) => html`<div class="list__item">
          <span class="list__main"><span class="strong">${x.company}</span><span class="small muted">${[x.email || 'No email', x.stage, x.city].filter(Boolean).join(' · ')}</span></span>
          <button class="btn btn--sm btn--outline" data-pick="${x.id}">Merge into ${p.company}</button></div>`)}` : html`<p class="muted small" style="margin:8px 0">No prospects match.</p>`);
        d.$$('[data-pick]').forEach((b) => armed(b, () => busy(b, () => serverApi('/api/prospects/merge', { method: 'POST', body: { keepId: p.id, mergeId: Number(b.dataset.pick) } }))
          .then(async () => { toast('Merged'); d.close(); await loadProspects({ force: true }); done(); }).catch(() => {}), 'Click again to merge'));
      };
      q.addEventListener('input', draw);
      draw();
    },
  });
}
