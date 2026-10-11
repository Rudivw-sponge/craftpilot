#!/usr/bin/env node
// Checks that package.json and the plugin manifest have the same version and, if a
// tag is given (e.g. v0.3.1, or GITHUB_REF_NAME in CI), that it matches too.
// Claude Code only updates an installed plugin when its version changes, so the
// two must move together. Usage: node scripts/check-version.js [tag]
'use strict';

const path = require('path');

const root = path.join(__dirname, '..');
const app = require(path.join(root, 'package.json')).version;
const plugin = require(path.join(root, 'plugin', '.claude-plugin', 'plugin.json')).version;
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || null;

const problems = [];
if (app !== plugin) problems.push(`package.json is ${app} but plugin/.claude-plugin/plugin.json is ${plugin}`);
if (tag && /^v\d/.test(tag) && tag !== `v${app}`) problems.push(`tag ${tag} does not match version ${app} (expected v${app})`);

if (problems.length) {
  console.error(`Version check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Version ${app} is consistent${tag ? ` with tag ${tag}` : ''}.`);
