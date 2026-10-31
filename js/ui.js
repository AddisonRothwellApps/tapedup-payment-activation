// Small view toolkit: an escaping html`` template, formatters, icons, toast,
// the slide-over drawer, and the two chart forms the app uses (a column
// chart for revenue over time, a bar list for rankings).

// ---- html`` -- every interpolated value is escaped unless wrapped in raw() ----
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const part = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v));
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return new Raw(out);
}

export const icon = (name, cls = '') => raw(`<span class="i ${cls}" style="--i:url(https://cdn.jsdelivr.net/npm/lucide-static@0.544.0/icons/${name}.svg)" aria-hidden="true"></span>`);

// ---- Formatters ----
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const gbpCompact = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', notation: 'compact', maximumFractionDigits: 1 });
export const money = (n) => gbp.format(n || 0);
export const money0 = (n) => (Math.abs(n) >= 10000 ? gbpCompact : gbp0).format(n || 0);
export const moneyTick = (n) => (n >= 1000 ? gbpCompact.format(n) : gbp0.format(n));
export const count = (n) => new Intl.NumberFormat('en-GB').format(n || 0);
export const pct = (p) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`;

export const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export function ago(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  const days = Math.floor(ms / 86400000);
  if (days < 1) {
    const mins = Math.floor(ms / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
/** "today" / "tomorrow" / "in 3 days" / "2 days overdue" for a YYYY-MM-DD date. */
export function dueLabel(isoDate, today) {
  const diff = Math.round((Date.parse(`${isoDate}T12:00:00`) - Date.parse(`${today}T12:00:00`)) / 86400000);
  if (diff === 0) return { text: 'Due today', kind: 'today' };
  if (diff === 1) return { text: 'Due tomorrow', kind: '' };
  if (diff > 1) return { text: `Due in ${diff} days`, kind: '' };
  return { text: `${-diff} day${diff === -1 ? '' : 's'} overdue`, kind: 'overdue' };
}

export function trendBadge(t, { short = false } = {}) {
  if (!t) return html`<span class="trend trend--flat" title="Shown for customers who order regularly">—</span>`;
  if (t.dir === 'none') return html`<span class="trend trend--flat">—</span>`;
  if (t.dir === 'new') return html`<span class="trend trend--up">${icon('trending-up', 'i--sm')}New</span>`;
  const label = t.pct === null ? '' : pct(t.pct);
  if (t.dir === 'up') return html`<span class="trend trend--up" title="${short ? '' : 'Spend, last 90 days vs the 90 before'}">${icon('trending-up', 'i--sm')}${label}</span>`;
  if (t.dir === 'down') return html`<span class="trend trend--down" title="${short ? '' : 'Spend, last 90 days vs the 90 before'}">${icon('trending-down', 'i--sm')}${label}</span>`;
  return html`<span class="trend trend--flat">${icon('minus', 'i--sm')}${label}</span>`;
}

export function delta(cur, prev, { money: isMoney = false } = {}) {
  if (prev === null || prev === undefined) return html`<span class="faint">No earlier data to compare</span>`;
  if (!prev && !cur) return html`<span class="faint">Same as previous period</span>`;
  if (!prev) return html`<span class="trend trend--up">${icon('trending-up', 'i--sm')}New</span><span>vs ${isMoney ? money0(0) : 0} before</span>`;
  const p = (cur - prev) / prev;
  const dir = p > 0.02 ? 'up' : p < -0.02 ? 'down' : 'flat';
  const ic = dir === 'up' ? 'trending-up' : dir === 'down' ? 'trending-down' : 'minus';
  return html`<span class="trend trend--${dir}">${icon(ic, 'i--sm')}${pct(p)}</span><span>vs ${isMoney ? money0(prev) : count(prev)} before</span>`;
}

// ---- Toast ----
export function toast(text, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.className = `toast${kind === 'err' ? ' toast--err' : ''}`;
  el.textContent = text;
  clearTimeout(toast.timer);
  // Start the hide timer once it's actually shown: in a background tab the
  // frame callback waits, and a timer started now would fire first and
  // leave the toast stuck on screen.
  requestAnimationFrame(() => {
    el.classList.add('is-visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('is-visible'), kind === 'err' ? 6000 : 2800);
  });
}

// ---- Drawer: the design system's slide-over shell, used for every form ----
export function openDrawer({ title, eyebrow = '', body, foot = '', onMount, wide = false }) {
  const el = document.createElement('div');
  el.className = 'drawer';
  el.innerHTML = String(html`
    <div class="drawer__overlay" data-close></div>
    <div class="drawer__panel" role="dialog" aria-modal="true" aria-label="${title}" ${wide ? raw('style="width:min(680px,100vw)"') : ''}>
      <div class="drawer__head">
        <div>${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}<h2 class="h2">${title}</h2></div>
        <button class="btn btn--ghost btn--icon" data-close aria-label="Close">${icon('x')}</button>
      </div>
      <div class="drawer__body">${body}</div>
      ${foot ? html`<div class="drawer__foot">${foot}</div>` : ''}
    </div>`);
  const opener = document.activeElement;
  document.body.appendChild(el);
  const close = () => {
    el.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => el.remove(), 260);
    if (opener && opener.focus && opener.isConnected) opener.focus();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  requestAnimationFrame(() => {
    el.classList.add('is-open');
    const first = el.querySelector('.drawer__body input, .drawer__body select, .drawer__body textarea');
    if (first) first.focus();
  });
  const api = { el, close, $: (s) => el.querySelector(s), $$: (s) => [...el.querySelectorAll(s)] };
  if (onMount) onMount(api);
  return api;
}

/** Runs an async action from a button: disables it, shows errors as a toast. */
export async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (err) { toast(err.message || 'Something went wrong', 'err'); throw err; } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

/** Destructive buttons take two clicks instead of confirm(), which admin frames can block. */
export function armed(btn, fn, label = 'Click again to confirm') {
  btn.addEventListener('click', () => {
    if (btn.dataset.armed) { delete btn.dataset.armed; fn(); return; }
    const original = btn.innerHTML;
    btn.dataset.armed = '1';
    btn.textContent = label;
    setTimeout(() => { if (btn.isConnected && btn.dataset.armed) { delete btn.dataset.armed; btn.innerHTML = original; } }, 4000);
  });
}

// ---- Charts ----

/**
 * Column chart, single series (the card title names it, so no legend).
 * Columns <= 24px, 4px rounded tops, square at the baseline, hairline solid
 * grid, compact y ticks, the peak labelled, a per-column hover/focus tooltip
 * (textContent only), and a table view so no value is hover-only.
 */
export function columnChart(container, buckets, { format = money, tickFormat = moneyTick, height = 220, unit = 'Revenue' } = {}) {
  const W = 720, H = height, padL = 52, padR = 8, padT = 22, padB = 28;
  const max = Math.max(0, ...buckets.map((b) => b.value));
  const niceMax = niceCeil(max || 1);
  const ticks = [0, niceMax / 2, niceMax];
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const slot = innerW / Math.max(buckets.length, 1);
  const barW = Math.min(24, Math.max(4, slot - 4));
  const y = (v) => padT + innerH - (v / niceMax) * innerH;
  const peakIndex = max > 0 ? buckets.findIndex((b) => b.value === max) : -1;
  const labelEvery = Math.ceil(buckets.length / 8);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(unit)} chart">`;
  for (const t of ticks) svg += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="tick" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${esc(tickFormat(t))}</text>`;
  buckets.forEach((b, i) => {
    const cx = padL + slot * i + slot / 2;
    const top = y(b.value);
    const h = padT + innerH - top;
    const x = cx - barW / 2;
    const r = Math.min(4, h, barW / 2);
    // Rounded data-end, square baseline.
    const d = h <= 0 ? '' : `M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + innerH} Z`;
    svg += `<rect class="hit" data-i="${i}" tabindex="0" x="${padL + slot * i}" y="${padT}" width="${slot}" height="${innerH}"/>`;
    svg += d ? `<path class="bar" d="${d}"/>` : `<path class="bar" d=""/>`;
    if (i === peakIndex) svg += `<text class="peak" x="${cx}" y="${top - 6}" text-anchor="middle">${esc(tickFormat(b.value))}</text>`;
    if (i % labelEvery === 0 || i === buckets.length - 1) svg += `<text class="tick" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  svg += '</svg>';

  container.classList.add('chart');
  container.innerHTML = `${svg}<div class="tooltip" role="presentation"><strong></strong><span></span></div>
    <div class="chart-foot"><button class="btn btn--ghost btn--sm" data-table-toggle>${String(icon('list-checks', 'i--sm'))}View as table</button></div>
    <div class="table-wrap" data-table hidden></div>`;
  const tip = container.querySelector('.tooltip');
  const show = (el) => {
    const b = buckets[Number(el.dataset.i)];
    container.querySelectorAll('.bar').forEach((p) => p.classList.remove('is-hot'));
    el.nextElementSibling.classList.add('is-hot');
    tip.querySelector('strong').textContent = format(b.value);
    tip.querySelector('span').textContent = `${b.long} · ${b.count} order${b.count === 1 ? '' : 's'}`;
    const svgEl = container.querySelector('svg');
    const scale = svgEl.getBoundingClientRect().width / W;
    const col = padL + slot * Number(el.dataset.i) + slot / 2;
    tip.style.left = `${col * scale}px`;
    tip.style.top = `${Math.max(y(b.value), padT) * scale}px`;
    tip.style.display = 'block';
  };
  const hide = () => { tip.style.display = 'none'; container.querySelectorAll('.bar').forEach((p) => p.classList.remove('is-hot')); };
  container.querySelectorAll('.hit').forEach((el) => {
    el.addEventListener('pointerenter', () => show(el));
    el.addEventListener('focus', () => show(el));
    el.addEventListener('pointerleave', hide);
    el.addEventListener('blur', hide);
  });
  const tableEl = container.querySelector('[data-table]');
  container.querySelector('[data-table-toggle]').addEventListener('click', (e) => {
    tableEl.hidden = !tableEl.hidden;
    e.currentTarget.lastChild.textContent = tableEl.hidden ? 'View as table' : 'Hide table';
    if (!tableEl.hidden && !tableEl.innerHTML) {
      tableEl.innerHTML = String(html`<table class="table"><thead><tr><th>Period</th><th class="r">Orders</th><th class="r">${unit}</th></tr></thead>
        <tbody>${buckets.map((b) => html`<tr><td>${b.long}</td><td class="r">${b.count}</td><td class="r">${format(b.value)}</td></tr>`)}</tbody></table>`);
    }
  });
}

