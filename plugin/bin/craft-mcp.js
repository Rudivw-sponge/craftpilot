#!/usr/bin/env node
// Starts one ArtCraft app's own MCP server for Claude Code: bridged to the live
// window when the app is running with control for this project, otherwise a
// headless engine. Usage: node craft-mcp.js <app id>. CRAFTPILOT_MODE=headless
// forces headless mode.
'use strict';

const { spawn } = require('child_process');
const craft = require('../lib/craft');

(async () => {
  const app = craft.byId[process.argv[2]];
  if (!app) {
    console.error(`craft-mcp: unknown app "${process.argv[2]}" (one of ${Object.keys(craft.byId).join(', ')})`);
    process.exit(1);
  }
  const cfg = craft.loadConfig();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const live =
    process.env.CRAFTPILOT_MODE !== 'headless' &&
    Boolean(app.launchArgs) &&
    craft.samePath(cfg.launched[app.id], projectDir) &&
    (await craft.isLive(app));
  const server = craft.mcpServer(app, { live, projectDir, cfg });
  if (!server) {
    console.error(`craft-mcp: ${app.name} is not installed (set ${app.id.toUpperCase()}_HOME to its folder).`);
    process.exit(1);
  }
  console.error(`craft-mcp: ${app.name} ${live ? 'live' : 'headless'}, project ${projectDir}`);
  const child = spawn(server.command, server.args, { stdio: 'inherit', env: server.env || process.env });
  child.on('error', (e) => {
    console.error(`craft-mcp: ${e.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
})();
