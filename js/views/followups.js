// Follow-ups: every open "follow up on…" date from the comms log, grouped
// overdue / today / coming up, plus the latest activity across all customers.
import { state, followUps, updateLog, label, LOG_TYPES, todayISO, addDaysISO } from '../store.js';
import { html, icon, fmtDate, ago, dueLabel, toast, busy } from '../ui.js';
import { openLogDrawer } from './customer.js';

export function render(el) {
  const today = todayISO();
  const open = followUps();
  const groups = [
    ['Overdue', open.filter((f) => f.entry.followUp < today)],
    ['Today', open.filter((f) => f.entry.followUp === today)],
    ['Coming up', open.filter((f) => f.entry.followUp > today)],
  ];
  const recent = [...state.customers.values()]
    .flatMap((c) => c.crm.log.filter((e) => e.type !== 'auto').map((entry) => ({ customer: c, entry })))
    .sort((a, b) => String(b.entry.at).localeCompare(String(a.entry.at))).slice(0, 15);

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head"><div><p class="eyebrow">Comms</p><h1 class="h1">Follow-ups</h1></div></div>
      <div class="grid grid--side">
        <div class="stack">
          ${open.length ? groups.filter(([, list]) => list.length).map(([title, list]) => html`
            <section class="card">
              <div class="card__head"><h2 class="h2">${title}</h2><span class="muted small">${list.length}</span></div>
              <div class="list">${list.map(({ customer: c, entry: e }) => { const l = dueLabel(e.followUp, today); const t = LOG_TYPES[e.type] || LOG_TYPES.note; return html`
                <div class="list__item" style="align-items:flex-start">
                  <span class="tl__icon">${icon(t.icon, 'i--sm')}</span>
                  <div class="list__main">
                    <a class="strong" href="#/customers/${c.numericId}">${label(c)}</a>
                    <span class="small" style="white-space:pre-wrap">${e.text || 'Follow up'}</span>
                    <span class="row row--wrap small muted" style="gap:8px"><span class="followup ${l.kind ? `followup--${l.kind}` : ''}">${icon('calendar', 'i--sm')}${l.text}</span><span>${t.label} on ${fmtDate(e.at)}</span></span>
                  </div>
                  <div class="row row--wrap" style="gap:4px;justify-content:flex-end">
                    <button class="btn btn--sm" data-log="${c.id}">${icon('notebook-pen', 'i--sm')}Log it</button>
                    <button class="btn btn--ghost btn--sm" data-snooze="${c.id}|${e.id}" title="Push back a week">+1 week</button>
                    <button class="btn btn--ghost btn--sm" data-done="${c.id}|${e.id}">${icon('check', 'i--sm')}Done</button>
                  </div>
                </div>`; })}</div>
            </section>`)
          : html`<section class="card empty">${icon('list-checks')}<strong class="strong">Nothing to follow up</strong><span>When you log a call or email on a customer, add a follow-up date and it lands here.</span></section>`}
        </div>
        <section class="card">
          <div class="card__head"><h2 class="h2">Latest activity</h2></div>
          ${recent.length ? html`<div class="timeline">${recent.map(({ customer: c, entry: e }) => { const t = LOG_TYPES[e.type] || LOG_TYPES.note; return html`
            <div class="tl"><span class="tl__icon">${icon(t.icon, 'i--sm')}</span>
              <div class="tl__body"><div class="tl__meta"><a class="strong" href="#/customers/${c.numericId}">${label(c)}</a><span>${t.label} · ${ago(e.at)}</span></div>
              ${e.text ? html`<div class="tl__text small">${e.text}</div>` : ''}</div></div>`; })}</div>`
            : html`<p class="muted small" style="margin:0">No calls, emails or notes logged yet.</p>`}
        </section>
      </div>
    </div>`);

  const split = (v) => { const [cid, eid] = v.split('|'); return [state.customers.get(cid), eid]; };
  el.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', () => {
    const [c, id] = split(b.dataset.done);
    busy(b, () => updateLog(c, id, { done: true })).then(() => toast(`Done: ${label(c)}`)).catch(() => {});
  }));
  el.querySelectorAll('[data-snooze]').forEach((b) => b.addEventListener('click', () => {
    const [c, id] = split(b.dataset.snooze);
    const e = c.crm.log.find((x) => x.id === id);
    const next = addDaysISO(e.followUp < today ? today : e.followUp, 7);
    busy(b, () => updateLog(c, id, { followUp: next })).then(() => toast(`Moved to ${fmtDate(next)}`)).catch(() => {});
  }));
  el.querySelectorAll('[data-log]').forEach((b) => b.addEventListener('click', () => openLogDrawer(state.customers.get(b.dataset.log))));
}