function niceCeil(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / exp;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return nice * exp;
}

/** Ranked horizontal bars in plain HTML, value at the tip. */
export function barList(rows, { value, label, format, sub }) {
  const max = Math.max(...rows.map(value), 0) || 1;
  return html`<div class="barlist">${rows.map((r) => html`
    <div class="barlist__row" title="${label(r)}: ${format(value(r))}">
      <div class="barlist__head"><span class="barlist__label clip">${label(r)}</span><span class="barlist__val"><b>${format(value(r))}</b>${sub ? html` · ${sub(r)}` : ''}</span></div>
      <div class="barlist__track"><div class="barlist__bar" style="width:${Math.max(2, (value(r) / max) * 100)}%"></div></div>
    </div>`)}</div>`;
}

export function statusChip(key, STATUS) {
  const s = STATUS[key];
  return html`<span class="status status--${key}" title="${s.hint}">${s.label}</span>`;
}

export const loadingBlock = (text, progress) => html`<div class="loading"><div class="spinner" aria-hidden="true"></div><div>${text}</div>${progress != null ? html`<div class="muted small">${progress}</div>` : ''}</div>`;

export function adminUrl(path) {
  // App Bridge turns shopify://admin links (target _top) into Shopify admin navigation.
  return `shopify://admin/${path}`;
}
