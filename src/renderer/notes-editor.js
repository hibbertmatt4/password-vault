'use strict';
// Formatted notes (bold, sizes, highlight, colours, lists, alignment, tables).
//
// Editing uses the browser's own editing commands, so undo / redo just work. The page's security policy
// blocks inline style="" attributes, so the few things those commands write as styles (highlight, alignment)
// are drawn by matching rules in styles.css instead (see ".rich").
//
// Everything that is saved, pasted in, or arrives from another computer goes through sanitize(): only the
// tags, attributes and values below survive, rebuilt from scratch, so a note can never carry scripts,
// pictures, links or anything else.
(function () {
  const SIZES = [
    ['Small', '2'],
    ['Normal', '3'],
    ['Large', '4'],
    ['Larger', '5'],
    ['Huge', '6'],
  ];
  // Highlight colours: the exact text Chromium writes for each, which styles.css matches.
  const HIGHLIGHTS = [
    ['Yellow', '#fff176', 'rgb(255, 241, 118)'],
    ['Green', '#b9f6ca', 'rgb(185, 246, 202)'],
    ['Blue', '#b3e5fc', 'rgb(179, 229, 252)'],
    ['Pink', '#f8bbd0', 'rgb(248, 187, 208)'],
    ['Orange', '#ffcc80', 'rgb(255, 204, 128)'],
  ];
  const COLOURS = [
    ['Automatic', '#2f3b28'],
    ['Red', '#c0392b'],
    ['Orange', '#d35400'],
    ['Green', '#2e7d32'],
    ['Blue', '#1e5fa8'],
    ['Purple', '#7b3fa0'],
    ['Grey', '#7a7a7a'],
  ];
  const HIGHLIGHT_BY_RGB = new Map(HIGHLIGHTS.map((h) => [h[2], h]));
  const ALIGN = ['center', 'right', 'justify'];
  const MAX_HTML = 8 * 1024 * 1024; // pictures make notes bigger
  const MAX_PICTURE = 3 * 1024 * 1024;
  // Pictures are stored inside the note itself; nothing is ever loaded from the internet.
  const PICTURE_SRC = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;
  const PICTURE_SIZES = ['s', 'm', 'l'];
  const MAX_NODES = 20000;

  // tag → what it becomes (anything not listed is unwrapped: its text is kept, the tag is dropped)
  const TAGS = {
    P: 'p', DIV: 'div', BR: 'br', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's',
    SPAN: 'span', FONT: 'font', UL: 'ul', OL: 'ol', LI: 'li', TABLE: 'table', THEAD: 'tbody', TBODY: 'tbody', TFOOT: 'tbody',
    TR: 'tr', TD: 'td', TH: 'td', H1: 'p', H2: 'p', H3: 'p', H4: 'p', H5: 'p', H6: 'p', BLOCKQUOTE: 'div', PRE: 'div',
    SUB: 'sub', SUP: 'sup', IMG: 'img',
    MARK: 'mark', // only as a hidden section (data-secret); a plain <mark> is just its contents
  };
  // dropped with everything inside them
  const DROP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META', 'LINK', 'SVG', 'MATH', 'NOSCRIPT', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'FORM', 'XML']);
  const BLOCKS = new Set(['p', 'div', 'li', 'td']);
  const HEADING_SIZE = { H1: '6', H2: '5', H3: '4' };

  const styleOf = (el) => (el.getAttribute('style') || '').toLowerCase();
  const hexColour = (v) => {
    v = String(v || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((c) => c + c).join('');
    const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(v);
    return m ? '#' + m.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('') : null;
  };

  /** Clean any HTML (pasted, saved, or from another computer). Returns safe HTML. */
  function sanitize(html) {
    const src = new DOMParser().parseFromString(String(html || '').slice(0, MAX_HTML * 2), 'text/html').body;
    const out = document.createElement('div');
    let count = 0;
    const walk = (from, to, depth) => {
      for (const n of from.childNodes) {
        if (++count > MAX_NODES) return;
        if (n.nodeType === 3) {
          to.appendChild(document.createTextNode(n.nodeValue));
          continue;
        }
        if (n.nodeType !== 1) continue; // comments etc.
        const name = n.tagName.toUpperCase();
        if (DROP.has(name)) continue;
        const tag = TAGS[name];
        if (!tag || depth > 40) {
          walk(n, to, depth + 1);
          continue;
        }
        if (tag === 'img') {
          const src = n.getAttribute('src') || '';
          if (src.length <= MAX_PICTURE * 1.4 && PICTURE_SRC.test(src)) {
            const img = document.createElement('img');
            img.setAttribute('src', src);
            const size = n.getAttribute('data-size');
            img.setAttribute('data-size', PICTURE_SIZES.includes(size) ? size : 'm');
            img.setAttribute('alt', '');
            to.appendChild(img);
          }
          continue;
        }
        if (tag === 'mark' && !n.hasAttribute('data-secret')) {
          walk(n, to, depth + 1);
          continue;
        }
        const el = document.createElement(tag);
        if (tag === 'mark') el.setAttribute('data-secret', '1'); // a hidden section (shown with a Show button)
        const style = styleOf(n);
        let inner = el;
        const wrap = (t) => {
          const w = document.createElement(t);
          inner.appendChild(w);
          inner = w;
        };
        // alignment on blocks
        if (BLOCKS.has(tag)) {
          const a = /text-align:\s*(center|right|justify)/.exec(style) || [null, (n.getAttribute('align') || '').toLowerCase()];
          if (ALIGN.includes(a[1])) el.setAttribute('style', `text-align: ${a[1]};`);
        }
        // highlight (only our colours, written exactly as the editor writes them)
        if (tag === 'span') {
          const bg = /background-color:\s*(rgb\([^)]*\))/.exec(style);
          if (bg && HIGHLIGHT_BY_RGB.has(bg[1].replace(/\s+/g, '').replace(/,/g, ', '))) el.setAttribute('style', `background-color: ${bg[1].replace(/\s+/g, '').replace(/,/g, ', ')};`);
        }
        // size and text colour
        if (tag === 'font') {
          const size = n.getAttribute('size');
          if (/^[1-7]$/.test(size || '')) el.setAttribute('size', size);
          const c = hexColour(n.getAttribute('color'));
          if (c) el.setAttribute('color', c);
        }
        if (HEADING_SIZE[name]) {
          wrap('b');
          const f = document.createElement('font');
          f.setAttribute('size', HEADING_SIZE[name]);
          inner.appendChild(f);
          inner = f;
        } else if (name === 'H4' || name === 'H5' || name === 'H6' || name === 'TH') wrap('b');
        // simple styles pasted from Word / web pages
        if (/font-weight:\s*(bold|[6-9]00)/.test(style) && tag !== 'b') wrap('b');
        if (/font-style:\s*italic/.test(style) && tag !== 'i') wrap('i');
        if (/text-decoration[^;]*underline/.test(style) && tag !== 'u') wrap('u');
        if (/text-decoration[^;]*line-through/.test(style) && tag !== 's') wrap('s');
        if (tag === 'span' && !el.hasAttribute('style') && /(^|;)\s*color:/.test(style)) {
          const c = hexColour(/(?:^|;)\s*color:\s*([^;]+)/.exec(style)[1]);
          if (c && c !== '#000000') {
            const f = document.createElement('font');
            f.setAttribute('color', c);
            inner.appendChild(f);
            inner = f;
          }
        }
        if (tag === 'td') {
          // cell colour: a name (the page's security policy stops inline styles, so styles.css draws each one)
          const fill = (n.getAttribute('data-fill') || '').toLowerCase();
          if (HIGHLIGHTS.some((h) => h[0].toLowerCase() === fill)) el.setAttribute('data-fill', fill);
          for (const a of ['colspan', 'rowspan']) {
            const v = parseInt(n.getAttribute(a), 10);
            if (v > 1 && v <= 20) el.setAttribute(a, String(v));
          }
        }
        if (tag === 'br') {
          to.appendChild(el);
          continue;
        }
        walk(n, inner, depth + 1);
        // a span / font that does nothing is just its contents
        if ((tag === 'span' || tag === 'font') && !el.attributes.length) {
          while (el.firstChild) to.appendChild(el.firstChild);
          continue;
        }
        to.appendChild(el);
      }
    };
    walk(src, out, 0);
    // a table cell must be inside a row, inside a table
    for (const td of out.querySelectorAll('td')) if (!td.parentElement || td.parentElement.tagName !== 'TR') td.replaceWith(...td.childNodes);
    for (const tr of out.querySelectorAll('tr')) if (!tr.closest('table')) tr.replaceWith(...tr.childNodes);
    for (const table of out.querySelectorAll('table')) {
      for (const tr of table.querySelectorAll(':scope > tr')) {
        let body = table.querySelector(':scope > tbody');
        if (!body) body = table.appendChild(document.createElement('tbody'));
        body.appendChild(tr);
      }
      if (!table.querySelector('td')) table.remove();
    }
    for (const li of out.querySelectorAll('li')) if (!li.parentElement || !/^(UL|OL)$/.test(li.parentElement.tagName)) li.replaceWith(...li.childNodes);
    return out.innerHTML.length > MAX_HTML ? '' : out.innerHTML;
  }

  /** Plain text of formatted notes (used for search, and by older versions of the app). */
  function toText(html) {
    const root = document.createElement('div');
    root.innerHTML = sanitize(html);
    let out = '';
    const newline = () => {
      if (out && !out.endsWith('\n')) out += '\n';
    };
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeType === 1) {
          const t = c.tagName;
          if (t === 'BR') {
            // A <br> at the end of a line is only the editor's placeholder; on its own it's an empty line.
            if (c.parentElement.tagName === 'TD' && !c.nextSibling) continue; // empty cell
            const last = !c.nextSibling && c.parentElement !== root;
            if (!last || !c.previousSibling) out += '\n';
            continue;
          }
          const block = /^(P|DIV|LI|TR|TABLE|UL|OL)$/.test(t);
          if (block) newline();
          if (t === 'LI') out += c.parentElement.tagName === 'OL' ? `${[...c.parentElement.children].indexOf(c) + 1}. ` : '• ';
          walk(c);
          if (t === 'TD' && c.nextElementSibling) out += '\t';
          if (block) newline();
        }
      }
    };
    walk(root);
    return out.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  }

  /** True when the HTML has any formatting worth keeping (otherwise plain text is enough). */
  function hasFormatting(html) {
    const root = document.createElement('div');
    root.innerHTML = sanitize(html);
    return !!root.querySelector('b,i,u,s,sub,sup,font,span,ul,ol,table,img,mark,[style]');
  }

  /** Plain-text notes as editor HTML (one line per line). */
  function fromPlain(text) {
    const lines = String(text || '').split('\n');
    const div = document.createElement('div');
    for (const line of lines) {
      const p = document.createElement('div');
      if (line) p.textContent = line;
      else p.appendChild(document.createElement('br'));
      div.appendChild(p);
    }
    return div.innerHTML;
  }

  const same = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

  /**
   * The formatted notes to show for a login, or null for plain text. If an older version of the app edited
   * the plain notes since (so they no longer match), the plain text wins.
   */
  function richFor(entry) {
    if (!entry || !entry.notesHtml) return null;
    const html = sanitize(entry.notesHtml);
    return html && same(toText(html), entry.notes || '') ? html : null;
  }

  // ---------- tables ----------
  const cell = () => {
    const td = document.createElement('td');
    td.appendChild(document.createElement('br'));
    return td;
  };
  function tableHtml(rows, cols) {
    const r = `<tr>${'<td><br></td>'.repeat(cols)}</tr>`;
    return `<table><tbody>${r.repeat(rows)}</tbody></table><div><br></div>`;
  }
  function addRow(td, after) {
    const tr = td.parentElement;
    const row = document.createElement('tr');
    const cols = [...tr.children].reduce((n, c) => n + (parseInt(c.getAttribute('colspan'), 10) || 1), 0);
    for (let i = 0; i < cols; i++) row.appendChild(cell());
    tr.parentElement.insertBefore(row, after ? tr.nextSibling : tr);
    return row.firstChild;
  }
  function addColumn(td, after) {
    const table = td.closest('table');
    const index = td.cellIndex + (after ? 1 : 0);
    for (const tr of table.rows) {
      const ref = tr.cells[Math.min(index, tr.cells.length)] || null;
      tr.insertBefore(cell(), ref);
    }
  }
  function deleteRow(td) {
    const table = td.closest('table');
    td.parentElement.remove();
    if (!table.rows.length) table.remove();
  }
  function deleteColumn(td) {
    const table = td.closest('table');
    const index = td.cellIndex;
    for (const tr of [...table.rows]) {
      if (tr.cells[index]) tr.cells[index].remove();
      if (!tr.cells.length) tr.remove();
    }
    if (!table.rows.length) table.remove();
  }

  // ---------- hidden sections ----------
  /** The HTML for a hidden section holding the selected content (several lines become one section with line breaks). */
  function secretHtml(fragmentHtml) {
    const html = sanitize(fragmentHtml);
    const probe = document.createElement('div');
    probe.innerHTML = html;
    if (!probe.textContent.trim()) return null;
    for (const s of probe.querySelectorAll('[data-secret]')) s.replaceWith(...s.childNodes); // no sections inside sections
    let inner = probe.innerHTML;
    if (probe.querySelector('div,p,li,td,table,ul,ol')) {
      const t = document.createElement('div');
      t.textContent = toText(inner);
      inner = t.innerHTML.replace(/\n/g, '<br>');
    }
    return `<mark data-secret="1">${inner}</mark>`;
  }

  /**
   * Turn the hidden sections of notes shown on screen into "•••• Show" chips. While hidden, the text isn't
   * in the page at all; Show puts it back, Hide takes it away again.
   */
  function maskSecrets(root, options = {}) {
    for (const s of [...root.querySelectorAll('[data-secret]')]) {
      const real = s.innerHTML;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'secret-toggle';
      // While shown, a Copy button copies everything in this hidden part (all its lines).
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'secret-copy';
      // just the two-squares icon (a tick for a moment after copying), to keep the chip small
      const COPY_ICON =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/></svg>';
      const TICK_ICON =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
      copy.innerHTML = COPY_ICON; // fixed, trusted markup
      copy.setAttribute('aria-label', 'Copy this hidden part');
      copy.title = 'Copy';
      let copiedTimer = null;
      copy.addEventListener('click', async () => {
        if (!options.copy) return;
        await options.copy(toText(real));
        clearTimeout(copiedTimer);
        copy.innerHTML = TICK_ICON;
        copy.classList.add('copied');
        copiedTimer = setTimeout(() => {
          copy.innerHTML = COPY_ICON;
          copy.classList.remove('copied');
        }, 1400);
      });
      const body = document.createElement('span');
      let hideTimer = null; // a shown part hides itself again after the time chosen in Settings
      const render = (shown) => {
        clearTimeout(hideTimer);
        if (shown && options.autoHide) {
          const ms = options.autoHide();
          if (ms > 0) hideTimer = setTimeout(() => render(false), ms);
        }
        s.classList.toggle('secret-open', shown);
        s.classList.toggle('secret-hidden', !shown);
        if (shown) body.innerHTML = real; // already cleaned
        else body.textContent = '••••••••';
        body.className = shown ? 'secret-body' : 'secret-dots';
        toggle.textContent = shown ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', shown ? 'Hide this part of the notes' : 'Show the hidden part of the notes');
        s.replaceChildren(...(shown ? [body, copy, toggle] : [body, toggle]));
      };
      toggle.addEventListener('click', () => render(!s.classList.contains('secret-open')));
      render(false);
    }
  }

  window.RichNotes = { secretHtml, maskSecrets, SIZES, HIGHLIGHTS, COLOURS, sanitize, toText, hasFormatting, fromPlain, richFor, tableHtml, addRow, addColumn, deleteRow, deleteColumn };
})();
