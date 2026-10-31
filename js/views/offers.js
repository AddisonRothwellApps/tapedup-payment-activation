// Starter offers: reusable templates (saved once, given to any number of
// customers) and the list of customers who currently have one.
import {
  state, offerStatus, describeOffer, offerHeadline, offerFromTemplate, defaultTemplate, saveTemplates, newTemplateId,
  giveOffer, removeOffer, isDealer, todayISO, label, sublabel,
} from '../store.js';
import { html, raw, icon, fmtDate, ago, toast, openDrawer, busy, armed } from '../ui.js';

const ui = { show: 'Waiting' };
const BLANK_TEMPLATE = () => ({ id: '', name: '', isDefault: false, items: [], discountType: 'percentage', discountValue: 10, message: 'Welcome to TapedUp! Your starter order is ready.', expiresInDays: 30, autoAdd: true });

export function render(el) {
  const withOffer = [...state.customers.values()].filter((c) => c.offer).map((c) => ({ c, status: offerStatus(c) }));
  const counts = { Waiting: 0, Used: 0, Expired: 0 };
  withOffer.forEach((r) => { counts[r.status] += 1; });
  const rows = withOffer.filter((r) => ui.show === 'All' || r.status === ui.show)
    .sort((a, b) => String(b.c.offer.assignedAt).localeCompare(String(a.c.offer.assignedAt)));

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Opening orders</p><h1 class="h1">Starter offers</h1></div>
        <div class="page-head__actions">
          <button class="btn btn--outline" data-new-template>${icon('plus')}New template</button>
          <button class="btn" data-give ${state.templates.length ? '' : raw('disabled')}>${icon('gift')}Give an offer</button>
        </div>
      </div>
      <div class="notice notice--info">${icon('circle-alert')}<div>
        Make a template once, then give it to as many customers as you like. Each customer gets a banner on the site, the products drop into their cart when they log in, and the discount comes off their whole order at checkout. It switches itself off after their next order.
      </div></div>

      <section class="stack" style="gap:12px">
        <h2 class="h3">Templates</h2>
        ${state.templates.length ? html`<div class="cards">${state.templates.map(templateCard)}</div>` : html`
          <div class="card empty">${icon('gift')}<strong class="strong">No templates yet</strong><span>Set up your standard starter order once: the products, the discount and how long it lasts.</span>
            <button class="btn" data-new-template>${icon('plus')}Create your first template</button></div>`}
      </section>

      <section class="card card--flush">
        <div class="card__head"><h2 class="h2">Customers with an offer</h2>
          <div class="seg" role="group" aria-label="Show">${['Waiting', 'Used', 'Expired', 'All'].map((s) => html`<button data-show="${s}" aria-pressed="${String(ui.show === s)}">${s}${s !== 'All' ? ` · ${counts[s]}` : ''}</button>`)}</div>
        </div>
        ${rows.length ? html`<div class="table-wrap" style="margin-top:8px"><table class="table">
          <thead><tr><th>Customer</th><th>Offer</th><th>Given</th><th>Expires</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows.map(({ c, status }) => html`<tr>
            <td><a class="cust" href="#/customers/${c.numericId}"><span class="cust__name">${label(c)}</span><span class="cust__sub">${sublabel(c) || c.email}</span></a></td>
            <td><div class="strong">${offerHeadline(c.offer)}</div><div class="muted small">${c.offer.templateName || 'Custom'} · ${describeOffer(c.offer).split(' · ')[0]}</div></td>
            <td class="nowrap">${c.offer.assignedAt ? ago(c.offer.assignedAt) : '—'}</td>
            <td class="nowrap">${c.offer.expiresOn ? fmtDate(c.offer.expiresOn) : 'Never'}</td>
            <td>${offerStatusChip(status)}</td>
            <td class="r nowrap"><button class="btn btn--ghost btn--sm" data-change="${c.id}">Change</button> <button class="btn btn--danger btn--sm" data-remove="${c.id}">Remove</button></td>
          </tr>`)}</tbody></table></div>` : html`<div class="empty">${icon('users')}<span>${ui.show === 'All' ? 'Nobody has a starter offer yet.' : `No ${ui.show.toLowerCase()} offers.`}</span></div>`}
      </section>
    </div>`);

  el.querySelectorAll('[data-new-template]').forEach((b) => b.addEventListener('click', () => openTemplateEditor(null)));
  el.querySelector('[data-give]').addEventListener('click', () => openGiveOffer());
  el.querySelectorAll('[data-show]').forEach((b) => b.addEventListener('click', () => { ui.show = b.dataset.show; render(el); }));
  el.querySelectorAll('[data-change]').forEach((b) => b.addEventListener('click', () => {
    const c = state.customers.get(b.dataset.change);
    openGiveOffer({ customers: [c], offer: c.offer });
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => armed(b, () => {
    const c = state.customers.get(b.dataset.remove);
    busy(b, () => removeOffer(c)).then(() => toast(`Removed ${label(c)}'s starter offer`)).catch(() => {});
  }, 'Click again to remove'));
  el.querySelectorAll('[data-template]').forEach((card) => wireTemplateCard(card));
}

