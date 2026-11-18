// Profit and margin per trade account, from the server's margin report (all
// orders since records began, and the last 12 months). Loaded once and shared
// by the customers list and each customer's page; the server keeps it for ten
// minutes, so it's cheap to ask again.
import { html, money0 } from './ui.js';
import { serverApi, SERVER_FEATURES } from './server.js';

let data = null;
let pending = null;
let failed = false;

/** The figures for one customer (by gid), or undefined while loading / none. */
export const accountProfit = (id) => data?.customers?.[id];
export const accountProfitReady = () => !!data;
export const accountProfitFailed = () => failed;

/** Loads the figures once; resolves when they're in (or failed). */
export function loadAccountProfit({ fresh = false } = {}) {
  if (!SERVER_FEATURES) return Promise.resolve(null);
  if (data && !fresh) return Promise.resolve(data);
  if (!pending) {
    pending = serverApi(`/api/margins/customers${fresh ? '?fresh=1' : ''}`)
      .then((d) => { data = d; failed = false; return d; })
      .catch((err) => { failed = true; console.error('account profit', err); return null; })
      .finally(() => { pending = null; });
  }
  return pending;
}

const pct = (m) => (m == null ? '' : `${Math.round(m * 100)}%`);
const tone = (m) => (m == null ? '' : m < 0 ? 'margin--bad' : m < 0.3 ? 'margin--low' : 'margin--ok');

/** A cell for the customers table: lifetime profit with its margin under it. */
export function profitCell(id) {
  if (!SERVER_FEATURES) return html`<span class="faint">—</span>`;
  if (!data) return html`<span class="faint">${failed ? '—' : '…'}</span>`;
  const p = accountProfit(id);
  if (!p || !p.lifetime.costed) return html`<span class="faint" title="${p && p.lifetime.orders ? 'Their orders have no product costs yet (imported invoices)' : 'No orders yet'}">—</span>`;
  const l = p.lifetime;
  return html`<span class="strong">${money0(l.profit)}</span>${l.margin != null ? html`<br><span class="small ${tone(l.margin)}">${pct(l.margin)}</span>` : ''}`;
}

/** The stat tiles on a customer's page (two tiles: account profit, last 12 months). */
export function profitStats(id) {
  if (!SERVER_FEATURES) return '';
  const p = accountProfit(id);
  const waiting = !data ? (failed ? 'Couldn\'t load' : 'Working it out…') : null;
  const l = p?.lifetime;
  const y = p?.year;
  const incomplete = (t) => (t && t.incomplete ? ` · ${t.incomplete} order${t.incomplete === 1 ? '' : 's'} without costs left out` : '');
  return html`
    <div class="stat"><span class="stat__label">Account profit</span>
      <span class="stat__value">${l && l.costed ? money0(l.profit) : '—'}</span>
      <span class="stat__sub">${waiting || (l && l.costed ? html`<span class="strong ${tone(l.margin)}">${pct(l.margin)}</span> margin, all time${incomplete(l)}${p.samples ? ` · samples cost ${money0(p.samples)}` : ''}` : l && l.orders ? 'Their orders have no product costs yet' : 'No orders yet')}</span></div>
    <div class="stat"><span class="stat__label">Profit, last 12 months</span>
      <span class="stat__value">${y && y.costed ? money0(y.profit) : '—'}</span>
      <span class="stat__sub">${waiting || (y && y.costed ? html`<span class="strong ${tone(y.margin)}">${pct(y.margin)}</span> margin on ${money0(y.net + y.shipping)} taken${incomplete(y)}` : 'No costed orders in the last year')}</span></div>`;
}
