// "Email addresses" on a customer's page: the main email (the Shopify one,
// used for signing in and for our emails), plus secondary and finance
// addresses. Replies from any of them land on this account. Also where two
// accounts (or a prospect and an account) are merged. Editing needs the
// trade server, so inside Shopify admin this card is read-only.
import { html, raw, icon, toast, openDrawer, busy, armed, loadingBlock } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { state, label, refreshCustomer, numericId } from '../store.js';
import { prospectState, loadProspects } from '../prospects.js';
import { TRADE_SERVER } from '../env.js';

const ROLES = [['secondary', 'Secondary'], ['finance', 'Finance / accounts']];

export function emailsCardShell() {
  return html`<section class="card" data-emails-card><div class="card__head"><h2 class="h2">Email addresses</h2></div><div data-emails-body>${SERVER_FEATURES ? loadingBlock('Loading emails…') : ''}</div></section>`;
}

export async function mountEmailsCard(card, c) {
  if (!card) return;
  const body = card.querySelector('[data-emails-body]');
  if (!SERVER_FEATURES) {
    const extra = Array.isArray(c.crm.profile.emails) ? c.crm.profile.emails : [];
    body.innerHTML = String(html`<div class="list">
      <div class="list__item"><span class="list__main"><span class="strong">${c.email || 'No main email'}</span><span class="small muted">Main</span></span></div>
      ${extra.map((x) => html`<div class="list__item"><span class="list__main"><span class="strong">${x.email}</span><span class="small muted">${x.role === 'finance' ? 'Finance / accounts' : 'Secondary'}</span></span></div>`)}</div>
      <p class="muted small" style="margin:10px 0 0">Edit emails and merge accounts at <a href="${TRADE_SERVER}/#/customers/${c.numericId}" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p>`);
    return;
  }
  let data;
  try { data = await serverApi(`/api/accounts/${c.numericId}/emails`); } catch (err) {
    body.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${err.message}</div></div>`);
    return;
  }
  if (!card.isConnected) return;
  const rows = data.others.map((x) => ({ ...x }));

  const paint = () => {
    body.innerHTML = String(html`<div class="form">
      <label class="field"><span>Main email <span class="muted small">(sign-in, and where our emails go)</span></span><input class="input" type="email" data-main value="${data.primary || ''}"></label>
      ${rows.map((r, i) => html`<div class="row" style="gap:6px;align-items:flex-end">
        <label class="field" style="flex:1;min-width:0"><span>${i === 0 ? 'Other emails' : html`<span class="visually-hidden">Email</span>`}</span><input class="input" type="email" data-oe="${i}" value="${r.email}" placeholder="name@gym.co.uk"></label>
        <select class="select" data-or="${i}" style="width:auto" aria-label="Type">${ROLES.map(([k, l]) => html`<option value="${k}" ${r.role === k ? raw('selected') : ''}>${l}</option>`)}</select>
        <button type="button" class="btn btn--ghost btn--icon" data-rm="${i}" aria-label="Remove ${r.email}">${icon('x', 'i--sm')}</button></div>`)}
      <div class="row row--wrap" style="gap:6px">
        <button type="button" class="btn btn--outline btn--sm" data-add>${icon('plus', 'i--sm')}Add an email</button>
        <button type="button" class="btn btn--sm" data-save>${icon('check', 'i--sm')}Save emails</button>
      </div>
      <p class="muted small" style="margin:0">Replies from any of these land on this account. Finance is who invoices go to.</p>
      <hr style="border:0;border-top:1px solid var(--border-subtle);margin:4px 0">
      <button type="button" class="btn btn--ghost btn--sm" data-merge style="justify-self:start">${icon('merge', 'i--sm')}Merge with another account or prospect</button>
    </div>`);
    const sync = () => body.querySelectorAll('[data-oe]').forEach((inp) => { rows[Number(inp.dataset.oe)].email = inp.value; });
    body.querySelectorAll('[data-or]').forEach((s) => s.addEventListener('change', () => { rows[Number(s.dataset.or)].role = s.value; }));
    body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { sync(); rows.splice(Number(b.dataset.rm), 1); paint(); }));
    body.querySelector('[data-add]').addEventListener('click', () => { sync(); rows.push({ email: '', role: 'secondary' }); paint(); body.querySelector(`[data-oe="${rows.length - 1}"]`).focus(); });
    body.querySelector('[data-save]').addEventListener('click', (e) => {
      sync();
      const payload = { primary: body.querySelector('[data-main]').value.trim(), others: rows.filter((r) => r.email.trim()) };
      busy(e.currentTarget, () => serverApi(`/api/accounts/${c.numericId}/emails`, { method: 'POST', body: payload }))
        .then((r) => { data = r; rows.splice(0, rows.length, ...r.others.map((x) => ({ ...x }))); toast('Emails saved'); paint(); return refreshCustomer(c.id); })
        .catch(() => {});
    });
    body.querySelector('[data-merge]').addEventListener('click', () => openMerge(c, data));
  };
  paint();
}

function openMerge(c, data) {
  const pick = { kind: null, item: null, preview: null };
  openDrawer({
    title: `Merge into ${label(c)}`, eyebrow: 'Duplicate accounts', wide: true,
    body: html`<div class="form">
      <label class="field"><span>Find the other account or prospect</span><input class="input" type="search" data-find placeholder="Name, company or email" autocomplete="off"></label>
      <div data-results></div>
      <div data-picked></div>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-go disabled>${icon('merge', 'i--sm')}Merge</button>`,
    onMount: (d) => {
      if (!prospectState.loaded) loadProspects();
      const results = d.$('[data-results]');
      const picked = d.$('[data-picked]');
      const go = d.$('[data-go]');
      const search = () => {
        const term = d.$('[data-find]').value.trim().toLowerCase();
        if (term.length < 2) { results.innerHTML = ''; return; }
        const has = (...v) => v.some((x) => String(x || '').toLowerCase().includes(term));
        const cs = [...state.customers.values()].filter((x) => x.id !== c.id && has(label(x), x.name, x.email, x.city)).slice(0, 6);
        const ps = prospectState.items.filter((p) => has(p.company, p.contact, p.email, p.city)).slice(0, 6);
        results.innerHTML = String(html`<div class="list">${cs.map((x) => html`<button type="button" class="list__item kb-item" data-pc="${x.id}"><span class="list__main"><span class="strong">${label(x)}</span><span class="small muted">${x.email || 'no email'} · ${x.numberOfOrders} order${x.numberOfOrders === 1 ? '' : 's'}</span></span><span class="badge">Account</span></button>`)}
          ${ps.map((p) => html`<button type="button" class="list__item kb-item" data-pp="${p.id}"><span class="list__main"><span class="strong">${p.company}</span><span class="small muted">${p.email || 'no email'} · ${p.stage}</span></span><span class="badge">Prospect</span></button>`)}
          ${!cs.length && !ps.length ? html`<p class="muted small" style="margin:0">Nothing matches.</p>` : ''}</div>`);
        results.querySelectorAll('[data-pc]').forEach((b) => b.addEventListener('click', () => chooseCustomer(state.customers.get(b.dataset.pc))));
        results.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', () => chooseProspect(prospectState.items.find((p) => String(p.id) === b.dataset.pp))));
      };
      d.$('[data-find]').addEventListener('input', search);

      const chooseCustomer = async (x) => {
        Object.assign(pick, { kind: 'customer', item: x, preview: null });
        results.innerHTML = '';
        picked.innerHTML = String(loadingBlock('Asking Shopify…'));
        go.disabled = true;
        try { pick.preview = await serverApi('/api/accounts/merge/preview', { method: 'POST', body: { keepId: c.id, mergeId: x.id } }); } catch (err) { picked.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${err.message}</div></div>`); return; }
        const p = pick.preview;
        const choices = [...new Set([p.keep.email, p.merge.email].filter(Boolean))];
        picked.innerHTML = String(html`
          <div class="list">
            <div class="list__item"><span class="list__main"><span class="strong">${p.keep.name}</span><span class="small muted">${p.keep.email || 'no email'} · ${p.keep.orders} orders</span></span><span class="badge badge--cyan">This account</span></div>
            <div class="list__item"><span class="list__main"><span class="strong">${p.merge.name}</span><span class="small muted">${p.merge.email || 'no email'} · ${p.merge.orders} orders</span></span><span class="badge">Merging in</span></div>
          </div>
          ${choices.length ? html`<fieldset class="field" style="border:0;padding:0;margin:8px 0 0"><span>Main email for the merged account</span>
            ${choices.map((e, i) => html`<label class="check"><input type="radio" name="primary" value="${e}" ${i === 0 ? raw('checked') : ''}><span>${e}</span></label>`)}</fieldset>` : ''}
          <p class="muted small" style="margin:8px 0 0">Shopify moves all orders onto one customer and keeps tags from both. Timelines, email threads and samples are combined, the further-along pipeline stage is kept, and the other email stays on as a secondary address. This can't be undone.</p>
          ${p.errors.length ? html`<div class="notice notice--err">${icon('circle-alert')}<div><strong>Shopify won't merge these yet:</strong><br>${p.errors.join('<br>')}</div></div>` : ''}`);
        go.disabled = p.errors.length > 0;
      };

      const chooseProspect = (p) => {
        Object.assign(pick, { kind: 'prospect', item: p, preview: null });
        results.innerHTML = '';
        picked.innerHTML = String(html`
          <div class="list"><div class="list__item"><span class="list__main"><span class="strong">${p.company}</span><span class="small muted">${p.email || 'no email'} · ${p.stage}</span></span><span class="badge">Prospect</span></div></div>
          ${p.email ? html`<label class="field"><span>Keep ${p.email} as</span><select class="select" data-role>${ROLES.map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>` : ''}
          <p class="muted small" style="margin:8px 0 0">The prospect's email history moves onto ${label(c)}, its notes go on the timeline, and the prospect card is removed.</p>`);
        go.disabled = false;
      };

      armed(go, () => {
        if (!pick.item) return;
        if (pick.kind === 'customer') {
          const primaryEmail = (d.$('input[name="primary"]:checked') || {}).value || '';
          busy(go, () => serverApi('/api/accounts/merge', { method: 'POST', body: { keepId: c.id, mergeId: pick.item.id, primaryEmail } }))
            .then(async (r) => {
              const gone = state.customers.get(r.mergedId);
              if (gone) { state.customers.delete(gone.id); state.byNumericId.delete(gone.numericId); }
              await refreshCustomer(r.keptId);
              toast('Accounts merged');
              d.close();
              location.hash = `#/customers/${numericId(r.keptId)}`;
            }).catch(() => {});
        } else {
          const role = (d.$('[data-role]') || {}).value || 'secondary';
          busy(go, () => serverApi('/api/accounts/merge-prospect', { method: 'POST', body: { prospectId: pick.item.id, customerId: c.id, role } }))
            .then(async () => { await loadProspects({ force: true }); await refreshCustomer(c.id); toast('Prospect merged in'); d.close(); })
            .catch(() => {});
        }
      }, 'Click again to merge');
    },
  });
}
