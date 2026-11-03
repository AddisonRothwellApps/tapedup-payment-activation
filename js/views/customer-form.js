// The customer details form at the top of a customer's page: company,
// contact, phone, address, email addresses (main, secondary, finance) and the
// account settings (trade account, terms, pipeline stage, note), all ready to
// edit in place. Any change brings up a Save bar at the top of the page, and
// you can't leave the page until you save or discard.
import { html, raw, icon, toast, busy } from '../ui.js';
import { state, TAGS, STAGES, stageOf, isDealer, isTerms, saveProfile, setTag, setStage, saveNote, refreshCustomer, todayISO } from '../store.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { leaveGuard } from '../guard.js';
import { openMerge } from './emails-card.js';
import { TRADE_SERVER } from '../env.js';

const ROLES = [['secondary', 'Secondary'], ['finance', 'Finance / accounts']];
const PROFILE_KEYS = ['company', 'contact', 'phone', 'address', 'lastContacted', 'visited'];

/** The saved address as one line: typed text, or the parts the agent saved from an email. */
export const addressText = (a) => (a && typeof a === 'object'
  ? [a.company, a.address1, a.address2, a.city, a.zip].map((x) => String(x || '').trim()).filter(Boolean).join(', ')
  : String(a || ''));

// One form at a time: the customer on screen. `base` is what's saved; `v` is
// what's in the boxes. Emails come from the trade server.
const form = { id: null, base: null, v: null, emails: null, emailsBase: null, emailsError: '', saving: false };