export function offerStatusChip(status) {
  const map = { Waiting: 'new', Used: 'active', Expired: 'lapsed' };
  const hint = { Waiting: 'Not used yet', Used: 'They placed their order', Expired: 'Passed its expiry date' };
  return html`<span class="status status--${map[status]}" title="${hint[status]}">${status}</span>`;
}

function templateCard(t) {
  return html`<article class="offer ${t.isDefault ? 'offer--default' : ''}" data-template="${t.id}">
    <div class="row row--between">
      <strong class="strong clip">${t.name}</strong>
      ${t.isDefault ? html`<span class="badge badge--accent">Default</span>` : ''}
    </div>
    <div class="offer__off">${offerHeadline(t)}</div>
    <ul class="offer__items">${(t.items || []).map((i) => html`<li>${i.image ? html`<img class="thumb" src="${thumb(i.image)}" alt="">` : html`<span class="thumb"></span>`}<span><b>${i.quantity} ×</b> ${i.title}</span></li>`)}</ul>
    <div class="muted small">${t.expiresInDays ? `Lasts ${t.expiresInDays} days after it's given` : 'No expiry'} · ${t.autoAdd !== false ? 'Auto-adds to cart' : 'Banner only'}</div>
    <div class="row row--wrap" style="gap:6px">
      <button class="btn btn--sm" data-act="give">${icon('gift', 'i--sm')}Give</button>
      <button class="btn btn--ghost btn--sm" data-act="edit">${icon('pencil', 'i--sm')}Edit</button>
      <button class="btn btn--ghost btn--sm" data-act="copy">${icon('copy', 'i--sm')}Duplicate</button>
      ${t.isDefault ? '' : html`<button class="btn btn--ghost btn--sm" data-act="default">${icon('star', 'i--sm')}Make default</button>`}
      <button class="btn btn--ghost btn--sm" data-act="delete" aria-label="Delete ${t.name}">${icon('trash-2', 'i--sm')}</button>
    </div>
  </article>`;
}

function wireTemplateCard(card) {
  const t = state.templates.find((x) => x.id === card.dataset.template);
  const btn = (act) => card.querySelector(`[data-act="${act}"]`);
  btn('give').addEventListener('click', () => openGiveOffer({ templateId: t.id }));
  btn('edit').addEventListener('click', () => openTemplateEditor(t));
  btn('copy').addEventListener('click', () => openTemplateEditor({ ...t, id: '', isDefault: false, name: `${t.name} (copy)` }));
  if (btn('default')) btn('default').addEventListener('click', (e) => busy(e.currentTarget, () => saveTemplates(state.templates.map((x) => ({ ...x, isDefault: x.id === t.id })))).then(() => toast(`${t.name} is now the default`)).catch(() => {}));
  armed(btn('delete'), () => busy(btn('delete'), () => {
    const rest = state.templates.filter((x) => x.id !== t.id);
    if (t.isDefault && rest.length) rest[0] = { ...rest[0], isDefault: true };
    return saveTemplates(rest);
  }).then(() => toast(`Deleted ${t.name}. Customers who already have it keep it.`)).catch(() => {}), 'Delete?');
}

const thumb = (src) => (src ? src + (src.includes('?') ? '&' : '?') + 'width=80' : '');

// ---------------------------------------------------------------------------
// Shared offer fields: products + discount + expiry + message + auto-add.
// mode 'template' stores expiry as "days after it's given"; 'offer' as a date.
// ---------------------------------------------------------------------------
function offerFields(d, mode) {
  return html`
    <div class="field"><span>Products</span>
      <div data-items></div>
      <button class="btn btn--outline btn--sm" type="button" data-pick style="justify-self:start">${icon('package', 'i--sm')}Choose products</button>
    </div>
    <div class="form-row">
      <label class="field"><span>Discount</span>
        <select class="select" data-type>
          <option value="percentage" ${d.discountType !== 'fixedAmount' ? raw('selected') : ''}>% off the whole order</option>
          <option value="fixedAmount" ${d.discountType === 'fixedAmount' ? raw('selected') : ''}>£ off the whole order</option>
        </select></label>
      <label class="field"><span>Amount</span>
        <span class="input-affix"><b data-prefix></b><input class="input" type="number" min="0" step="0.01" data-value value="${d.discountValue}"><b data-suffix></b></span></label>
    </div>
    ${mode === 'template'
      ? html`<label class="field"><span>Lasts for</span><span class="input-affix"><input class="input" type="number" min="0" step="1" data-days value="${d.expiresInDays || ''}" placeholder="No expiry"><b>days after it's given</b></span></label>`
      : html`<label class="field"><span>Expires (optional)</span><input class="input" type="date" data-expires value="${d.expiresOn || ''}" min="${todayISO()}"></label>`}
    <label class="field"><span>Message on the site</span><input class="input" type="text" maxlength="120" data-message value="${d.message || ''}"></label>
    <label class="check"><input type="checkbox" data-autoadd ${d.autoAdd !== false ? raw('checked') : ''}><span>Put the products in their cart automatically on their next visit <span class="muted">(otherwise the banner just offers them)</span></span></label>`;
}

function wireOfferFields(root, d) {
  const $ = (s) => root.querySelector(s);
  const syncUnit = () => {
    const fixed = $('[data-type]').value === 'fixedAmount';
    $('[data-prefix]').textContent = fixed ? '£' : '';
    $('[data-suffix]').textContent = fixed ? '' : '%';
  };
  $('[data-type]').addEventListener('change', syncUnit);
  syncUnit();
  const renderItems = () => {
    const box = $('[data-items]');
    box.innerHTML = d.items.length ? String(html`<div class="list">${d.items.map((item, i) => html`
      <div class="list__item">
        ${item.image ? html`<img class="thumb" src="${thumb(item.image)}" alt="">` : html`<span class="thumb"></span>`}
        <span class="list__main clip">${item.title}</span>
        <input class="input input--sm num" style="width:72px" type="number" min="1" step="1" value="${item.quantity}" data-qty="${i}" aria-label="Quantity of ${item.title}">
        <button class="btn btn--ghost btn--icon" type="button" data-drop="${i}" aria-label="Remove ${item.title}">${icon('x', 'i--sm')}</button>
      </div>`)}</div>`) : String(html`<p class="muted small" style="margin:0">No products yet.</p>`);
    box.querySelectorAll('[data-qty]').forEach((input) => input.addEventListener('input', () => { d.items[Number(input.dataset.qty)].quantity = Number(input.value); }));
    box.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => { d.items.splice(Number(b.dataset.drop), 1); renderItems(); }));
  };
  $('[data-pick]').addEventListener('click', async () => {
    // Pre-select what's chosen (grouped by product, as the picker expects)
    // so re-opening it adds to or trims the list; quantities survive.
    const byProduct = new Map();
    d.items.forEach((item) => {
      if (!item.productId) return;
      if (!byProduct.has(item.productId)) byProduct.set(item.productId, []);
      byProduct.get(item.productId).push({ id: item.variantId });
    });
    const selection = await shopify.resourcePicker({
      type: 'product', action: 'select', multiple: true,
      filter: { variants: true, draft: false, archived: false },
      selectionIds: [...byProduct].map(([id, variants]) => ({ id, variants })),
    });
    if (!selection) return;
    const qty = new Map(d.items.map((i) => [i.variantId, i.quantity]));
    d.items = selection.flatMap((p) => (p.variants || []).filter((v) => v.id).map((v) => ({
      productId: p.id,
      variantId: v.id,
      title: v.title && v.title !== 'Default Title' ? `${p.title} – ${v.title}` : p.title,
      image: (v.image && v.image.originalSrc) || (p.images && p.images[0] && p.images[0].originalSrc) || '',
      quantity: qty.get(v.id) || 1,
    })));
    renderItems();
  });
  renderItems();
}

function readOfferFields(root, d, mode) {
  const $ = (s) => root.querySelector(s);
  d.discountType = $('[data-type]').value;
  d.discountValue = Number($('[data-value]').value);
  d.message = $('[data-message]').value.trim();
  d.autoAdd = $('[data-autoadd]').checked;
  if (mode === 'template') d.expiresInDays = $('[data-days]').value ? Number($('[data-days]').value) : '';
  else d.expiresOn = $('[data-expires]').value;
  if (!d.items.length) return 'Choose at least one product.';
  if (d.items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1)) return 'Every product needs a whole-number quantity of at least 1.';
  if (!(d.discountValue > 0)) return 'Enter a discount above 0.';
  if (d.discountType === 'percentage' && d.discountValue > 100) return "A percentage discount can't be over 100.";
  if (mode === 'template' && d.expiresInDays !== '' && (!Number.isInteger(d.expiresInDays) || d.expiresInDays < 1)) return 'Days must be a whole number, or leave it blank for no expiry.';
  if (mode === 'offer' && d.expiresOn && d.expiresOn < todayISO()) return 'The expiry date is in the past.';
  return null;
}

// ---------------------------------------------------------------------------
// Template editor
// ---------------------------------------------------------------------------
export function openTemplateEditor(existing) {
  const d = existing ? { ...BLANK_TEMPLATE(), ...existing, items: (existing.items || []).map((i) => ({ ...i })) } : BLANK_TEMPLATE();
  if (!existing && !state.templates.length) d.isDefault = true;
  openDrawer({
    eyebrow: 'Starter offer template',
    title: d.id ? 'Edit template' : 'New template',
    body: html`<form class="form" data-form onsubmit="return false">
      <label class="field"><span>Template name</span><input class="input" type="text" maxlength="60" data-name value="${d.name}" placeholder="e.g. Gym opening order" required></label>
      ${offerFields(d, 'template')}
      <label class="check"><input type="checkbox" data-default ${d.isDefault ? raw('checked') : ''}><span>Default template <span class="muted">(picked automatically when you give an offer)</span></span></label>
      ${d.id ? html`<p class="muted small" style="margin:0">Changing a template doesn't change offers already given. Customers keep what they were promised.</p>` : ''}
    </form>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-save>${icon('check', 'i--sm')}Save template</button>`,
    onMount(api) {
      wireOfferFields(api.el, d);
      api.$('[data-save]').addEventListener('click', (e) => {
        d.name = api.$('[data-name]').value.trim();
        d.isDefault = api.$('[data-default]').checked;
        const problem = !d.name ? 'Give the template a name.' : readOfferFields(api.el, d, 'template');
        if (problem) { toast(problem, 'err'); return; }
        const saved = { id: d.id || newTemplateId(), name: d.name, isDefault: d.isDefault, items: d.items, discountType: d.discountType, discountValue: d.discountValue, message: d.message, expiresInDays: d.expiresInDays, autoAdd: d.autoAdd };
        let list = d.id ? state.templates.map((t) => (t.id === d.id ? saved : t)) : [...state.templates, saved];
        if (saved.isDefault) list = list.map((t) => ({ ...t, isDefault: t.id === saved.id }));
        else if (!list.some((t) => t.isDefault)) list[0] = { ...list[0], isDefault: true };
        busy(e.currentTarget, () => saveTemplates(list)).then(() => { toast(`Saved ${saved.name}`); api.close(); }).catch(() => {});
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Give an offer to one or many customers
// ---------------------------------------------------------------------------
export function openGiveOffer({ customers = [], templateId = '', offer = null } = {}) {
  if (!offer && !state.templates.length) {
    toast('Create a template first');
    openTemplateEditor(null);
    return;
  }
  const selected = new Map(customers.filter(Boolean).map((c) => [c.id, c]));
  let template = state.templates.find((t) => t.id === templateId) || (offer ? null : defaultTemplate());
  // Changing one customer's existing offer starts from that offer as given.
  let draft = offer ? { ...offer, items: offer.items.map((i) => ({ ...i })) } : offerFromTemplate(template);
  let choice = offer ? 'current' : template.id;

  openDrawer({
    eyebrow: 'Starter offer',
    title: offer ? 'Change starter offer' : 'Give a starter offer',
    wide: true,
    body: html`<div class="form">
      <div class="field"><span>1 · Offer</span><div class="list" data-templates></div></div>
      <details class="card" data-customise style="padding:14px 16px;box-shadow:none" ${offer ? raw('open') : ''}>
        <summary class="strong" style="cursor:pointer">Customise this offer</summary>
        <div class="form" style="margin-top:14px" data-fields></div>
      </details>
      <div class="field"><span>2 · Customers</span>
        <div data-selected></div>
        ${offer ? '' : html`<div class="input-affix">${icon('search', 'i--sm')}<input class="input" type="search" placeholder="Search customers by name, email or company" data-search></div>
        <div data-results></div>
        <button class="btn btn--ghost btn--sm" type="button" data-all-dealers style="justify-self:start">${icon('store', 'i--sm')}Add every trade account without an offer</button>`}
      </div>
      <div data-warning></div>
    </div>`,
    foot: html`<button class="btn btn--ghost" data-close>Cancel</button><button class="btn" data-give>${icon('gift', 'i--sm')}<span data-give-label>Give offer</span></button>`,
    onMount(api) {
      const renderTemplates = () => {
        const options = [
          ...(offer ? [{ id: 'current', label: 'Their current offer', sub: `${offerHeadline(offer)} · ${describeOffer(offer).split(' · ')[0]}` }] : []),
          ...state.templates.map((t) => ({ id: t.id, label: t.name, sub: `${offerHeadline(t)} · ${(t.items || []).length} product${(t.items || []).length === 1 ? '' : 's'}${t.expiresInDays ? ` · ${t.expiresInDays} days` : ''}`, isDefault: t.isDefault })),
        ];
        api.$('[data-templates]').innerHTML = String(html`${options.map((o) => html`
          <label class="list__item check" style="align-items:center">
            <input type="radio" name="tpl" value="${o.id}" ${choice === o.id ? raw('checked') : ''}>
            <span class="list__main"><span class="strong">${o.label} ${o.isDefault ? html`<span class="badge badge--accent" style="margin-left:6px">Default</span>` : ''}</span><span class="muted small">${o.sub}</span></span>
          </label>`)}`);
        api.$$('[name="tpl"]').forEach((r) => r.addEventListener('change', () => {
          choice = r.value;
          template = state.templates.find((t) => t.id === choice) || null;
          draft = choice === 'current' ? { ...offer, items: offer.items.map((i) => ({ ...i })) } : offerFromTemplate(template);
          renderFields();
        }));
      };
      const renderFields = () => {
        const box = api.$('[data-fields]');
        box.innerHTML = String(offerFields(draft, 'offer'));
        wireOfferFields(box, draft);
      };
      const renderSelected = () => {
        const list = [...selected.values()];
        api.$('[data-selected]').innerHTML = list.length ? String(html`<div class="row row--wrap" style="gap:6px">${list.map((c) => html`
          <span class="badge" style="height:30px;padding:0 6px 0 12px;font-size:11px">${label(c)}${offer ? '' : html`<button class="btn btn--ghost btn--icon" style="width:22px;min-height:22px" type="button" data-unselect="${c.id}" aria-label="Remove ${label(c)}">${icon('x', 'i--sm')}</button>`}</span>`)}</div>`)
          : String(html`<p class="muted small" style="margin:0">Nobody chosen yet.</p>`);
        api.$$('[data-unselect]').forEach((b) => b.addEventListener('click', () => { selected.delete(b.dataset.unselect); renderSelected(); }));
        const replacing = list.filter((c) => offerStatus(c) === 'Waiting').length;
        api.$('[data-warning]').innerHTML = !offer && replacing ? String(html`<div class="notice notice--warn">${icon('circle-alert')}<div>${replacing} of them already ${replacing === 1 ? 'has' : 'have'} a waiting offer. Giving this replaces it.</div></div>`) : '';
        api.$('[data-give-label]').textContent = list.length ? `${offer ? 'Save' : 'Give'} offer${list.length > 1 ? ` to ${list.length} customers` : ''}` : 'Give offer';
      };
      const search = api.$('[data-search]');
      if (search) {
        const results = api.$('[data-results]');
        search.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          if (!q) { results.innerHTML = ''; return; }
          const found = [...state.customers.values()].filter((c) => !selected.has(c.id) && `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q)).slice(0, 8);
          results.innerHTML = String(found.length ? html`<div class="list">${found.map((c) => html`
            <div class="list__item"><span class="list__main"><span class="strong clip">${label(c)}</span><span class="muted small clip">${[sublabel(c), c.email].filter(Boolean).join(' · ')}${offerStatus(c) === 'Waiting' ? ' · has a waiting offer' : ''}</span></span>
            <button class="btn btn--outline btn--sm" type="button" data-add="${c.id}">${icon('plus', 'i--sm')}Add</button></div>`)}</div>` : html`<p class="muted small">No matches.</p>`);
          results.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => { selected.set(b.dataset.add, state.customers.get(b.dataset.add)); search.value = ''; results.innerHTML = ''; search.focus(); renderSelected(); }));
        });
        api.$('[data-all-dealers]').addEventListener('click', () => {
          const dealers = [...state.customers.values()].filter((c) => isDealer(c) && !c.offer);
          dealers.forEach((c) => selected.set(c.id, c));
          toast(dealers.length ? `Added ${dealers.length} trade account${dealers.length === 1 ? '' : 's'}` : 'Every trade account already has an offer');
          renderSelected();
        });
      }
      api.$('[data-give]').addEventListener('click', (e) => {
        // Read the customise fields even while collapsed -- they hold the draft.
        const problem = readOfferFields(api.$('[data-fields]'), draft, 'offer');
        if (problem) { api.$('[data-customise]').open = true; toast(problem, 'err'); return; }
        if (!selected.size) { toast('Choose at least one customer', 'err'); return; }
        const list = [...selected.values()];
        busy(e.currentTarget, () => giveOffer(list, draft)).then(() => {
          toast(list.length === 1 ? `${label(list[0])} has a starter offer: ${offerHeadline(draft)}` : `Gave ${list.length} customers a starter offer`);
          api.close();
        }).catch(() => {});
      });
      renderTemplates();
      renderFields();
      renderSelected();
    },
  });
}
