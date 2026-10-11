#!/usr/bin/env node
// Opens an ArtCraft app with live control for a project folder, so Claude's MCP
// server for that app can drive its window.
// Usage: node launch-app.js <app id> [projectDir] [fileToOpen]
'use strict';

const path = require('path');
const craft = require('../lib/craft');

(async () => {
  const app = craft.byId[String(process.argv[2] || '').toLowerCase()];
  if (!app) {
    console.log(`Name an app: ${Object.keys(craft.byId).join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  if (!app.launchArgs) {
    console.log(`${app.name} has no live connection. Claude edits its files directly; open them in ${app.name} yourself to look.`);
    return;
  }
  const projectDir = path.resolve(process.argv[3] || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const file = process.argv[4] && path.resolve(projectDir, process.argv[4]);
  const cfg = { ...craft.loadConfig(), projectDir };
  const [state] = (await craft.appStates(cfg)).filter((s) => s.id === app.id);

  if (!state) {
    console.log(`${app.name} is not installed.`);
    process.exitCode = 1;
  } else if (state.state === 'live') {
    console.log(`${app.name} is already open with live control for ${projectDir}.`);
  } else if (state.state === 'other-project') {
    console.log(`${app.name} is open with live control for ${cfg.launched[app.id] || 'another folder'}. Close it and run this again to switch it to this project.`);
  } else if (state.state === 'no-control') {
    console.log(`${app.name} is open without live control. Save your work, close it, then run this again.`);
    process.exitCode = 1;
  } else {
    craft.launchApp(app, { projectDir, file, cfg });
    const ok = await craft.waitForLive(app);
    console.log(ok ? `${app.name} is open with live control for ${projectDir}.` : `${app.name} started, but live control did not come up within 30 s.`);
    if (!ok) process.exitCode = 1;
  }
})();
