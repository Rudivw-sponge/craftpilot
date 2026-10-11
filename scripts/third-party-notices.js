#!/usr/bin/env node
// Regenerates THIRD_PARTY_NOTICES.md from package-lock.json: every production
// package that ships inside the built app, with its version and licence.
// Run after changing dependencies: node scripts/third-party-notices.js
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

const rows = [];
for (const [p, meta] of Object.entries(lock.packages)) {
  if (!p || meta.dev) continue;
  if (p.includes('claude-agent-sdk-')) continue; // the SDK's Claude Code binary is excluded from builds
  let license = meta.license;
  try {
    license = license || JSON.parse(fs.readFileSync(path.join(root, p, 'package.json'), 'utf8')).license;
  } catch {}
  rows.push([p.replace(/^.*node_modules\//, ''), meta.version, license || 'unknown']);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
const electron = lock.packages['node_modules/electron'].version;

const md = `# Third-party notices

CraftPilot is released under the MIT licence (see \`LICENSE\`). It includes or depends on the
third-party software and assets listed here, each under its own terms.

## Bundled in the Windows app

### Electron ${electron}

The app runs on [Electron](https://github.com/electron/electron) (MIT). Electron includes Chromium
and other components; their licences ship with every build as \`LICENSE.electron.txt\` and
\`LICENSES.chromium.html\` next to the executable.

### Claude Agent SDK

[\`@anthropic-ai/claude-agent-sdk\`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
is © Anthropic PBC, all rights reserved. Its use is governed by Anthropic's
[legal agreements](https://code.claude.com/docs/en/legal-and-compliance), including the Commercial
Terms of Service. The SDK's own copy of Claude Code is **not** included in CraftPilot's builds;
CraftPilot runs the copy of Claude Code the user has installed.

### App icons

The ArtCraft app icons in \`assets/app-icons/\` are © ArtCraft Team and contributors, used under the
MIT licence; see \`assets/app-icons/README.md\` and the licence texts in that folder. No ArtCraft
trademarks (the ArtCraft name, wordmark or mark) are used.

### npm packages

These ship inside the app (\`resources/app.asar\`), each with its own licence file.

| Package | Version | Licence |
|---|---|---|
${rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} |`).join('\n')}

## Used at runtime, not bundled

- **Claude Code**: Anthropic's CLI, installed by the user. CraftPilot starts it through the Agent
  SDK, and in a terminal for the Claude plan route.
- **The ArtCraft apps** (PhotoCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, LightCraft,
  PdfCraft): installed by the user. CraftPilot starts their own command-line tools and MCP servers.
  They are open-source software (MIT or Apache-2.0) by the ArtCraft Team and contributors.
`;

fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), md);
console.log(`THIRD_PARTY_NOTICES.md: ${rows.length} packages`);