function fromCustomer(c) {
  const p = c.crm.profile || {};
  const st = stageOf(c);
  return {
    company: c.company || '', contact: c.contact || (c.name && c.name !== c.email && c.name !== c.company ? c.name : ''), phone: p.phone || c.phone || '', address: addressText(p.address),
    lastContacted: String(p.lastContacted || '').slice(0, 10), visited: (p.labels || []).includes('Visited'),
    dealer: isDealer(c), terms: isTerms(c), stage: st.guessed ? '' : st.stage, note: c.note || '',
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const isDirty = () => !!form.v && (!same(form.v, form.base) || (form.emails && !same(form.emails, form.emailsBase)));

/** Called on every render: keeps unsaved edits, otherwise shows what's saved. */
export function ensureForm(c) {
  if (form.id !== c.id) Object.assign(form, { id: c.id, emails: null, emailsBase: null, emailsError: '', v: null });
  if (!form.v || (!isDirty() && !form.saving)) { form.base = fromCustomer(c); form.v = { ...form.base }; }
}

export function saveBar() {
  return html`<div class="savebar" data-savebar ${isDirty() ? '' : raw('hidden')} role="region" aria-label="Unsaved changes">
    <span class="strong">${icon('circle-alert', 'i--sm')}You have unsaved changes</span>
    <span class="row" style="gap:6px"><button type="button" class="btn btn--ghost btn--sm" data-discard>Discard</button>
    <button type="button" class="btn btn--sm" data-save-all>${icon('check', 'i--sm')}Save changes</button></span></div>`;
}

export function detailsFormCard(c) {
  const v = form.v;
  const cur = stageOf(c);
  const f = (key, text, attrs = '') => html`<label class="field"><span>${text}</span><input class="input" data-f="${key}" value="${v[key]}" ${raw(attrs)} autocomplete="off"></label>`;
  return html`<section class="card" data-details-form>
    <div class="card__head"><h2 class="h2">Customer details</h2></div>
    <div class="form">
      ${f('company', 'Company / gym')}
      <div class="form-row">${f('contact', 'Contact', 'placeholder="Who you deal with"')}${f('phone', 'Phone', 'type="tel"')}</div>
      <label class="field"><span>Address</span><textarea class="textarea" rows="2" data-f="address">${v.address}</textarea></label>

      <div class="field"><span>Email addresses</span><div data-emails-edit>${SERVER_FEATURES ? html`<p class="muted small" style="margin:0">Loading emails…</p>`
        : html`<p class="muted small" style="margin:0">${c.email || 'No main email'}${(c.crm.profile.emails || []).map((x) => ` · ${x.email}`).join('')}<br>Edit emails at <a href="${TRADE_SERVER}/#/customers/${c.numericId}" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p>`}</div></div>

      <div class="form-row">
        <label class="field"><span>Last contacted</span><input class="input" type="date" data-f="lastContacted" value="${v.lastContacted}" max="${todayISO()}"></label>
        <label class="field"><span>Pipeline stage</span><select class="select" data-f="stage">${cur.guessed ? html`<option value="" ${v.stage ? '' : raw('selected')}>Not set (looks like ${cur.stage})</option>` : ''}${STAGES.map((st) => html`<option ${v.stage === st ? raw('selected') : ''}>${st}</option>`)}</select></label>
      </div>
      <label class="check"><input type="checkbox" data-f="visited" ${v.visited ? raw('checked') : ''}><span>Visited in person</span></label>
      <label class="check"><input type="checkbox" data-f="dealer" ${v.dealer ? raw('checked') : ''}><span><span class="strong">Trade account</span><br><span class="muted small">Trade pricing, B2B shipping and the dealer area (tag "${TAGS.dealer}")</span></span></label>
      <label class="check"><input type="checkbox" data-f="terms" ${v.terms ? raw('checked') : ''}><span><span class="strong">Pays on terms</span><br><span class="muted small">Can order now, pay by invoice (tag "${TAGS.terms}")</span></span></label>
      <label class="field"><span>Note (also shown in Shopify)</span><textarea class="textarea" rows="3" data-f="note">${v.note}</textarea></label>
      ${c.crm.profile.notionId ? html`<p class="faint small" style="margin:0">Brought over from Notion</p>` : ''}
    </div>
  </section>`;
}

function emailsEditor(box, c, changed) {
  const e = form.emails;
  const paint = () => {
    box.innerHTML = String(html`<div class="form" style="gap:8px">
      <label class="field"><span class="small muted">Main: sign-in and our emails</span><input class="input" type="email" data-em-main value="${e.primary || ''}"></label>
      ${e.others.map((r, i) => html`<div class="row" style="gap:6px;align-items:center">
        <input class="input" type="email" data-em="${i}" value="${r.email}" placeholder="name@gym.co.uk" style="flex:1;min-width:0" aria-label="Email">
        <select class="select" data-em-role="${i}" style="width:auto" aria-label="Type">${ROLES.map(([k, l]) => html`<option value="${k}" ${r.role === k ? raw('selected') : ''}>${l}</option>`)}</select>
        <button type="button" class="btn btn--ghost btn--icon" data-em-rm="${i}" aria-label="Remove">${icon('x', 'i--sm')}</button></div>`)}
      <div class="row row--wrap" style="gap:6px">
        <button type="button" class="btn btn--outline btn--sm" data-em-add>${icon('plus', 'i--sm')}Add an email</button>
        <button type="button" class="btn btn--ghost btn--sm" data-em-merge>${icon('merge', 'i--sm')}Merge with another account…</button>
      </div></div>`);
    box.querySelector('[data-em-main]').addEventListener('input', (ev) => { e.primary = ev.target.value; changed(); });
    box.querySelectorAll('[data-em]').forEach((inp) => inp.addEventListener('input', () => { e.others[Number(inp.dataset.em)].email = inp.value; changed(); }));
    box.querySelectorAll('[data-em-role]').forEach((s) => s.addEventListener('change', () => { e.others[Number(s.dataset.emRole)].role = s.value; changed(); }));
    box.querySelectorAll('[data-em-rm]').forEach((b) => b.addEventListener('click', () => { e.others.splice(Number(b.dataset.emRm), 1); changed(); paint(); }));
    box.querySelector('[data-em-add]').addEventListener('click', () => { e.others.push({ email: '', role: 'secondary' }); changed(); paint(); box.querySelector(`[data-em="${e.others.length - 1}"]`).focus(); });
    box.querySelector('[data-em-merge]').addEventListener('click', () => {
      if (isDirty()) { toast('Save or discard your changes first', 'err'); flash(); return; }
      openMerge(c, { primary: form.emailsBase.primary, others: form.emailsBase.others });
    });
  };
  paint();
}

function flash() {
  const bar = document.querySelector('[data-savebar]');
  if (!bar) return;
  bar.hidden = false;
  bar.classList.remove('savebar--flash'); void bar.offsetWidth; bar.classList.add('savebar--flash');
  bar.scrollIntoView({ block: 'nearest' });
}

/** Wires the form, the Save bar and the leave-the-page guard. `rerender` redraws the page. */
export function mountDetailsForm(el, c, rerender) {
  const card = el.querySelector('[data-details-form]');
  if (!card) return;
  const bar = el.querySelector('[data-savebar]');
  const changed = () => { if (bar) bar.hidden = !isDirty(); };
  card.querySelectorAll('[data-f]').forEach((inp) => {
    const key = inp.dataset.f;
    inp.addEventListener(inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      form.v[key] = inp.type === 'checkbox' ? inp.checked : inp.value;
      changed();
    });
  });

  const box = card.querySelector('[data-emails-edit]');
  if (SERVER_FEATURES && box) {
    if (form.emails) emailsEditor(box, c, changed);
    else if (form.emailsError) box.innerHTML = String(html`<p class="muted small" style="margin:0">${form.emailsError}</p>`);
    else {
      serverApi(`/api/accounts/${c.numericId}/emails`).then((d) => {
        if (form.id !== c.id) return;
        form.emailsBase = { primary: d.primary || '', others: d.others.map(({ email, role }) => ({ email, role })) };
        form.emails = structuredClone(form.emailsBase);
        if (box.isConnected) emailsEditor(box, c, changed);
      }).catch((err) => { form.emailsError = err.message; if (box.isConnected) box.innerHTML = String(html`<p class="muted small" style="margin:0">${err.message}</p>`); });
    }
  }

  leaveGuard.set(() => form.id === c.id && isDirty(), flash);

  if (!bar) return;
  bar.querySelector('[data-discard]').addEventListener('click', () => {
    form.v = { ...form.base };
    if (form.emailsBase) form.emails = structuredClone(form.emailsBase);
    toast('Changes discarded');
    rerender();
  });
  bar.querySelector('[data-save-all]').addEventListener('click', (ev) => {
    if (!form.v.company.trim()) { toast('Add the company name', 'err'); return; }
    busy(ev.currentTarget, () => saveAll(c)).then(() => { toast('Saved'); rerender(); }).catch(() => {});
  });
}

async function saveAll(c) {
  const v = form.v; const b = form.base;
  const latest = () => state.customers.get(c.id) || c;
  form.saving = true;
  try {
    if (PROFILE_KEYS.some((k) => v[k] !== b[k])) {
      const p = latest().crm.profile || {};
      const labels = (p.labels || []).filter((l) => l !== 'Visited');
      if (v.visited) labels.push('Visited');
      const patch = { company: v.company.trim(), contact: v.contact.trim(), phone: v.phone.trim(), lastContacted: v.lastContacted, labels };
      if (v.address !== b.address) patch.address = v.address.trim(); // keeps an agent-saved address intact unless it was edited
      await saveProfile(latest(), patch);
      Object.assign(b, { company: v.company, contact: v.contact, phone: v.phone, address: v.address, lastContacted: v.lastContacted, visited: v.visited });
    }
    if (form.emails && !same(form.emails, form.emailsBase)) {
      const r = await serverApi(`/api/accounts/${c.numericId}/emails`, { method: 'POST', body: { primary: form.emails.primary.trim(), others: form.emails.others.filter((x) => x.email.trim()) } });
      form.emailsBase = { primary: r.primary || '', others: r.others.map(({ email, role }) => ({ email, role })) };
      form.emails = structuredClone(form.emailsBase);
    }
    if (v.dealer !== b.dealer) { await setTag(latest(), TAGS.dealer, v.dealer, `Trade account turned ${v.dealer ? 'on' : 'off'}`); b.dealer = v.dealer; }
    if (v.terms !== b.terms) { await setTag(latest(), TAGS.terms, v.terms, `Pays on terms turned ${v.terms ? 'on' : 'off'}`); b.terms = v.terms; }
    if (v.stage !== b.stage && v.stage) { await setStage(latest(), v.stage); b.stage = v.stage; }
    if (v.note !== b.note) { await saveNote(latest(), v.note); b.note = v.note; }
    await refreshCustomer(c.id);
  } finally {
    form.saving = false;
  }
  form.v = null; // re-read from the saved customer on the next render
}
