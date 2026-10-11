// CraftPilot: a chat panel docked beside the ArtCraft creative apps.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, screen, shell, safeStorage } = require('electron');
const craft = require('../plugin/lib/craft');
const { Agent, claudeExecutable } = require('./agent');

// ---------- Anthropic API key ----------
// The panel signs in to Claude with the user's own Anthropic API key, encrypted with
// the OS (DPAPI on Windows) and kept in the config folder. Claude plan users use the
// "Open in Claude Code" route instead, where they sign in to Claude Code itself.
const KEY_FILE = path.join(craft.CONFIG_DIR, 'api-key.bin');

function readApiKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(KEY_FILE)) || null;
  } catch {
    return null;
  }
}

function writeApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system.');
  fs.mkdirSync(craft.CONFIG_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, safeStorage.encryptString(key));
}

const PANEL_WIDTH = 440;
let win = null;
let permSeq = 0;
const pendingPerms = new Map();
let lastState = '';
let polling = false;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

const agent = new Agent({
  getApiKey: readApiKey,
  emit: (ev) => send('chat:event', ev),
  askPermission: ({ toolName, input, reason }) =>
    new Promise((resolve) => {
      const id = ++permSeq;
      pendingPerms.set(id, resolve);
      send('perm:ask', { id, toolName, input, reason });
    }),
});

async function getState() {
  const cfg = craft.loadConfig();
  return {
    projectDir: cfg.projectDir,
    projectName: cfg.projectDir ? path.basename(cfg.projectDir) : null,
    apps: cfg.projectDir ? await craft.appStates(cfg) : [],
    alwaysOnTop: cfg.alwaysOnTop,
    model: cfg.model || 'default',
    effort: cfg.effort || null,
    hasApiKey: fs.existsSync(KEY_FILE),
    busy: agent.busy,
  };
}

async function pushState() {
  const state = await getState();
  const key = JSON.stringify(state);
  if (key !== lastState) {
    lastState = key;
    send('state', state);
  }
  return state;
}

function createWindow() {
  const cfg = craft.loadConfig();
  const { workArea } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: workArea.x + workArea.width - PANEL_WIDTH,
    y: workArea.y,
    width: PANEL_WIDTH,
    height: workArea.height,
    minWidth: 340,
    minHeight: 400,
    title: 'CraftPilot',
    alwaysOnTop: cfg.alwaysOnTop,
    autoHideMenuBar: true,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links in Claude's replies open in the default browser, never inside the panel.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

ipcMain.handle('state:get', () => pushState());

ipcMain.handle('project:choose', async () => {
  const cfg = craft.loadConfig();
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose the project folder Claude and the ArtCraft apps will work in',
    defaultPath: cfg.projectDir || app.getPath('pictures'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!res.canceled && res.filePaths[0]) {
    craft.saveConfig({ projectDir: res.filePaths[0] });
    agent.reset();
    send('chat:reset');
  }
  return pushState();
});

ipcMain.handle('app:open', async (_e, id) => {
  const target = craft.byId[id];
  const cfg = craft.loadConfig();
  const state = (await getState()).apps.find((a) => a.id === id);
  if (!target || !state) return { ok: false, message: 'That app is not installed.', state: await pushState() };
  if (state.state === 'live') return { ok: true, state: await pushState() };
  if (state.state === 'other-project' || state.state === 'no-control') {
    return {
      ok: false,
      message:
        state.state === 'other-project'
          ? `${target.name} is open for a different project (or wasn't opened from this panel). Save your work, close ${target.name}, then press Open again.`
          : `${target.name} is open without Claude control. Save your work, close it, then press Open again.`,
      state: await pushState(),
    };
  }
  try {
    craft.launchApp(target, { projectDir: cfg.projectDir, cfg });
  } catch (e) {
    return { ok: false, message: e.message, state: await pushState() };
  }
  const ok = await craft.waitForLive(target);
  return {
    ok,
    message: ok ? null : `${target.name} started but its control connection did not come up.`,
    state: await pushState(),
  };
});

ipcMain.handle('chat:send', (_e, text) => {
  agent.send(String(text)).then(pushState);
  return pushState();
});
ipcMain.handle('chat:stop', () => agent.stop());
ipcMain.handle('chat:new', () => {
  agent.reset();
  return pushState();
});

ipcMain.handle('perm:answer', (_e, { id, allow, always }) => {
  const resolve = pendingPerms.get(id);
  if (resolve) {
    pendingPerms.delete(id);
    resolve({ allow: Boolean(allow), always: Boolean(always) });
  }
});

// Each app's icon: the official app icon in assets/app-icons (MIT/Apache, see the
// licences there), else whatever Windows shows for its .exe (cached per path).
const ICON_DIR = path.join(__dirname, '..', 'assets', 'app-icons');
const iconCache = new Map();
ipcMain.handle('icons:get', async () => {
  const out = {};
  for (const a of craft.APPS) {
    const install = craft.findInstall(a);
    if (!install || !install.app) continue;
    const bundled = path.join(ICON_DIR, `${a.id}.png`);
    if (fs.existsSync(bundled)) {
      out[a.id] = `data:image/png;base64,${fs.readFileSync(bundled).toString('base64')}`;
      continue;
    }
    if (!iconCache.has(install.app)) {
      iconCache.set(
        install.app,
        app
          .getFileIcon(install.app, { size: 'normal' })
          .then((img) => (img.isEmpty() ? null : img.toDataURL()))
          .catch(() => null),
      );
    }
    const url = await iconCache.get(install.app);
    if (url) out[a.id] = url;
  }
  return out;
});

ipcMain.handle('info:get', () => agent.info());
ipcMain.handle('usage:get', () => agent.usage());

ipcMain.handle('model:set', async (_e, model) => {
  const value = model && model !== 'default' ? String(model) : null;
  craft.saveConfig({ model: value });
  await agent.setModel(value).catch((e) => send('chat:event', { kind: 'error', text: `Model switch failed: ${e.message}` }));
  return pushState();
});

// Applies from the next message: effort is fixed per session, so the agent
// starts a new session that resumes this conversation.
ipcMain.handle('effort:set', (_e, effort) => {
  const valid = ['low', 'medium', 'high', 'xhigh', 'max'];
  craft.saveConfig({ effort: valid.includes(effort) ? effort : null });
  return pushState();
});

ipcMain.handle('auth:setKey', async (_e, key) => {
  key = String(key || '').trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return { ok: false, message: 'That doesn\'t look like an Anthropic API key (they start with "sk-ant-").' };
  }
  writeApiKey(key);
  agent.reset(); // the next session starts with the new key
  return { ok: true, state: await pushState() };
});

