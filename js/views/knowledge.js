// Knowledge base: the articles the agent answers customer questions from.
// One article per topic (prices, delivery, the starter offer…), grouped by
// category. Switch an article off and the agent stops using it.
import { html, raw, icon, toast, openDrawer, busy, armed, loadingBlock, ago } from '../ui.js';
import { knowledgeState, loadKnowledge, saveKnowledge, newArticleId, CATEGORIES } from '../knowledge.js';

const ui = { q: '', error: '', loading: null };

function load(el) {
  ui.loading = loadKnowledge().catch((err) => { ui.error = err.message; })
    .finally(() => { ui.loading = null; if (location.hash.startsWith('#/knowledge')) render(el); });
}

export function render(el) {
  if (!knowledgeState.loaded && !ui.error) {
    el.innerHTML = String(html`<div class="page">${loadingBlock('Loading the knowledge base…')}</div>`);
    if (!ui.loading) load(el);
    return;
  }
  if (ui.error) { el.innerHTML = String(html`<div class="page"><div class="notice notice--err">${icon('circle-alert')}<div>${ui.error}</div></div></div>`); return; }

  const all = knowledgeState.articles;
  const q = ui.q.trim().toLowerCase();
  const shown = all.filter((x) => !q || [x.title, x.category, x.body].some((v) => String(v || '').toLowerCase().includes(q)));
  const cats = [...new Set([...CATEGORIES, ...all.map((x) => x.category).filter(Boolean)])].filter((c) => shown.some((x) => (x.category || 'Other') === c))
    .concat(shown.some((x) => !x.category) ? ['Other'] : []);
  const on = all.filter((x) => x.active !== false).length;

  el.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Agent</p><h1 class="h1">Knowledge base</h1>
          <p class="muted" style="margin:4px 0 0">What the agent knows when it answers customers. ${on} of ${all.length} article${all.length === 1 ? '' : 's'} switched on.</p></div>
        <div class="page-head__actions row row--wrap">
          <input class="input input--sm" type="search" placeholder="Search articles" value="${ui.q}" data-q aria-label="Search articles" style="width:220px">
          <button class="btn" data-new>${icon('plus', 'i--sm')}New article</button>
        </div>
      </div>
      ${!knowledgeState.saved ? html`<div class="notice notice--info">${icon('info')}<div><strong>These are starter articles</strong>, written from your prices and past dealer emails. Check them, then save to switch the knowledge base on. Until then the agent uses the old facts box.
        <div style="margin-top:8px"><button class="btn btn--sm" data-saveall>${icon('check', 'i--sm')}Save and use these articles</button></div></div></div>` : ''}
      <p class="muted small" style="margin:0 0 4px">The agent only answers from articles that are switched on. It quotes prices and offers exactly as written here, never offers anything marked discontinued, and flags anything not covered to you.</p>
      ${cats.length ? cats.map((c) => html`
        <section class="card card--flush">
          <div class="card__head" style="padding:16px 20px 0"><h2 class="h2">${c}</h2></div>
          <div class="list" style="padding:8px 8px 12px">${shown.filter((x) => (x.category || 'Other') === c).map((x) => html`
            <button type="button" class="list__item kb-item" data-open="${x.id}">
              <span class="list__main"><span class="strong">${x.title || 'Untitled'}</span>
                <span class="small muted clip">${String(x.body || '').replace(/\s+/g, ' ').slice(0, 140)}</span></span>
              ${x.active === false ? html`<span class="badge">Off</span>` : html`<span class="badge badge--cyan">Agent uses</span>`}
            </button>`)}</div>
        </section>`) : html`<section class="card empty">${icon('book-open')}<strong class="strong">No articles match</strong></section>`}
    </div>`);

  const qi = el.querySelector('[data-q]');
  qi.addEventListener('input', () => { ui.q = qi.value; const pos = qi.selectionStart; render(el); const again = el.querySelector('[data-q]'); again.focus(); again.setSelectionRange(pos, pos); });
  el.querySelector('[data-new]').addEventListener('click', () => openEditor(el, null));
  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openEditor(el, all.find((x) => x.id === b.dataset.open))));
  const sa = el.querySelector('[data-saveall]');
  if (sa) sa.addEventListener('click', () => busy(sa, () => saveKnowledge(knowledgeState.articles)).then(() => { toast('Knowledge base saved and switched on'); render(el); }).catch(() => {}));
}

function openEditor(el, article) {
  const isNew = !article;
  const x = article ? { ...article } : { id: newArticleId(), category: CATEGORIES[0], title: '', body: '', active: true };
  openDrawer({
    title: isNew ? 'New article' : 'Edit article', eyebrow: 'Knowledge base', wide: true,
    body: html`<div class="form">
      <label class="field"><span>Title</span><input class="input" data-title value="${x.title}" placeholder="e.g. Delivery times"></label>
      <label class="field"><span>Category</span><input class="input" data-cat value="${x.category || ''}" list="kb-cats">
        <datalist id="kb-cats">${CATEGORIES.map((c) => html`<option value="${c}"></option>`)}</datalist></label>
      <label class="field"><span>Article</span><textarea class="textarea" data-body rows="14" style="line-height:1.55" placeholder="Write it as plain facts. The agent quotes prices and offers exactly as written.">${x.body}</textarea></label>
      <label class="check"><input type="checkbox" data-active ${x.active !== false ? raw('checked') : ''}><span>The agent uses this article</span></label>
      ${x.updatedAt ? html`<p class="muted small" style="margin:0">Last saved ${ago(x.updatedAt)}</p>` : ''}
    </div>`,
    foot: html`${isNew ? '' : html`<button class="btn btn--ghost" data-del>${icon('trash-2', 'i--sm')}Delete</button>`}<button class="btn" data-save>${icon('check', 'i--sm')}Save article</button>`,
    onMount: (d) => {
      d.$('[data-save]').addEventListener('click', (e) => {
        const next = { ...x, title: d.$('[data-title]').value.trim(), category: d.$('[data-cat]').value.trim(), body: d.$('[data-body]').value.trim(), active: d.$('[data-active]').checked, updatedAt: new Date().toISOString() };
        if (!next.title || !next.body) { toast('Give it a title and some text', 'err'); return; }
        const list = knowledgeState.articles.filter((y) => y.id !== next.id);
        const at = knowledgeState.articles.findIndex((y) => y.id === next.id);
        list.splice(at >= 0 ? at : list.length, 0, next);
        busy(e.currentTarget, () => saveKnowledge(list)).then(() => { toast('Article saved'); d.close(); render(el); }).catch(() => {});
      });
      const del = d.$('[data-del]');
      if (del) armed(del, () => busy(del, () => saveKnowledge(knowledgeState.articles.filter((y) => y.id !== x.id)))
        .then(() => { toast('Article deleted'); d.close(); render(el); }).catch(() => {}), 'Click again to delete');
    },
  });
}
