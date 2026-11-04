// A small "what you see is what you get" editor for email text. You type and
// format normally (B / I / U buttons, or Ctrl+B / Ctrl+I / Ctrl+U); behind the
// scenes the text is kept in the simple form the trade server understands:
// **bold**, *italics*, __underline__, a new line per line and a blank line
// between paragraphs. Pasted text comes in plain, so nobody pastes in fonts
// or colours from Word or a website.
import { html } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const BOLD = /\*\*(?=\S)([^*\n]*?\S)\*\*/g;
const UNDER = /__(?=\S)([^_\n]*?\S)__/g;
const ITALIC = /(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g;

/** Stored text -> editor HTML (one line per block). */
function toHtml(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => {
    const inner = esc(line).replace(BOLD, '<b>$1</b>').replace(UNDER, '<u>$1</u>').replace(ITALIC, '$1<i>$2</i>');
    return `<div>${inner || '<br>'}</div>`;
  }).join('');
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE', 'UL', 'OL']);

/** Editor HTML -> stored text. */
function toText(root) {
  const lines = [''];
  const add = (s) => { lines[lines.length - 1] += s; };
  const newLine = () => lines.push('');
  const walk = (node, marks) => {
    if (node.nodeType === Node.TEXT_NODE) { add(node.nodeValue.replace(/ /g, ' ')); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if (tag === 'BR') { newLine(); return; }
    const st = node.style || {};
    const bold = tag === 'B' || tag === 'STRONG' || Number(st.fontWeight) >= 600 || st.fontWeight === 'bold';
    const ital = tag === 'I' || tag === 'EM' || st.fontStyle === 'italic';
    const und = tag === 'U' || String(st.textDecoration || st.textDecorationLine || '').includes('underline');
    const open = [bold && !marks.b ? '**' : '', und && !marks.u ? '__' : '', ital && !marks.i ? '*' : ''].filter(Boolean);
    const block = BLOCK.has(tag) && node !== root;
    // A block starts on its own line (unless we're already at the start of one).
    if (block && lines[lines.length - 1] !== '') newLine();
    const startLine = lines.length - 1;
    const start = lines[startLine].length;
    const inner = { b: marks.b || bold, i: marks.i || ital, u: marks.u || und };
    node.childNodes.forEach((c) => walk(c, inner));
    if (open.length) {
      // Wrap only what this element added, and only if it stayed on one line with some text.
      const end = lines.length - 1;
      if (end === startLine) {
        const line = lines[end];
        const seg = line.slice(start);
        if (seg.trim()) {
          const lead = seg.match(/^\s*/)[0]; const trail = seg.match(/\s*$/)[0];
          const m = open.join('');
          const close = [...open].reverse().join('');
          lines[end] = line.slice(0, start) + lead + m + seg.trim() + close + trail;
        }
      }
    }
    if (block && lines[lines.length - 1] !== '') newLine();
  };
  root.childNodes.forEach((c) => walk(c, {}));
  // Each top-level block ended with a fresh empty line; an empty block is a blank line.
  let text = lines.join('\n');
  text = text.replace(/\n$/, '');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/** Toolbar + editable area. Pair with mountRichText. */
export function richTextShell({ label = 'Email', rows = 12 } = {}) {
  return html`<div class="rte-wrap">
    <div class="rte-bar" role="toolbar" aria-label="Formatting">
      <button type="button" class="rte-btn" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed="false"><b>B</b></button>
      <button type="button" class="rte-btn" data-cmd="italic" title="Italics (Ctrl+I)" aria-label="Italics" aria-pressed="false"><i>I</i></button>
      <button type="button" class="rte-btn" data-cmd="underline" title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed="false"><u>U</u></button>
      <span class="rte-hint small muted">Select text and press B, I or U. Press Enter twice to start a new paragraph.</span>
    </div>
    <div class="rte" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${label}" spellcheck="true" style="min-height:${rows * 1.55}em"></div>
  </div>`;
}

/**
 * Brings the editor to life. `text` is the stored text; `onChange(text)` runs
 * on every edit. Returns { getText, setText, insert, focus }.
 */
export function mountRichText(wrap, text, { onChange = () => {} } = {}) {
  const ed = wrap.querySelector('.rte');
  const btns = [...wrap.querySelectorAll('[data-cmd]')];
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); document.execCommand('styleWithCSS', false, false); } catch (err) { /* older browsers */ }
  ed.innerHTML = toHtml(text);
  const changed = () => onChange(toText(ed));
  const syncButtons = () => {
    if (!ed.contains(document.getSelection()?.anchorNode)) return;
    btns.forEach((b) => { let on = false; try { on = document.queryCommandState(b.dataset.cmd); } catch (err) { on = false; } b.setAttribute('aria-pressed', String(on)); });
  };
  btns.forEach((b) => {
    // mousedown, not click: keeps the text selection in the editor.
    b.addEventListener('mousedown', (e) => { e.preventDefault(); ed.focus(); document.execCommand(b.dataset.cmd); syncButtons(); changed(); });
  });
  ed.addEventListener('input', changed);
  ed.addEventListener('keyup', syncButtons);
  ed.addEventListener('mouseup', syncButtons);
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, plain);
  });
  // An empty editor still needs a line to type into.
  ed.addEventListener('focus', () => { if (!ed.innerHTML.trim()) ed.innerHTML = '<div><br></div>'; });
  let lastRange = null;
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) lastRange = sel.getRangeAt(0).cloneRange();
  });
  return {
    getText: () => toText(ed),
    setText: (t) => { ed.innerHTML = toHtml(t); changed(); },
    /** Types text where the cursor was last (e.g. a {field}). */
    insert: (t) => {
      ed.focus();
      if (lastRange) { const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(lastRange); }
      document.execCommand('insertText', false, t);
      changed();
    },
    focus: () => ed.focus(),
  };
}

export const _test = { toHtml };
