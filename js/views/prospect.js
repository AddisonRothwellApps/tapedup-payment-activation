// One prospect's own page: everything about a centre that hasn't ordered yet.
// Details you can edit in place, notes (newest first), extra email addresses,
// every email with them, and a quick "draft an email" picker. Once they reply
// they become a customer and get the full customer page.
import { html, raw, icon, ago, fmtDate, toast, busy, loadingBlock, emailExcerpt } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { prospectState, loadProspects, updateProspect } from '../prospects.js';
import { emailState, loadEmailTemplates } from '../email-templates.js';
import { groupState, loadGroups, groupById, createGroup, addSite, removeSite } from '../groups.js';
import { openMergeProspect } from './prospects.js';

const STAGES = ['Prospect', 'Contacted', 'Not now', 'Lost'];
const FIRST = 5;
const ui = { id: null, data: null, error: '', loading: false, showAll: false };

async function load(el, id) {
  ui.loading = true; ui.error = '';
  try {
    const [d] = await Promise.all([serverApi(`/api/prospects/${id}`), emailState.loaded ? null : loadEmailTemplates(), groupState.loaded ? null : loadGroups()]);
    ui.data = d;
  } catch (err) { ui.error = err.message; }
  ui.loading = false;
  if (location.hash === `#/prospects/${id}`) render(el, id);
}

const reload = (el, id) => { ui.data = null; render(el, id); };

