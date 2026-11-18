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
  const part = l.costed < l.orders ? html` <span class="faint" title="Only ${l.costed} of their ${l.orders} orders have product costs; imported invoices are left out">· ${l.costed}/${l.orders}</span>` : '';
  return html`<span class="strong">${money0(l.profit)}</span>${l.margin != null ? html`<br><span class="small ${tone(l.margin)}">${pct(l.margin)}</span>` : ''}${part}`;
}

/** The stat tile on a customer's page: account profit, all time and the last 12 months. */
export function profitStats(id) {
  if (!SERVER_FEATURES) return '';
  const p = accountProfit(id);
  const waiting = !data ? (failed ? 'Couldn\'t load' : 'Working it out…') : null;
  const l = p?.lifetime;
  const y = p?.year;
  const left = l && l.costed < l.orders ? ` · ${l.orders - l.costed} of ${l.orders} orders have no costs (imported invoices) and are left out` : '';
  return html`
    <div class="stat"><span class="stat__label">Account profit</span>
      <span class="stat__value">${l && l.costed ? money0(l.profit) : '—'}</span>
      <span class="stat__sub">${waiting || (l && l.costed ? html`<span class="strong ${tone(l.margin)}">${pct(l.margin)}</span> margin, all time · ${y && y.costed ? html`<span class="strong">${money0(y.profit)}</span> (${pct(y.margin)}) in the last 12 months` : 'none in the last 12 months'}${left}${p.samples ? ` · samples cost ${money0(p.samples)}` : ''}` : l && l.orders ? 'Their orders have no product costs yet (imported invoices)' : 'No orders yet')}</span></div>`;
}
