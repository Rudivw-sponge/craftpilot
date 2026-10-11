// Shared helpers for driving the ArtCraft apps: shared config, finding installs,
// launching an app with live control for a project folder, its connection state,
// a client for the loopback control protocol, and the "what's open" snapshot.
// Used by both the companion app and the Claude Code plugin.
'use strict';

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { APPS, byId } = require('./apps');

const isWin = process.platform === 'win32';
const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
const CONFIG_DIR = process.env.CRAFTPILOT_DIR || path.join(appData, 'CraftPilot');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
// Settings from earlier versions, read once if there is no config yet.
const LEGACY_CONFIG_FILES = [
  path.join(appData, 'artcraft-claude', 'config.json'),
  path.join(appData, 'photocraft-claude', 'config.json'),
];

const DEFAULTS = {
  projectDir: null,
  model: null, // a value from the SDK's supportedModels(), e.g. "opus"; null = Claude Code's default
  effort: null, // low | medium | high | xhigh | max; null = the model's default
  alwaysOnTop: true,
  appDirs: {}, // appId -> folder holding <app>(.exe) and <app>-cli(.exe), when not auto-detected
  launched: {}, // appId -> project folder the running app was launched for (its automation roots)
};

function loadConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    // Carry preferences over from an earlier version. Launch records are not carried:
    // apps opened by an earlier version use its token files, so they are reopened.
    for (const file of LEGACY_CONFIG_FILES) {
      try {
        const old = JSON.parse(fs.readFileSync(file, 'utf8'));
        saved = {
          projectDir: old.projectDir || null,
          model: old.model || null,
          effort: old.effort || null,
          alwaysOnTop: old.alwaysOnTop ?? true,
          appDirs: old.appDirs || {},
        };
        break;
      } catch {}
    }
  }
  return { ...DEFAULTS, ...saved, appDirs: { ...(saved.appDirs || {}) }, launched: { ...(saved.launched || {}) } };
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

const tokenFile = (app) => path.join(CONFIG_DIR, `${app.id}.token`);
// Apps like PdfCraft pick a random port and write it (with a token) to this file.
const controlFile = (app) => path.join(CONFIG_DIR, `${app.id}-control.json`);
const exeName = (name) => (isWin ? `${name}.exe` : name);
const samePath = (a, b) => Boolean(a && b) && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

function findInstall(app, cfg = loadConfig()) {
  const env = process.env[`${app.id.toUpperCase()}_HOME`];
  const dirs = [
    cfg.appDirs[app.id],
    env,
    isWin && path.join(process.env.ProgramFiles || 'C:\\Program Files', app.folder),
    isWin && process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', app.folder),
    process.platform === 'darwin' && `/Applications/${app.folder}.app/Contents/MacOS`,
    !isWin && '/usr/local/bin',
    !isWin && '/usr/bin',
  ].filter(Boolean);
  for (const dir of dirs) {
    const cli = path.join(dir, exeName(`${app.id}-cli`));
    const gui = path.join(dir, exeName(app.id));
    if (fs.existsSync(cli)) return { dir, cli, app: fs.existsSync(gui) ? gui : null };
  }
  return null;
}

function isListening(port, timeoutMs = 400) {
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

// Whether the app's control channel is up (not yet whether it was opened for this project).
async function isLive(app) {
  if (app.controlFile) {
    try {
      const { port } = JSON.parse(fs.readFileSync(controlFile(app), 'utf8'));
      return await isListening(port);
    } catch {
      return false;
    }
  }
  return isListening(app.port);
}

// Names of the running processes, lower-cased, without ".exe". Listing processes
// costs ~280 ms of CPU on Windows (starting tasklist), and it only tells "closed"
// apart from "open without control", so the list is cached for a while.
const PROCESS_LIST_TTL_MS = 30000;
let processCache = null; // { at, promise }

function runningProcesses() {
  if (!processCache || Date.now() - processCache.at > PROCESS_LIST_TTL_MS) {
    processCache = { at: Date.now(), promise: listProcesses() };
  }
  return processCache.promise;
}

function listProcesses() {
  return new Promise((resolve) => {
    if (isWin) {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { maxBuffer: 8 << 20 }, (err, out) =>
        resolve(new Set(err ? [] : out.split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, '').replace(/\.exe$/i, '').toLowerCase()))),
      );
    } else {
      execFile('ps', ['-A', '-o', 'comm='], (err, out) =>
        resolve(new Set(err ? [] : out.split('\n').map((l) => path.basename(l.trim()).toLowerCase()))),
      );
    }
  });
}

