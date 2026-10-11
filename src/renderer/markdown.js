// Minimal, escape-first Markdown for chat bubbles: code blocks, inline code,
// bold/italic, links, headings, lists and paragraphs. No raw HTML passes through.
'use strict';

(function () {
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function inline(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  function render(md) {
    const out = [];
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let para = [];
    let list = null;
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        flushPara();
        flushList();
        const body = [];
        while (++i < lines.length && !/^```/.test(lines[i])) body.push(lines[i]);
        out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.*)/);
      const ul = line.match(/^\s*[-*]\s+(.*)/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (h) {
        flushPara();
        flushList();
        out.push(`<h4>${inline(h[2])}</h4>`);
      } else if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push((ul || ol)[1]);
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    return out.join('');
  }

  window.renderMarkdown = render;
})();
