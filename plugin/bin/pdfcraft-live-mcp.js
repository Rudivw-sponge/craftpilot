#!/usr/bin/env node
// PdfCraft's MCP server edits PDF files but can't touch the app window. This proxy
// runs it (`pdfcraft-cli mcp --root <project>`) and adds window_* tools that drive
// a PdfCraft window started with `pdfcraft --control <file>`, through
// `pdfcraft-cli ui --control <file> <method>`. Everything else passes through.
// Usage: pdfcraft-live-mcp.js --cli <pdfcraft-cli> --root <project> --control <file>
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
};
const CLI = arg('cli');
const ROOT = path.resolve(arg('root'));
const CONTROL = arg('control');

const WINDOW_TOOLS = [
  {
    name: 'window_state',
    title: 'Window state',
    description:
      'What the live PdfCraft window shows: open documents (name, path, pages, unsaved changes), the active one, current page, mode and any open dialog.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'window_open',
    title: 'Open in window',
    description:
      'Open a PDF from the project folder in the live PdfCraft window so the user can see it. Use after doc_save to show the result. If that file is already open in the window, run window_command file.revert afterwards to reload it from disk.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'PDF path, relative to the project folder or absolute inside it.' } },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'window_command',
    title: 'Window command',
    description:
      'Run a PdfCraft app command in the live window by id, e.g. file.revert, file.save, view.fit_one_page, view.layout.two_up, edit.undo. List ids with window_command {"id": "?"}.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Command id, or "?" to list the available ids.' },
        params: { type: 'object', description: 'Optional command parameters.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'window_screenshot',
    title: 'Window screenshot',
    description: 'Screenshot of the live PdfCraft window, to check what the user sees.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];
const WINDOW_NOTE =
  ' A live PdfCraft window is connected: edit files with the doc_* and page_* tools, doc_save, then window_open the saved file so the user sees it (window_command file.revert reloads a file that is already open). window_state shows what the window has open.';

// --- pdfcraft-cli ui ---------------------------------------------------------

function ui(method, params = {}) {
  const args = ['ui', '--control', CONTROL, method];
  for (const [k, v] of Object.entries(params)) args.push(`${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { timeout: 30000, maxBuffer: 32 << 20, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim()));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

function insideRoot(p) {
  const abs = path.resolve(ROOT, p);
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`${p} is outside the project folder (${ROOT})`);
  return abs;
}

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

async function callWindowTool(name, args = {}) {
  switch (name) {
    case 'window_state': {
      const s = await ui('state');
      return text({
        documents: (s.documents || []).map((d) => ({ doc: d.doc, name: d.name, path: d.path, pages: d.pages, unsaved: d.dirty, active: d.active })),
        page: s.active ? s.active.page : null,
        mode: s.mode,
        dialog: s.dialog,
        passwordPrompt: s.password_prompt,
      });
    }
    case 'window_open':
      return text(await ui('open', { path: insideRoot(String(args.path || '')) }));
    case 'window_command': {
      if (args.id === '?') {
        const list = await ui('commands');
        const ids = (Array.isArray(list) ? list : list.commands || []).map((c) => c.id).filter(Boolean);
        return text(ids.join('\n'));
      }
      return text(await ui('command', { id: String(args.id), ...(args.params || {}) }));
    }
    case 'window_screenshot': {
      const out = path.join(os.tmpdir(), `pdfcraft-window-${process.pid}.png`);
      await new Promise((resolve, reject) =>
        execFile(CLI, ['ui', '--control', CONTROL, 'screenshot', '--out', out], { timeout: 30000, windowsHide: true }, (err, so, se) =>
          err ? reject(new Error((se || so || err.message).trim())) : resolve(),
        ),
      );
      const data = fs.readFileSync(out).toString('base64');
      fs.rmSync(out, { force: true });
      return { content: [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: 'screenshot of the live PdfCraft window' }] };
    }
  }
  throw new Error(`unknown tool ${name}`);
}

// --- proxy ---------------------------------------------------------------------

const child = spawn(CLI, ['mcp', '--root', ROOT, '--compact'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => {
  console.error(`pdfcraft-live-mcp: ${e.message}`);
  process.exit(1);
});

const pending = new Map(); // request id -> method, for the replies we rewrite
const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

function lines(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(line);
    }
  });
}

lines(process.stdin, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    child.stdin.write(line + '\n');
    return;
  }
  if (msg.method === 'tools/call' && WINDOW_TOOLS.some((t) => t.name === (msg.params && msg.params.name))) {
    callWindowTool(msg.params.name, msg.params.arguments)
      .then((result) => write({ jsonrpc: '2.0', id: msg.id, result }))
      .catch((e) => write({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: e.message }], isError: true } }));
    return;
  }
  if (msg.id != null && (msg.method === 'tools/list' || msg.method === 'initialize')) pending.set(msg.id, msg.method);
  child.stdin.write(line + '\n');
});
process.stdin.on('end', () => child.stdin.end());

lines(child.stdout, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    process.stdout.write(line + '\n');
    return;
  }
  const method = msg.id != null && pending.get(msg.id);
  if (method && msg.result) {
    pending.delete(msg.id);
    if (method === 'tools/list') msg.result.tools = [...(msg.result.tools || []), ...WINDOW_TOOLS];
    if (method === 'initialize') msg.result.instructions = (msg.result.instructions || '') + WINDOW_NOTE;
  }
  write(msg);
});
