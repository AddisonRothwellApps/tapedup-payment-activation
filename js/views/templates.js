// Templates: one email per pipeline step, plus the signature. Saved to
// Shopify so every copy of Trade Hub and the trade server share them.
// At trade.tapedup.co.uk the editor previews the real email for a chosen
// dealer and can send a test to you; inside admin it edits only.
import { state, PIPELINE, label } from '../store.js';
import { html, raw, icon, toast, openDrawer, busy, loadingBlock, showEmail } from '../ui.js';
import { emailState, loadEmailTemplates, saveEmailTemplates, FIELDS, TONES, DEFAULT_SET, unknownFields } from '../email-templates.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { TRADE_SERVER } from '../env.js';

let loading = null;
let loadError = '';

const stageOrder = (t) => { const i = PIPELINE.findIndex((p) => p.key === t.stage); return i < 0 ? 99 : i; };

export function render(el) {
  if (!emailState.loaded && !loading) {
    loading = loadEmailTemplates().catch((err) => { loadError = err.message; })
      .finally(() => { loading = null; if (location.hash.startsWith('#/templates')) render(el); });
  }
  if (!emailState.loaded) {
    el.innerHTML = String(html`<div class="page">${loadError ? html`<div class="notice notice--err">${icon('circle-alert')}<div>${loadError}</div></div>` : loadingBlock('Loading email templates…')}</div>`);
    return;
  }
  const set = emailState.set;
  const list = [...set.templates].sort((a, b) => stageOrder(a) - stageOrder(b));
  const sig = set.signature || {};

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Email</p><h1 class="h1">Templates</h1>
          <p class="muted" style="margin:4px 0 0">One email per step of the pipeline. Plain text: a blank line starts a new paragraph, and fields in {curly brackets} are filled in for each dealer. Add a fallback after a bar for when it's blank: {first_name|there}.</p></div>
        <div class="page-head__actions"><button class="btn btn--outline" data-new>${icon('plus')}New template</button></div>
      </div>
      ${!emailState.saved ? html`<div class="notice notice--info">${icon('info')}<div><strong>These are the starting templates and aren't saved yet.</strong> Read them over, add your signature, then press Save on any template (or below) to switch email drafting on.
        <div style="margin-top:10px"><button class="btn btn--sm" data-save-all>${icon('check', 'i--sm')}Save these templates</button></div></div></div>` : ''}
      ${SERVER_FEATURES ? '' : html`<div class="notice">${icon('info')}<div>Previews and test emails work at <a href="${TRADE_SERVER}/#/templates" target="_blank" rel="noopener">trade.tapedup.co.uk</a>. Edits here are saved for both.</div></div>`}

      <section class="card">
        <div class="card__head"><h2 class="h2">Signature</h2><button class="btn btn--ghost btn--sm" data-sig>${icon('pencil', 'i--sm')}Edit</button></div>
        <p style="margin:0;line-height:1.5">${sig.name ? html`<strong>${sig.name}</strong>` : html`<span class="muted">No name yet: add yours so emails come from a person</span>`}${sig.title ? html`<br>${sig.title}` : ''}<br>${sig.company || 'TapedUp'}${sig.phone ? html`<br>${sig.phone}` : ''}<br>${sig.website || 'tapedup.co.uk'}</p>
      </section>

      <section class="card" style="padding:0">
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Template</th><th>Stage</th><th class="hide-sm">Sends</th><th class="hide-sm">Approval</th><th></th></tr></thead>
          <tbody>${list.map((t) => html`
            <tr class="${t.active === false ? 'muted' : ''}">
              <td><div class="strong">${t.name}${t.isNew ? html` <span class="badge badge--cyan">New: save to use</span>` : ''}</div><div class="small muted">${t.subject}</div></td>
              <td class="nowrap"><span class="badge">${t.stage}</span>${t.firstTouch ? html` <span class="badge badge--cyan" title="Starts a new conversation: counts against the daily limit">New conversation</span>` : ''}</td>
              <td class="hide-sm nowrap small">${t.delayDays ? `${t.delayDays} days after the last email` : 'When drafted'}</td>
              <td class="hide-sm nowrap small">${t.approval === 'auto' ? 'Automatic (agent)' : 'You approve'}</td>
              <td class="nowrap" style="text-align:right">${t.active === false ? html`<span class="small muted" style="margin-right:8px">Off</span>` : ''}<button class="btn btn--sm btn--outline" data-edit="${t.key}">${icon('pencil', 'i--sm')}Edit</button></td>
            </tr>`)}</tbody>
        </table></div>
      </section>
    </div>`);

  const saveAll = el.querySelector('[data-save-all]');
  if (saveAll) saveAll.addEventListener('click', () => busy(saveAll, () => saveEmailTemplates(set)).then(() => { toast('Templates saved'); render(el); }).catch(() => {}));
  el.querySelector('[data-sig]').addEventListener('click', () => openSignature(el));
  el.querySelector('[data-new]').addEventListener('click', () => openEditor(el, null));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditor(el, set.templates.find((t) => t.key === b.dataset.edit))));
}

function openSignature(el) {
  const sig = { ...DEFAULT_SET.signature, ...(emailState.set.signature || {}) };
  openDrawer({
    title: 'Signature', eyebrow: 'Email',
    body: html`<div class="form">
      <label class="field"><span>Your name</span><input class="input" data-f="name" value="${sig.name}" placeholder="Addison Rothwell"></label>
      <label class="field"><span>Title</span><input class="input" data-f="title" value="${sig.title}" placeholder="Founder"></label>
      <label class="field"><span>Company</span><input class="input" data-f="company" value="${sig.company}"></label>
      <label class="field"><span>Phone</span><input class="input" data-f="phone" value="${sig.phone}"></label>
      <label class="field"><span>Website</span><input class="input" data-f="website" value="${sig.website}"></label>
      <p class="muted small" style="margin:0">Your name also fills {sender_name} in the templates.</p></div>`,
    foot: html`<button class="btn" data-save>${icon('check', 'i--sm')}Save signature</button>`,
    onMount: (d) => d.$('[data-save]').addEventListener('click', (e) => {
      const next = Object.fromEntries(d.$$('[data-f]').map((i) => [i.dataset.f, i.value.trim()]));
      busy(e.currentTarget, () => saveEmailTemplates({ ...emailState.set, signature: next })).then(() => { toast('Signature saved'); d.close(); render(el); }).catch(() => {});
    }),
  });
}

function slug(name) { return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `t-${Date.now().toString(36)}`; }

function openEditor(el, existing) {
  const t = existing ? { ...existing } : { key: '', name: '', stage: 'Prospect', subject: '', body: '', firstTouch: false, optOut: true, delayDays: 0, approval: 'always', tone: 'brand', offerTemplateId: '', active: true };
  const customers = [...state.customers.values()].sort((a, b) => label(a).localeCompare(label(b)));
  openDrawer({
    title: existing ? t.name : 'New template', eyebrow: 'Email template', wide: true,
    body: html`<div class="form">
      <div class="form-row">
        <label class="field"><span>Name</span><input class="input" data-f="name" value="${t.name}" placeholder="Follow-up 1"></label>
        <label class="field"><span>Pipeline stage</span><select class="select" data-f="stage">${PIPELINE.map((p) => html`<option ${p.key === t.stage ? raw('selected') : ''}>${p.key}</option>`)}</select></label>
      </div>
      <label class="field"><span>Subject</span><input class="input" data-f="subject" value="${t.subject}"></label>
      <label class="field"><span>Preview text (optional)</span><input class="input" data-f="preview" value="${t.preview || ''}" placeholder="The grey line inboxes show after the subject"></label>
      <label class="field"><span>Email</span><textarea class="textarea" data-f="body" rows="12" style="font-family:var(--font-body);line-height:1.55">${t.body}</textarea></label>
      <div class="row row--wrap" style="gap:6px"><span class="small muted">Insert:</span>${FIELDS.map(([k, name]) => html`<button type="button" class="btn btn--ghost btn--sm" data-insert="${k}" title="${name}" style="text-transform:none;letter-spacing:0">{${k}}</button>`)}</div>
      <p class="small muted" style="margin:0" data-unknown></p>
      <div class="form-row">
        <label class="field"><span>Tone (for the agent)</span><select class="select" data-f="tone">${TONES.map(([k, name]) => html`<option value="${k}" ${k === t.tone ? raw('selected') : ''}>${name}</option>`)}</select></label>
        <label class="field"><span>Send after (days since the last email)</span><input class="input" type="number" min="0" max="120" data-f="delayDays" value="${t.delayDays || 0}"></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Starter offer to attach</span><select class="select" data-f="offerTemplateId"><option value="">None</option>${state.templates.map((o) => html`<option value="${o.id}" ${o.id === t.offerTemplateId ? raw('selected') : ''}>${o.name}</option>`)}</select></label>
        <label class="field"><span>Approval</span><select class="select" data-f="approval">
          <option value="always" ${t.approval !== 'auto' ? raw('selected') : ''}>Always ask me first</option>
          <option value="auto" ${t.approval === 'auto' ? raw('selected') : ''}>Agent may send it (when auto-send is on)</option></select></label>
      </div>
      <label class="check"><input type="checkbox" data-f="firstTouch" ${t.firstTouch ? raw('checked') : ''}><span><span class="strong">Starts a new conversation</span><br><span class="muted small">Sent as a new email rather than a reply, and counts against the daily limit for new conversations.</span></span></label>
      <label class="check"><input type="checkbox" data-f="optOut" ${t.optOut ?? t.firstTouch ? raw('checked') : ''}><span><span class="strong">Add the TapedUp Limited line with "reply STOP to opt out"</span><br><span class="muted small">Keep this on for anyone who isn't a customer yet.</span></span></label>
      <label class="check"><input type="checkbox" data-f="active" ${t.active !== false ? raw('checked') : ''}><span><span class="strong">In use</span></span></label>

      <section class="card" style="background:var(--surface-subtle)">
        <div class="card__head"><h3 class="h2" style="font-size:var(--text-lg)">Preview</h3>
          ${SERVER_FEATURES ? html`<div class="row" style="gap:6px"><select class="select input--sm" data-preview-for style="max-width:220px"><option value="">Choose a dealer…</option>${customers.map((c) => html`<option value="${c.id}">${label(c)}</option>`)}</select>
            <button type="button" class="btn btn--ghost btn--sm" data-test>${icon('send', 'i--sm')}Send me a test</button></div>` : ''}</div>
        <div data-preview>${SERVER_FEATURES ? html`<p class="muted small" style="margin:0">Choose a dealer to see exactly what they'd get.</p>` : html`<p class="muted small" style="margin:0">Preview at trade.tapedup.co.uk.</p>`}</div>
      </section>
    </div>`,
    foot: html`${existing ? html`<button class="btn btn--danger btn--ghost" data-delete>Delete</button>` : ''}<span style="flex:1"></span><button class="btn" data-save>${icon('check', 'i--sm')}Save template</button>`,
    onMount: (d) => {
      const read = () => {
        const v = Object.fromEntries(d.$$('[data-f]').map((i) => [i.dataset.f, i.type === 'checkbox' ? i.checked : i.value]));
        return { ...t, ...v, name: v.name.trim(), subject: v.subject.trim(), preview: String(v.preview || '').trim(), body: v.body.replace(/\s+$/, ''), delayDays: Math.max(0, Number(v.delayDays) || 0) };
      };
      const body = d.$('[data-f="body"]');
      const unknown = d.$('[data-unknown]');
      const checkFields = () => {
        const bad = unknownFields(`${d.$('[data-f="subject"]').value} ${body.value}`);
        unknown.textContent = bad.length ? `Not a field we can fill: ${bad.map((b) => `{${b}}`).join(', ')}. These will be sent as typed.` : '';
      };
      body.addEventListener('input', checkFields); checkFields();
      d.$$('[data-insert]').forEach((b) => b.addEventListener('click', () => {
        const ins = `{${b.dataset.insert}}`;
        const { selectionStart: s, selectionEnd: e } = body;
        body.setRangeText(ins, s, e, 'end'); body.focus(); checkFields();
      }));

      const preview = d.$('[data-preview]');
      const showPreview = async () => {
        const who = d.$('[data-preview-for]');
        if (!who || !who.value) return;
        preview.innerHTML = String(loadingBlock('Rendering…'));
        try {
          const r = await serverApi('/api/templates/preview', { method: 'POST', body: { template: read(), customerId: who.value } });
          preview.innerHTML = String(html`
            <div class="small" style="margin-bottom:8px"><span class="muted">To</span> ${r.to || html`<span class="followup followup--overdue">no email address</span>`}<br><span class="muted">Subject</span> <strong>${r.subject}</strong></div>
            ${r.missing.length ? html`<div class="notice notice--warn" style="margin-bottom:8px">${icon('circle-alert')}<div>No value for ${r.missing.map((m) => `{${m}}`).join(', ')} for this dealer: it couldn't be sent to them until that's filled in.</div></div>` : ''}
            <iframe class="email-frame" sandbox="" title="Email preview"></iframe>`);
          showEmail(preview.querySelector('iframe'), r.html);
        } catch (err) { preview.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${err.message}</div></div>`); }
      };
      const who = d.$('[data-preview-for]');
      if (who) who.addEventListener('change', showPreview);
      const test = d.$('[data-test]');
      if (test) test.addEventListener('click', () => busy(test, () => serverApi('/api/mail/test', { method: 'POST', body: { template: read(), customerId: (who && who.value) || undefined } }))
        .then((r) => toast(`Test sent to ${r.to}`)).catch(() => {}));

      d.$('[data-save]').addEventListener('click', (e) => {
        const next = read();
        if (!next.name || !next.subject || !next.body.trim()) { toast('Give it a name, a subject and some text', 'err'); return; }
        if (!next.key) {
          let key = slug(next.name); let n = 2;
          while (emailState.set.templates.some((x) => x.key === key)) key = `${slug(next.name)}-${n++}`;
          next.key = key;
        }
        const templates = existing ? emailState.set.templates.map((x) => (x.key === existing.key ? next : x)) : [...emailState.set.templates, next];
        busy(e.currentTarget, () => saveEmailTemplates({ ...emailState.set, templates })).then(() => { toast(`${next.name} saved`); d.close(); render(el); }).catch(() => {});
      });
      const del = d.$('[data-delete]');
      if (del) {
        let armedOnce = false;
        del.addEventListener('click', () => {
          if (!armedOnce) { armedOnce = true; del.textContent = 'Click again to delete'; return; }
          busy(del, () => saveEmailTemplates({ ...emailState.set, templates: emailState.set.templates.filter((x) => x.key !== existing.key) }))
            .then(() => { toast('Template deleted'); d.close(); render(el); }).catch(() => {});
        });
      }
    },
  });
}
