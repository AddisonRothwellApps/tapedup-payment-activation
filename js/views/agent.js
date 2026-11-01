// Agent: what the outreach agent is doing, what it may say, how much it has
// cost this month, and which emails are actually working. Lives on the trade
// server, so only at trade.tapedup.co.uk.
import { html, raw, icon, ago, toast, busy, loadingBlock } from '../ui.js';
import { serverApi, SERVER_FEATURES } from '../server.js';
import { emailState, loadEmailTemplates, saveEmailTemplates, DEFAULT_FACTS, TONES } from '../email-templates.js';
import { TRADE_SERVER } from '../env.js';

const ui = { days: 90, status: null, results: null, error: null, loading: null };
const usd = (n) => `$${Number(n || 0).toFixed(2)}`;
const rate = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function load() {
  ui.loading = Promise.all([
    serverApi('/api/agent/status'),
    serverApi(`/api/agent/results?days=${ui.days}`),
    emailState.loaded ? null : loadEmailTemplates(),
  ]).then(([s, r]) => { ui.status = s; ui.results = r.items; ui.error = null; })
    .catch((err) => { ui.error = err.message; })
    .finally(() => { ui.loading = null; });
  return ui.loading;
}

export function render(el) {
  if (!SERVER_FEATURES) {
    el.innerHTML = String(html`<div class="page"><div class="page-head"><div><p class="eyebrow">Sales</p><h1 class="h1">Agent</h1></div></div>
      <div class="card"><p class="muted" style="margin:0">The outreach agent runs at <a href="${TRADE_SERVER}/#/agent" target="_blank" rel="noopener">trade.tapedup.co.uk</a>.</p></div></div>`);
    return;
  }
  if (!ui.status && !ui.error) {
    el.innerHTML = String(html`<div class="page">${loadingBlock('Loading the agent…')}</div>`);
    if (!ui.loading) load().then(() => { if (location.hash.startsWith('#/agent')) render(el); });
    return;
  }
  if (ui.error) {
    el.innerHTML = String(html`<div class="page"><div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div></div>`);
    return;
  }
  const s = ui.status;
  const set = emailState.set;
  const a = set.agent || {};
  const pct = s.budgetUSD ? Math.min(100, (s.spentUSD / s.budgetUSD) * 100) : 0;
  const autoTemplates = set.templates.filter((t) => t.approval === 'auto' && t.active !== false);
  const names = new Map(set.templates.map((t) => [t.key, t.name]));
  names.set('agent-reply', 'Agent replies');
  const tot = (ui.results || []).reduce((x, r) => ({ sent: x.sent + r.sent, replied: x.replied + r.replied, samples: x.samples + r.samples, accounts: x.accounts + r.accounts }), { sent: 0, replied: 0, samples: 0, accounts: 0 });

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Sales</p><h1 class="h1">Agent</h1>
          <p class="muted" style="margin:4px 0 0">Reads replies, drafts answers and chases anyone who hasn't answered. Nothing goes out without you unless you allow it.</p></div>
        <div class="page-head__actions"><button class="btn btn--outline" data-run>${icon('refresh-cw')}Run follow-ups now</button></div>
      </div>

      <div class="stats">
        <div class="stat"><span class="stat__label">Reading replies</span><span class="stat__value">${s.enabled ? 'On' : 'Off'}</span><span class="stat__sub">${s.enabled ? `${s.callsThisMonth} AI calls this month` : s.hasKey ? 'Switched off (AGENT_ENABLED)' : 'Add ANTHROPIC_API_KEY to switch on'}</span></div>
        <div class="stat"><span class="stat__label">Sending without approval</span><span class="stat__value">${s.autosend ? 'Allowed' : 'Never'}</span><span class="stat__sub">${s.autosend ? `${autoTemplates.length} template${autoTemplates.length === 1 ? '' : 's'}${s.replyApproval === 'auto' ? ' + replies' : ''} may send` : 'AGENT_AUTOSEND is off: everything waits in the Outbox'}</span></div>
        <div class="stat"><span class="stat__label">AI spend this month</span><span class="stat__value">${usd(s.spentUSD)}</span>
          <div class="meter" style="margin-top:8px" role="meter" aria-valuemin="0" aria-valuemax="${s.budgetUSD}" aria-valuenow="${s.spentUSD.toFixed(2)}" aria-label="Spend against budget"><span style="width:${pct}%"></span></div>
          <span class="stat__sub">of ${usd(s.budgetUSD)} limit; pauses when reached</span></div>
        <div class="stat"><span class="stat__label">Follow-ups last run</span><span class="stat__value">${s.lastCadence ? ago(s.lastCadence.at) : 'Not yet'}</span><span class="stat__sub">${s.lastCadence ? `${s.lastCadence.drafted} drafted, ${s.lastCadence.closed} moved to Not now` : 'Runs hourly once email is on'}</span></div>
      </div>

      <section class="card card--flush">
        <div class="card__head" style="padding:20px 20px 0"><h2 class="h2">What's working</h2>
          <select class="select input--sm" data-days aria-label="Period" style="width:auto">${[[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([d, l]) => html`<option value="${d}" ${d === ui.days ? raw('selected') : ''}>${l}</option>`)}</select></div>
        ${ui.results.length ? html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Email</th><th class="num">Sent</th><th class="num">Replied</th><th class="num">Opted out</th><th class="num">Samples after</th><th class="num">Accounts after</th></tr></thead>
          <tbody>${ui.results.map((r) => html`<tr><td class="strong">${names.get(r.key) || r.key}</td><td class="num">${r.sent}</td>
            <td class="num">${r.replied} <span class="muted small">${rate(r.replied, r.sent)}</span></td><td class="num">${r.opted_out}</td>
            <td class="num">${r.samples}</td><td class="num">${r.accounts}</td></tr>`)}
            <tr><td class="strong">All</td><td class="num strong">${tot.sent}</td><td class="num strong">${tot.replied} <span class="muted small">${rate(tot.replied, tot.sent)}</span></td><td></td><td class="num strong">${tot.samples}</td><td class="num strong">${tot.accounts}</td></tr></tbody>
        </table></div>` : html`<p class="muted" style="padding:16px 20px 20px;margin:0">No emails sent in this period yet.</p>`}
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">What the agent may say</h2><span class="muted small">Used when it drafts replies</span></div>
        <div class="form">
          <label class="field"><span>Facts about TapedUp</span><textarea class="textarea" rows="8" data-facts>${a.facts || DEFAULT_FACTS}</textarea></label>
          <p class="muted small" style="margin:0">It only uses these facts. It won't quote prices, terms, delivery dates or stock: replies that need those are flagged for you. Add anything you're happy for it to say (new designs, widths, lead times).</p>
          <div class="form-row">
            <label class="field"><span>Reply tone</span><select class="select" data-tone>${TONES.map(([k, l]) => html`<option value="${k}" ${(a.tone || 'brand') === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
            <label class="field"><span>Agent replies</span><select class="select" data-reply>
              <option value="always" ${a.replyApproval !== 'auto' ? raw('selected') : ''}>Always ask me first</option>
              <option value="auto" ${a.replyApproval === 'auto' ? raw('selected') : ''}>May send simple ones (sample requests, "not now")</option></select></label>
          </div>
          ${a.replyApproval === 'auto' && !s.autosend ? html`<p class="muted small" style="margin:0">Replies still wait for you until AGENT_AUTOSEND is switched on in the server settings.</p>` : ''}
          <button class="btn btn--sm" style="justify-self:start" data-save>${icon('check', 'i--sm')}Save</button>
        </div>
      </section>

      <section class="card">
        <div class="card__head"><h2 class="h2">How it works</h2></div>
        <ol class="small" style="margin:0;padding-left:18px;display:grid;gap:6px">
          <li><strong>A reply arrives.</strong> The agent reads it, adds a one-line summary to their timeline, saves any delivery address for the sample form and any "try us in March" date as a follow-up. "Not now" and "not interested" move their stage.</li>
          <li><strong>It drafts an answer</strong> in the same thread, with a note on what it read. You approve, edit or reject it in the Outbox.</li>
          <li><strong>No answer?</strong> Follow-up 1 and 2 go out after each template's delay, then they move to Not now. A sample check-in follows a few days after each sample order.</li>
          <li><strong>You stay in charge of anything that costs money:</strong> sample orders, codes and trade accounts are always your buttons.</li>
        </ol>
      </section>
    </div>`);

  el.querySelector('[data-days]').addEventListener('change', (e) => { ui.days = Number(e.target.value); ui.status = null; render(el); });
  const run = el.querySelector('[data-run]');
  run.addEventListener('click', () => busy(run, () => serverApi('/api/agent/cadence', { method: 'POST', body: {} }))
    .then((r) => { toast(`${r.drafted.length} follow-up${r.drafted.length === 1 ? '' : 's'} drafted${r.closed.length ? `, ${r.closed.length} moved to Not now` : ''}`); window.dispatchEvent(new Event('outbox-changed')); ui.status = null; render(el); })
    .catch(() => {}));
  const save = el.querySelector('[data-save]');
  save.addEventListener('click', () => {
    const facts = el.querySelector('[data-facts]').value.trim();
    const next = { facts: facts && facts !== DEFAULT_FACTS ? facts : '', tone: el.querySelector('[data-tone]').value, replyApproval: el.querySelector('[data-reply]').value };
    busy(save, () => saveEmailTemplates({ ...emailState.set, agent: next })).then(() => { toast('Agent settings saved'); ui.status = null; render(el); }).catch(() => {});
  });
}