ipcMain.handle('auth:clearKey', async () => {
  fs.rmSync(KEY_FILE, { force: true });
  agent.reset();
  send('chat:reset'); // that conversation belonged to the removed key
  return pushState();
});

const onPath = (name) =>
  new Promise((resolve) => execFile('where', [name], (err, out) => resolve(err ? null : out.split(/\r?\n/)[0].trim() || null)));

// Opens Claude Code itself in the project folder with the CraftPilot plugin loaded:
// the route for people who use a Claude plan, which Claude Code signs in to directly.
ipcMain.handle('claude:open', async () => {
  const { projectDir } = craft.loadConfig();
  if (!projectDir) return { ok: false, message: 'Choose a project folder first.' };
  const claude = claudeExecutable();
  if (!claude) {
    return { ok: false, message: 'Claude Code isn\'t installed. Install it from https://claude.com/product/claude-code, then try again.' };
  }
  if (!(await onPath('node'))) {
    return { ok: false, message: 'The CraftPilot tools for Claude Code need Node.js 18 or newer on PATH. Install it from https://nodejs.org, then try again.' };
  }
  // In a packaged app the plugin is unpacked next to app.asar (see "asarUnpack").
  const pluginDir = path.join(__dirname, '..', 'plugin').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const opts = { detached: true, stdio: 'ignore', windowsHide: false };
  if (await onPath('wt')) {
    spawn('wt.exe', ['-d', projectDir, '--title', 'CraftPilot · Claude Code', claude, '--plugin-dir', pluginDir], opts).unref();
  } else {
    // `start` needs its own quoting, so pass the command line verbatim.
    const line = `/d /s /c "start "CraftPilot" /D "${projectDir}" "${claude}" --plugin-dir "${pluginDir}""`;
    spawn('cmd.exe', [line], { ...opts, windowsVerbatimArguments: true }).unref();
  }
  return { ok: true };
});

ipcMain.handle('link:open', (_e, url) => {
  if (/^https:\/\/(console\.anthropic\.com|claude\.com|nodejs\.org|github\.com)\//.test(String(url))) shell.openExternal(url);
});

ipcMain.handle('window:pin', () => {
  const cfg = craft.saveConfig({ alwaysOnTop: !craft.loadConfig().alwaysOnTop });
  win.setAlwaysOnTop(cfg.alwaysOnTop);
  return pushState();
});

app.whenReady().then(() => {
  createWindow();
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await pushState();
    } finally {
      polling = false;
    }
  }, 2500);
});

app.on('window-all-closed', () => {
  agent.reset();
  app.quit();
});