// Connection state of every installed app for a project:
// live | other-project (running with control, launched for another folder or by
// someone else) | no-control (running without control) | closed | headless-only.
async function appStates(cfg = loadConfig()) {
  const procs = await runningProcesses();
  const states = [];
  for (const app of APPS) {
    const install = findInstall(app, cfg);
    if (!install) continue;
    let state;
    if (!app.launchArgs) state = 'headless-only';
    else if (await isLive(app)) state = samePath(cfg.launched[app.id], cfg.projectDir) ? 'live' : 'other-project';
    else state = procs.has(app.id) ? 'no-control' : 'closed';
    states.push({
      id: app.id,
      name: app.name,
      like: app.like,
      confined: app.confined,
      canLaunch: Boolean(app.launchArgs && install.app),
      exe: install.app,
      state,
    });
  }
  return states;
}

// The MCP server config for one app, live when its window is connected for this project.
function mcpServer(app, { live, projectDir, cfg = loadConfig() }) {
  const install = findInstall(app, cfg);
  if (!install) return null;
  if (live && app.liveProxy) {
    // A small Node script in front of the app's own server (see bin/). Inside
    // Electron, run it with Electron's own Node instead of needing node on PATH.
    const electron = Boolean(process.versions.electron);
    return {
      type: 'stdio',
      command: process.execPath,
      args: [
        // In a packaged app the script is unpacked next to app.asar (see "asarUnpack").
        path.join(__dirname, '..', 'bin', app.liveProxy).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`),
        '--cli', install.cli,
        '--root', projectDir,
        '--control', controlFile(app),
      ],
      ...(electron ? { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } } : {}),
    };
  }
  return {
    type: 'stdio',
    command: install.cli,
    args: app.mcpArgs({ live, port: app.port, projectDir, tokenFile: tokenFile(app) }),
  };
}

function launchApp(app, { projectDir, file, cfg = loadConfig() }) {
  const install = findInstall(app, cfg);
  if (!install || !install.app) throw new Error(`${app.name} is not installed`);
  if (!app.launchArgs) throw new Error(`${app.name} has no live connection; Claude edits its files directly`);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (app.controlFile) fs.rmSync(controlFile(app), { force: true }); // the app writes a fresh one
  const args = app.launchArgs({ port: app.port, projectDir, tokenFile: tokenFile(app), controlFile: controlFile(app) });
  if (file) args.push(file);
  spawn(install.app, args, { cwd: projectDir, detached: true, stdio: 'ignore' }).unref();
  processCache = null; // the app is now running
  saveConfig({ launched: { ...loadConfig().launched, [app.id]: projectDir } });
}

async function waitForLive(app, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await isLive(app)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// One connection to an app's control server (JSON lines; PhotoCraft also needs a token).
class ControlClient {
  constructor(app) {
    this.app = app;
    this.seq = 0;
    this.pending = new Map();
    this.buf = '';
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.sock = net.connect({ port: this.app.port, host: '127.0.0.1' }, resolve);
      this.sock.once('error', reject);
    });
    this.sock.on('data', (d) => this.onData(d));
    this.sock.on('error', (e) => this.failAll(e));
    this.sock.on('close', () => this.failAll(new Error(`${this.app.name} control connection closed`)));
    if (this.app.token) await this.call('auth', { token: fs.readFileSync(tokenFile(this.app), 'utf8').trim() });
    return this;
  }

  onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        continue;
      }
      const p = this.pending.get(reply.id);
      if (!p) continue;
      this.pending.delete(reply.id);
      reply.ok ? p.resolve(reply.result) : p.reject(new Error(reply.error));
    }
  }

  failAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  call(method, params = {}, timeoutMs = 5000) {
    const id = method === 'auth' ? 'auth' : ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.app.name} did not answer ${method} in time`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this.sock.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  close() {
    if (this.sock) this.sock.destroy();
  }
}

// What is open in one live app right now, as short lines, like the "current file
// and selection" an IDE integration hands Claude. Null if it can't be read.
async function snapshot(app) {
  if (app.snapshot) {
    const install = findInstall(app);
    try {
      return [].concat(await app.snapshot({ cli: install.cli, controlFile: controlFile(app) })).filter(Boolean);
    } catch {
      return null;
    }
  }
  if (!app.context) return null;
  const client = new ControlClient(app);
  try {
    await client.connect();
    const lines = await app.context(client);
    return [].concat(lines).filter(Boolean);
  } catch {
    return null;
  } finally {
    client.close();
  }
}

module.exports = {
  APPS,
  byId,
  CONFIG_DIR,
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  tokenFile,
  controlFile,
  samePath,
  findInstall,
  isListening,
  isLive,
  appStates,
  mcpServer,
  launchApp,
  waitForLive,
  ControlClient,
  snapshot,
};