export function render(el, idParam) {
  const id = Number(idParam);
  if (!SERVER_FEATURES) { el.innerHTML = String(html`<div class="page"><a class="back" href="#/prospects">${icon('arrow-left', 'i--sm')}Prospects</a><div class="card">Prospect pages are at trade.tapedup.co.uk.</div></div>`); return; }
  if (ui.id !== id) Object.assign(ui, { id, data: null, error: '', showAll: false });
  if (!ui.data) {
    el.innerHTML = String(html`<div class="page"><a class="back" href="#/prospects">${icon('arrow-left', 'i--sm')}Prospects</a>
      ${ui.error ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div>` : loadingBlock('Loading…')}</div>`);
    if (!ui.loading && !ui.error) load(el, id);
    return;
  }
  const { item: p, emails, messages, drafts } = ui.data;
  // A prospect who has replied is a customer now: send them to that page.
  if (p.customer_id) { location.hash = `#/customers/${String(p.customer_id).split('/').pop()}`; return; }
  const g = p.group_id ? groupById(p.group_id) : null;
  const real = messages.filter((m) => !m.auto_reply);
  const lastOut = real.find((m) => m.direction === 'out');
  const lastIn = real.find((m) => m.direction === 'in');
  const lastContact = [p.last_contacted, lastOut && lastOut.sent_at].filter(Boolean).sort().pop();
  const shown = ui.showAll ? messages : messages.slice(0, FIRST);
  const templates = (emailState.set && emailState.set.templates || []).filter((t) => t.active !== false);
  const notes = String(p.notes || '').split('\n').filter((l) => l.trim());

  el.innerHTML = String(html`
    <div class="page">
      <a class="back" href="#/pipeline">${icon('arrow-left', 'i--sm')}Pipeline</a>
      <div class="page-head">
        <div style="min-width:0"><p class="eyebrow">Prospect${g ? html` · <a href="#/groups/${g.id}">${g.name}</a>` : ''}</p><h1 class="h1">${p.company}</h1>
          <div class="row row--wrap" style="gap:6px;margin-top:6px"><span class="badge">${p.stage}</span>${p.opt_out ? html`<span class="badge">Opted out of email</span>` : ''}
            <span class="small muted">${[p.contact, p.email, p.phone, p.city].filter(Boolean).join(' · ')}</span></div></div>
        <div class="page-head__actions"><button class="btn btn--outline btn--sm" data-merge>${icon('merge', 'i--sm')}Merge with…</button></div>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat__label">Last contacted</span><span class="stat__value">${lastContact ? ago(lastContact) : '—'}</span><span class="stat__sub">${lastContact ? fmtDate(lastContact) : 'Never emailed'}</span></div>
        <div class="stat"><span class="stat__label">Last reply</span><span class="stat__value">${lastIn ? ago(lastIn.sent_at) : '—'}</span><span class="stat__sub">${lastIn ? lastIn.subject || '(no subject)' : 'No reply yet'}</span></div>
        <div class="stat"><span class="stat__label">Emails from trade@</span><span class="stat__value">${real.filter((m) => m.direction === 'out').length}</span><span class="stat__sub">${real.filter((m) => m.direction === 'in').length} from them</span></div>
        <div class="stat"><span class="stat__label">In the pipeline</span><span class="stat__value">${p.stage}</span><span class="stat__sub">Added ${fmtDate(p.created_at)}</span></div>
      </div>

      <div class="grid grid--side">
        <div class="stack">
          <section class="card">
            <div class="card__head"><h2 class="h2">Notes</h2></div>
            <form class="row" style="gap:8px;margin-bottom:12px" data-noteform>
              <input class="input" data-note placeholder="Add a note: a call, a visit, what they said…" aria-label="New note">
              <button class="btn btn--sm" type="submit">${icon('plus', 'i--sm')}Add</button>
            </form>
            ${notes.length ? html`<div class="list">${notes.map((n) => html`<div class="list__item" style="align-items:flex-start"><span class="list__main small" style="white-space:pre-wrap">${n}</span></div>`)}</div>`
              : html`<p class="muted small" style="margin:0">No notes yet.</p>`}
          </section>

          <section class="card card--flush">
            <div class="card__head" style="padding:16px 20px 0"><h2 class="h2">Emails</h2><span class="muted small">${messages.length > FIRST && !ui.showAll ? `Latest ${FIRST} of ${messages.length}` : `${messages.length} email${messages.length === 1 ? '' : 's'}`} from trade@</span></div>
            ${drafts.length ? html`<div class="notice notice--info" style="margin:12px 16px 0">${icon('inbox')}<div>${drafts.length} email${drafts.length === 1 ? '' : 's'} waiting in the <a href="#/outbox">Outbox</a>: ${drafts.map((d) => d.subject).join(', ')}</div></div>` : ''}
            ${messages.length ? html`<div class="timeline" style="padding:8px 16px 4px">${shown.map((m) => html`
              <div class="tl"><span class="tl__icon">${icon(m.direction === 'out' ? 'send' : 'mail', 'i--sm')}</span>
                <div class="tl__body"><div class="tl__meta"><span class="strong">${m.direction === 'out' ? 'Sent' : `From ${m.from_address}`}</span><span>${ago(m.sent_at)}${m.auto_reply ? ' · auto-reply' : ''}</span></div>
                  <div class="small strong">${m.subject || '(no subject)'}</div>
                  <div class="tl__text small email-excerpt">${emailExcerpt(m.body_text)}</div></div></div>`)}</div>
              ${messages.length > FIRST ? html`<div style="padding:4px 16px 14px"><button class="btn btn--ghost btn--sm" data-more>${ui.showAll ? `Show the latest ${FIRST}` : `View all ${messages.length}`}</button></div>` : ''}`
              : html`<div class="empty" style="padding:16px">${icon('mail')}<span>No emails from trade@ yet. Earlier emails from sales@ are summed up in the notes.</span></div>`}
          </section>
        </div>

        <div class="stack">
          <section class="card">
            <div class="card__head"><h2 class="h2">Draft an email</h2></div>
            ${p.opt_out ? html`<p class="muted small" style="margin:0">They've opted out of email.</p>` : !p.email ? html`<p class="muted small" style="margin:0">Add an email address first.</p>` : html`
              <div class="row" style="gap:6px"><select class="select" data-tpl aria-label="Template">${templates.map((t) => html`<option value="${t.key}" ${t.key === (lastContact ? 'reintro' : 'intro') ? raw('selected') : ''}>${t.name || t.key}</option>`)}</select>
                <button class="btn" data-draft>${icon('mail', 'i--sm')}Draft</button></div>
              <p class="muted small" style="margin:8px 0 0">It goes to the Outbox for you to check and send.</p>`}
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Details</h2></div>
            <div class="form" data-details>
              <label class="field"><span>Company / centre</span><input class="input" data-p="company" value="${p.company || ''}"></label>
              <div class="form-row">
                <label class="field"><span>Contact</span><input class="input" data-p="contact" value="${p.contact || ''}" placeholder="Who you deal with"></label>
                <label class="field"><span>Phone</span><input class="input" data-p="phone" value="${p.phone || ''}"></label>
              </div>
              <label class="field"><span>Main email</span><input class="input" type="email" data-p="email" value="${p.email || ''}"></label>
              <div class="form-row">
                <label class="field"><span>Town</span><input class="input" data-p="city" value="${p.city || ''}"></label>
                <label class="field"><span>Website</span><input class="input" data-p="website" value="${p.website || ''}"></label>
              </div>
              <div class="form-row">
                <label class="field"><span>Stage</span><select class="select" data-p="stage">${STAGES.map((s) => html`<option ${s === p.stage ? raw('selected') : ''}>${s}</option>`)}</select></label>
                <label class="field"><span>First email to use</span><select class="select" data-p="template">
                  <option value="intro" ${p.template !== 'reintro' ? raw('selected') : ''}>Intro (never spoken)</option>
                  <option value="reintro" ${p.template === 'reintro' ? raw('selected') : ''}>Re-introduction (spoke before)</option></select></label>
              </div>
              <div class="form-row">
                <label class="field"><span>Group</span><select class="select" data-group>
                  <option value="">Not in a group</option>${groupState.list.map((x) => html`<option value="${x.id}" ${Number(p.group_id) === x.id ? raw('selected') : ''}>${x.name}</option>`)}<option value="new">New group…</option></select></label>
                <label class="field"><span>Centre name in group</span><input class="input" data-site value="${p.site_name || ''}" placeholder="${p.company}"></label>
              </div>
              <label class="field" data-newwrap hidden><span>New group name</span><input class="input" data-newname></label>
              <div class="row" style="justify-content:flex-end"><button class="btn" data-save>${icon('check', 'i--sm')}Save details</button></div>
            </div>
          </section>

          <section class="card">
            <div class="card__head"><h2 class="h2">Other email addresses</h2></div>
            <p class="muted small" style="margin:0 0 8px">Colleagues or a finance address. Emails from these are recognised as ${p.company}.</p>
            ${emails.length ? html`<div class="list">${emails.map((e) => html`<div class="list__item"><span class="list__main"><span>${e.email}</span><span class="small muted">${e.role === 'finance' ? 'Finance' : 'Other'}${e.note ? ` · ${e.note}` : ''}</span></span>
              <button class="btn btn--ghost btn--sm" data-rmemail="${e.email}" aria-label="Remove ${e.email}">${icon('x', 'i--sm')}</button></div>`)}</div>` : ''}
            <form class="row" style="gap:6px;margin-top:8px" data-emailform>
              <input class="input" type="email" data-newemail placeholder="name@theircentre.co.uk" aria-label="Add an email address">
              <select class="select" data-newrole style="max-width:120px" aria-label="Type"><option value="secondary">Other</option><option value="finance">Finance</option></select>
              <button class="btn btn--outline btn--sm" type="submit">Add</button>
            </form>
          </section>
        </div>
      </div>
    </div>`);

  const again = () => reload(el, id);
  el.querySelector('[data-merge]').addEventListener('click', () => openMergeProspect(p, () => { loadProspects({ force: true }); location.hash = '#/prospects'; }));
  const more = el.querySelector('[data-more]');
  if (more) more.addEventListener('click', () => { ui.showAll = !ui.showAll; render(el, id); });

  el.querySelector('[data-noteform]').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = el.querySelector('[data-note]');
    if (!input.value.trim()) return;
    busy(e.submitter || e.target.querySelector('button'), () => serverApi(`/api/prospects/${id}/note`, { method: 'POST', body: { text: input.value } }))
      .then(() => { toast('Note added'); loadProspects({ force: true }); again(); }).catch(() => {});
  });

  const draft = el.querySelector('[data-draft]');
  if (draft) draft.addEventListener('click', () => busy(draft, () => serverApi('/api/outbox/bulk', { method: 'POST', body: { items: [{ prospectId: id, templateKey: el.querySelector('[data-tpl]').value }] } }))
    .then((r) => {
      if (r.failed && r.failed.length) { toast(r.failed[0].reason, 'err'); return; }
      toast('Drafted: it\'s waiting in the Outbox'); window.dispatchEvent(new Event('outbox-changed')); again();
    }).catch(() => {}));

  const sel = el.querySelector('[data-group]');
  sel.addEventListener('change', () => { el.querySelector('[data-newwrap]').hidden = sel.value !== 'new'; });
  el.querySelector('[data-save]').addEventListener('click', (e) => {
    const patch = Object.fromEntries([...el.querySelectorAll('[data-p]')].map((i) => [i.dataset.p, i.value.trim()]));
    if (!patch.company) { toast('Give it a name', 'err'); return; }
    if (!patch.email) delete patch.email;
    const site = el.querySelector('[data-site]').value.trim();
    busy(e.currentTarget, async () => {
      await updateProspect(id, patch);
      let gid = sel.value;
      if (gid === 'new') {
        const name = el.querySelector('[data-newname]').value.trim();
        if (!name) throw new Error('Give the new group a name');
        gid = String((await createGroup(name)).id);
      }
      if (gid && (Number(gid) !== Number(p.group_id) || site !== (p.site_name || ''))) await addSite(Number(gid), { prospectId: id, siteName: site });
      else if (!gid && p.group_id) await removeSite({ prospectId: id });
    }).then(() => { toast('Saved'); loadProspects({ force: true }); again(); }).catch(() => {});
  });

  el.querySelector('[data-emailform]').addEventListener('submit', (e) => {
    e.preventDefault();
    const add = el.querySelector('[data-newemail]').value.trim();
    if (!add) return;
    busy(e.target.querySelector('button'), () => serverApi(`/api/prospects/${id}/emails`, { method: 'POST', body: { add, role: el.querySelector('[data-newrole]').value } }))
      .then(() => { toast('Added'); again(); }).catch(() => {});
  });
  el.querySelectorAll('[data-rmemail]').forEach((b) => b.addEventListener('click', () => busy(b, () => serverApi(`/api/prospects/${id}/emails`, { method: 'POST', body: { remove: b.dataset.rmemail } }))
    .then(() => { toast('Removed'); again(); }).catch(() => {})));
}
