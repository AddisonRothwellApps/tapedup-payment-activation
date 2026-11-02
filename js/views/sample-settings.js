// Setup → Trade samples: which tapes go in a free sample pack, and the most
// to give away each month. Saved to the app-data metafield
// tapedup_admin.trade_settings, which the trade server reads when it
// creates a sample order or code.
import { gql, assertOk } from '../api.js';
import { state } from '../store.js';
import { html, icon, toast, busy } from '../ui.js';
import { EMBEDDED } from '../env.js';

const NS = 'tapedup_admin';
const KEY = 'trade_settings';
let settings = null; // { sample: { items, monthlyCapGBP, shippingTitle }, ... }
let loadError = null;

async function load() {
  const data = await gql(`query TradeSettings { currentAppInstallation { metafield(namespace: "${NS}", key: "${KEY}") { value } } }`);
  let s = {};
  try { s = JSON.parse((data.currentAppInstallation.metafield && data.currentAppInstallation.metafield.value) || '{}'); } catch (err) { s = {}; }
  s.sample = { items: [], monthlyCapGBP: 60, shippingTitle: 'Free trade sample', ...(s.sample || {}) };
  settings = s;
}

async function save(next) {
  assertOk(await gql('mutation SaveTradeSettings($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', {
    m: [{ ownerId: state.appInstallationId, namespace: NS, key: KEY, type: 'json', value: JSON.stringify(next) }],
  }));
  settings = next;
}

export function sampleSettingsCard() {
  return html`<section class="card" data-sample-settings>
    <div class="card__head"><h2 class="h2">Trade samples</h2><span class="muted small">What a free sample pack contains</span></div>
    <div data-ss-body><p class="muted small" style="margin:0">Loading…</p></div></section>`;
}

export async function mountSampleSettings(card) {
  if (!card) return;
  const body = card.querySelector('[data-ss-body]');
  if (!settings && !loadError) {
    try { await load(); } catch (err) { loadError = err.message; }
  }
  if (!card.isConnected) return;
  if (loadError) { body.innerHTML = String(html`<div class="notice notice--err">${icon('circle-alert')}<div>${loadError}</div></div>`); return; }
  const draft = structuredClone(settings);
  const items = draft.sample.items;

  const paint = () => {
    body.innerHTML = String(html`<div class="form">
      ${items.length ? html`<div class="list">${items.map((i, n) => html`
        <div class="list__item"><span class="list__main"><span class="strong clip">${i.title || i.variantId}</span></span>
          <input class="input input--sm" type="number" min="1" step="1" style="width:72px" data-qty="${n}" value="${i.quantity}" aria-label="Quantity">
          <button class="btn btn--ghost btn--icon btn--sm" data-rm="${n}" aria-label="Remove">${icon('x', 'i--sm')}</button></div>`)}</div>`
        : html`<p class="muted small" style="margin:0">No products chosen yet, so samples can't be sent.</p>`}
      <button class="btn btn--outline btn--sm" type="button" data-pick style="justify-self:start">${icon('package', 'i--sm')}Choose products</button>
      ${EMBEDDED ? '' : html`<p class="muted small" style="margin:0">The product picker only opens inside Shopify admin. Quantities and the cap can be changed here.</p>`}
      <div class="form-row">
        <label class="field"><span>Monthly cap (retail value)</span><span class="input-affix"><b>£</b><input class="input" type="number" min="0" step="1" data-cap value="${draft.sample.monthlyCapGBP}"></span></label>
        <label class="field"><span>Delivery name on the order</span><input class="input" data-ship value="${draft.sample.shippingTitle}"></label>
      </div>
      <p class="muted small" style="margin:0">Each business and each address can only have one sample. When this month's samples reach the cap, more are refused until the 1st. Set the cap to 0 for no limit.</p>
      <button class="btn btn--sm" style="justify-self:start" data-save>${icon('check', 'i--sm')}Save sample settings</button>
    </div>`);
    body.querySelectorAll('[data-qty]').forEach((inp) => inp.addEventListener('change', () => { items[Number(inp.dataset.qty)].quantity = Math.max(1, Math.round(Number(inp.value) || 1)); }));
    body.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { items.splice(Number(b.dataset.rm), 1); paint(); }));
    body.querySelector('[data-pick]').addEventListener('click', async () => {
      if (!EMBEDDED) { toast('Open Trade Hub inside Shopify admin to choose products', 'err'); return; }
      const byProduct = new Map();
      items.forEach((i) => { if (i.productId) { if (!byProduct.has(i.productId)) byProduct.set(i.productId, []); byProduct.get(i.productId).push({ id: i.variantId }); } });
      const selection = await shopify.resourcePicker({ type: 'product', action: 'select', multiple: true, filter: { variants: true, draft: false, archived: false }, selectionIds: [...byProduct].map(([id, variants]) => ({ id, variants })) });
      if (!selection) return;
      const qty = new Map(items.map((i) => [i.variantId, i.quantity]));
      items.splice(0, items.length, ...selection.flatMap((p) => (p.variants || []).filter((v) => v.id).map((v) => ({
        productId: p.id, variantId: v.id, title: v.title && v.title !== 'Default Title' ? `${p.title} – ${v.title}` : p.title, quantity: qty.get(v.id) || 1,
      }))));
      paint();
    });
    body.querySelector('[data-save]').addEventListener('click', (e) => {
      draft.sample.monthlyCapGBP = Math.max(0, Number(body.querySelector('[data-cap]').value) || 0);
      draft.sample.shippingTitle = body.querySelector('[data-ship]').value.trim() || 'Free trade sample';
      busy(e.currentTarget, () => save(structuredClone(draft))).then(() => toast('Sample settings saved')).catch(() => {});
    });
  };
  paint();
}
