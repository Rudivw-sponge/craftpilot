// The ArtCraft apps this integration knows: how to launch each with live control,
// how to start its MCP server (live or headless), and how to summarise what is
// open in it for Claude. Flags come from each app's `<app>-cli mcp` usage and its
// docs/control-protocol.md.
'use strict';

const roots = (dir) => ['--automation-read-root', dir, '--automation-write-root', dir];

// Premiere-style time base FilmCraft uses for durations and the playhead.
const FILM_TICKS_PER_SECOND = 254016000000;
const secs = (ticks) => `${(ticks / FILM_TICKS_PER_SECOND).toFixed(1)} s`;
const quote = (names, max = 8) => {
  const shown = names.slice(0, max).map((n) => `"${n}"`).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown || 'none';
};
const exec = (client, command, params) => client.call('engine.execute', params ? { command, params } : { command });

function flatten(nodes, out = []) {
  for (const n of nodes || []) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

const APPS = [
  {
    id: 'photocraft',
    name: 'PhotoCraft',
    like: 'Photoshop',
    folder: 'PhotoCraft',
    port: 7878,
    token: true,
    confined: true,
    launchArgs: ({ port, projectDir, tokenFile }) => ['--control', String(port), '--control-token-file', tokenFile, ...roots(projectDir)],
    mcpArgs: ({ live, port, projectDir, tokenFile }) =>
      live
        ? ['mcp', '--bridge', `127.0.0.1:${port}`, '--control-token-file', tokenFile, ...roots(projectDir)]
        : ['mcp', ...roots(projectDir)],
    async context(client) {
      const doc = await exec(client, 'document.inspect').catch(() => null);
      if (!doc) return 'no document open';
      const layers = flatten(doc.layers);
      const selected = layers.filter((l) => l.selected).map((l) => l.name);
      return [
        `"${doc.name}", ${doc.width}×${doc.height} px, ${doc.mode} ${doc.depth}-bit`,
        `layers ${quote(layers.map((l) => l.name))}; selected ${quote(selected)}`,
        `pixel selection ${doc.hasSelection ? JSON.stringify(doc.selectionBounds) : 'none'}`,
        (doc.history || []).length ? `recent history: ${doc.history.slice(-4).join(' → ')}` : null,
      ];
    },
  },
  {
    id: 'vectorcraft',
    name: 'VectorCraft',
    like: 'Illustrator',
    folder: 'VectorCraft',
    port: 7979,
    confined: true, // the live app enforces the roots it was launched with
    launchArgs: ({ port, projectDir }) => ['--control', String(port), ...roots(projectDir)],
    mcpArgs: ({ live, port, projectDir }) =>
      live ? ['mcp', '--connect', `127.0.0.1:${port}`] : ['mcp', '--headless', ...roots(projectDir)],
    async context(client) {
      const ui = await client.call('ui.inspect');
      if (ui.activeDocument == null) return 'no document open';
      const doc = await exec(client, 'document.inspect', { depth: 1 });
      const ab = doc.artboards || [];
      return [
        `"${doc.title}"${doc.dirty ? ' (unsaved changes)' : ''}, ${ab.length} artboard(s)${ab[0] ? `, first ${ab[0].width}×${ab[0].height} ${doc.units}` : ''}, ${doc.colorMode}`,
        `layers ${quote((doc.layers || []).map((l) => l.name))}; ${doc.objects} object(s); ${(doc.selection || []).length} selected; tool ${doc.tool}`,
      ];
    },
  },
  {
    id: 'designcraft',
    name: 'DesignCraft',
    like: 'InDesign',
    folder: 'DesignCraft',
    port: 7981, // its documented default (7979) clashes with VectorCraft
    confined: false,
    launchArgs: ({ port }) => ['--control', String(port)],
    mcpArgs: ({ live, port }) => (live ? ['mcp', '--connect', String(port)] : ['mcp']),
    async context(client) {
      const ui = await client.call('ui.inspect');
      if (ui.activeDocument == null) return 'no document open';
      const doc = await client.call('document.inspect');
      const overset = (doc.stories || []).filter((s) => s.overset != null && s.overset !== false).length;
      return [
        `"${doc.title}"${doc.dirty ? ' (unsaved changes)' : ''}, ${doc.pageCount} page(s), viewing page ${(ui.currentPage ?? 0) + 1}`,
        `layers ${quote((doc.layers || []).map((l) => l.name))}; ${(doc.stories || []).length} stories${overset ? ` (${overset} overset)` : ''}; ${((doc.selection && doc.selection.items) || []).length} item(s) selected; tool ${doc.tool}`,
      ];
    },
  },
  {
    id: 'effectcraft',
    name: 'EffectCraft',
    like: 'After Effects',
    folder: 'EffectCraft',
    port: 9877,
    confined: true, // the MCP server checks every command against the roots
    launchArgs: ({ port }) => ['--control', String(port)],
    mcpArgs: ({ live, port, projectDir }) =>
      live ? ['mcp', '--bridge', String(port), ...roots(projectDir)] : ['mcp', ...roots(projectDir)],
    async context(client) {
      const ui = await client.call('ui.inspect');
      if (ui.activeComp == null) return 'no composition open';
      const comp = await exec(client, 'comp.info');
      return [
        `composition "${comp.name}", ${comp.width}×${comp.height}, ${comp.frameRate.toFixed(2)} fps, ${comp.duration.toFixed(2)} s; time ${Number(ui.time).toFixed(2)} s`,
        `layers ${quote((comp.layers || []).map((l) => l.name))}; ${(ui.selectedLayers || []).length} selected`,
      ];
    },
  },
  {
    id: 'filmcraft',
    name: 'FilmCraft',
    like: 'Premiere Pro',
    folder: 'FilmCraft',
    port: 9876,
    confined: false,
    launchArgs: ({ port }) => ['--control', String(port)],
    mcpArgs: ({ live, port }) => (live ? ['mcp', '--bridge', `127.0.0.1:${port}`] : ['mcp']),
    async context(client) {
      const seq = await exec(client, 'sequence.inspect').catch(() => null);
      if (!seq) return 'no sequence open';
      const clips = (tracks) => (tracks || []).reduce((n, t) => n + (t.items || []).length, 0);
      return [
        `sequence "${seq.name}", ${secs(seq.duration)}, playhead ${secs(seq.playhead)}`,
        `${(seq.video || []).length} video track(s) / ${clips(seq.video)} clips, ${(seq.audio || []).length} audio track(s) / ${clips(seq.audio)} clips; ${(seq.selection || []).length} selected`,
      ];
    },
  },
  {
    id: 'lightcraft',
    name: 'LightCraft',
    like: 'Lightroom',
    folder: 'LightCraft',
    port: 7980,
    confined: false,
    launchArgs: ({ port }) => ['--control', String(port)],
    // --compact hides ~360 cmd_* shortcut tools; every command stays reachable via command_run.
    mcpArgs: ({ live, port }) => (live ? ['mcp', '--compact', '--connect', `127.0.0.1:${port}`] : ['mcp', '--compact']),
    async context(client) {
      const ui = await client.call('ui.inspect');
      if (ui.active == null) return 'no photo active';
      const p = await exec(client, 'photo.inspect');
      return [
        `active photo "${p.file_name}" (id ${p.id}), ${p.width}×${p.height}, rating ${p.rating}, flag ${p.flag}${p.edited ? ', edited' : ''}`,
        `${(ui.selection || []).length} photo(s) selected`,
      ];
    },
  },
  {
    id: 'pdfcraft',
    name: 'PdfCraft',
    like: 'Acrobat',
    folder: 'PdfCraft',
    // No MCP bridge: its MCP server edits files only. The window has its own control
    // channel (random port + token in a control file), which bin/pdfcraft-live-mcp.js
    // adds to the file tools as window_* tools.
    controlFile: true,
    confined: true,
    launchArgs: ({ controlFile }) => ['--control', controlFile],
    mcpArgs: ({ projectDir }) => ['mcp', '--root', projectDir, '--compact'],
    liveProxy: 'pdfcraft-live-mcp.js',
    async snapshot({ cli, controlFile }) {
      const s = await runCli(cli, ['ui', '--control', controlFile, 'state']);
      const docs = s.documents || [];
      const active = docs.find((d) => d.active);
      if (!active) return 'no PDF open';
      return [
        `"${active.name}"${active.dirty ? ' (unsaved changes)' : ''}, ${active.pages} page(s), viewing page ${s.active ? s.active.page : '?'}`,
        docs.length > 1 ? `also open: ${quote(docs.filter((d) => !d.active).map((d) => d.name))}` : null,
      ];
    },
  },
];

function runCli(cli, args) {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) =>
    execFile(cli, args, { timeout: 5000, windowsHide: true, maxBuffer: 8 << 20 }, (err, out) => {
      if (err) return reject(err);
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    }),
  );
}

const byId = Object.fromEntries(APPS.map((a) => [a.id, a]));

module.exports = { APPS, byId };
