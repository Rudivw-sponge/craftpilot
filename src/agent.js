// Runs one long-lived Claude session (Agent SDK, streaming input) in the project
// folder with every installed ArtCraft app's MCP server attached. Servers stay up
// between messages, so headless documents survive from one message to the next.
// When an app goes live (or closes), only that app's server is swapped.
'use strict';

const fs = require('fs');
const path = require('path');
const craft = require('../plugin/lib/craft');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

// Tools that run without asking: the apps themselves (with a path check for the
// apps that have no folder lock) and read-only file tools.
const AUTO_ALLOW = new Set(['Read', 'Glob', 'Grep', 'TodoWrite', 'ToolSearch']);

// The Claude Code executable to run. The packaged app doesn't ship the SDK's own copy
// (~260 MB), so prefer the user's installed Claude Code, which also holds their login.
// Order: CLAUDE_CODE_PATH, the native installer's location, PATH, the SDK's copy.
let claudePath;
function claudeExecutable() {
  if (claudePath !== undefined) return claudePath;
  const os = require('os');
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'claude.exe' : 'claude';
  const candidates = [process.env.CLAUDE_CODE_PATH, path.join(os.homedir(), '.local', 'bin', exe)];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe));
  try {
    const pkg = require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    candidates.push(path.join(path.dirname(pkg), exe).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
  } catch {}
  claudePath = candidates.find((p) => p && fs.existsSync(p)) || null;
  return claudePath;
}

// 'default' (or nothing) means "let Claude Code pick", which the SDK expresses as undefined.
const modelOption = (model) => (model && model !== 'default' ? model : undefined);

// A session that never receives a message: enough to answer control requests
// (models, account, plan usage) before the first chat message, with no MCP servers.
const IDLE_PROMPT = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };

function skillText(name) {
  try {
    return fs.readFileSync(path.join(SKILLS_DIR, name, 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
  } catch {
    return '';
  }
}

// Absolute or parent-relative paths in a tool's input that leave the project folder.
function pathsOutside(input, projectDir) {
  const found = [];
  const root = path.resolve(projectDir).toLowerCase();
  const walk = (v) => {
    if (typeof v === 'string') {
      const looksLikePath = /^[a-zA-Z]:[\\/]|^\\\\|^\/|^~[\\/]|(^|[\\/])\.\.([\\/]|$)/.test(v);
      if (!looksLikePath) return;
      const abs = path.resolve(projectDir, v.replace(/^~(?=[\\/])/, require('os').homedir())).toLowerCase();
      if (abs !== root && !abs.startsWith(root + path.sep)) found.push(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(input);
  return found;
}

// An async iterable the SDK reads user messages from; we push one per turn.
class Inbox {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }
  push(item) {
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

class Agent {
  constructor({ emit, askPermission, getApiKey }) {
    this.getApiKey = getApiKey; // () => string | null, the user's Anthropic API key
    this.emit = emit; // (event) => void
    this.askPermission = askPermission; // async ({toolName, input, reason}) => {allow, always}
    this.sessionId = null;
    this.q = null;
    this.inbox = null;
    this.sessionKey = null;
    this.servers = {};
    this.turnDone = null;
    this.busy = false;
    this.stopping = false;
    this.alwaysAllowed = new Set();
  }

  // The environment for Claude Code: the user's API key and no other Anthropic
  // credentials, so the panel never falls back to a Claude plan sign-in. Setting the
  // key is not enough on its own: Claude Code still uses a stored claude.ai login if
  // it finds one, so it gets a config folder of its own, which holds no login.
  // Null when no key is set, in which case the panel doesn't start Claude at all.
  authEnv() {
    const key = this.getApiKey && this.getApiKey();
    if (!key) return null;
    const env = { ...process.env, ANTHROPIC_API_KEY: key, CLAUDE_CONFIG_DIR: path.join(craft.CONFIG_DIR, 'claude-code') };
    for (const name of ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']) {
      delete env[name];
    }
    return env;
  }

  reset() {
    this.closeSession();
    this.sessionId = null;
    this.alwaysAllowed.clear();
    this.lastCost = null;
    this.lastModelUsage = null;
  }

  closeSession() {
    if (this.inbox) this.inbox.close();
    if (this.q) {
      try {
        this.q.close();
      } catch {}
    }
    this.q = null;
    this.inbox = null;
    this.sessionKey = null;
    this.servers = {};
    this.finishTurn();
  }

  async stop() {
    if (!this.busy || !this.q) return;
    this.stopping = true;
    try {
      await this.q.interrupt();
    } catch {
      this.closeSession();
    }
  }

  finishTurn() {
    const done = this.turnDone;
    this.turnDone = null;
    if (done) done();
  }

  async send(text) {
    if (this.busy) return;
    const cfg = craft.loadConfig();
    if (!cfg.projectDir) return this.emit({ kind: 'error', text: 'Choose a project folder first.' });
    const states = await craft.appStates(cfg);
    if (!states.length) return this.emit({ kind: 'error', text: 'No ArtCraft apps are installed.' });
    if (!this.authEnv()) return this.emit({ kind: 'needs_key' });
    if (!claudeExecutable()) {
      return this.emit({
        kind: 'error',
        text: 'Claude Code isn\'t installed. Install it (https://claude.com/product/claude-code), then restart this app.',
      });
    }

    this.busy = true;
    this.stopping = false;
    try {
      const servers = {};
      for (const s of states) {
        servers[s.id] = craft.mcpServer(craft.byId[s.id], { live: s.state === 'live', projectDir: cfg.projectDir, cfg });
      }
      const context = await this.contextBlock(states);
      await this.ensureSession(cfg, servers, states);

      const prompt = `<craft_context>\n${context.join('\n')}\n</craft_context>\n\n${text}`;
      const turn = new Promise((r) => (this.turnDone = r));
      this.emit({ kind: 'start', apps: states, context });
      this.inbox.push({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null });
      await turn;
    } catch (e) {
      this.emit({ kind: 'error', text: e.message || String(e) });
    } finally {
      this.busy = false;
      this.emit({ kind: 'end', stopped: this.stopping });
      this.stopping = false;
    }
  }

  async contextBlock(states) {
    const lines = [];
    for (const s of states) {
      if (s.state === 'live') {
        const snap = await craft.snapshot(craft.byId[s.id]);
        lines.push(`${s.name}: live${snap ? ` - ${snap.join('; ')}` : ''}`);
      } else {
        const why = {
          'headless-only': 'headless (no live window for this app)',
          closed: 'headless (not open)',
          'no-control': 'headless (open without Claude control, so its window cannot be driven)',
          'other-project': 'headless (open for a different project folder)',
        }[s.state];
        lines.push(`${s.name}: ${why}`);
      }
    }
    return lines;
  }

  async ensureSession(cfg, servers, states) {
    // The model can change mid-session (setModel); effort can't, so a new effort
    // starts a new session that resumes the same conversation.
    const key = JSON.stringify([cfg.projectDir, cfg.effort || null]);
    if (this.q && this.sessionKey === key) {
      const changed = Object.keys({ ...servers, ...this.servers }).filter(
        (k) => JSON.stringify(servers[k]) !== JSON.stringify(this.servers[k]),
      );
      if (changed.length) {
        // Drop the changed servers, then add them back with their new settings.
        const kept = Object.fromEntries(Object.entries(servers).filter(([k]) => !changed.includes(k)));
        await this.q.setMcpServers(kept);
        const res = await this.q.setMcpServers(servers);
        this.reportServerErrors(res && res.errors);
        this.servers = servers;
      }
      return;
    }

    this.closeSession();
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const inbox = new Inbox();
    const installed = states.map((s) => s.id);
    const append = [
      skillText('craftpilot'),
      ...installed.map((id) => skillText(id)),
      '\n## This session\n',
      'You are chatting with the user in a panel docked beside their ArtCraft apps.',
      `Project folder: ${cfg.projectDir}`,
      `Installed apps: ${states.map((s) => s.name).join(', ')}.`,
      'Each user message starts with a <craft_context> block saying which apps are live (driving the user\'s open window) or headless, and what is open in each live app.',
      'If the user expects to watch an app that is headless, tell them to press its Open button in the panel.',
      'Keep replies short: the panel is narrow.',
    ].join('\n');

    const q = query({
      prompt: inbox,
      options: {
        cwd: cfg.projectDir,
        resume: this.sessionId || undefined,
        model: modelOption(cfg.model),
        effort: cfg.effort || undefined,
        includePartialMessages: true,
        permissionMode: 'default',
        settingSources: ['user', 'project', 'local'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append },
        mcpServers: servers,
        canUseTool: (toolName, input) => this.canUseTool(toolName, input),
        pathToClaudeCodeExecutable: claudeExecutable() || undefined,
        env: this.authEnv(),
        stderr: (data) => console.error('[claude]', data.trimEnd()),
      },
    });
    this.q = q;
    this.inbox = inbox;
    this.sessionKey = key;
    this.servers = servers;

    (async () => {
      try {
        for await (const msg of q) this.handle(msg);
      } catch (e) {
        if (this.q === q && !this.stopping) this.emit({ kind: 'error', text: e.message || String(e) });
      } finally {
        if (this.q === q) {
          this.q = null;
          this.inbox = null;
          this.sessionKey = null;
          this.servers = {};
        }
        this.finishTurn();
      }
    })();
  }

  // Switch model: immediately in a running session, otherwise from the next session.
  async setModel(model) {
    if (this.q) await this.q.setModel(modelOption(model));
  }

  // Runs fn(query) against the live session, or against a short-lived idle one
  // (no MCP servers, no settings) when there isn't a session yet.
  async withQuery(fn) {
    if (this.q) return fn(this.q);
    const env = this.authEnv();
    if (!env) throw new Error('Add your Anthropic API key to start.');
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const cfg = craft.loadConfig();
    const q = query({
      prompt: IDLE_PROMPT,
      options: {
        cwd: cfg.projectDir || require('os').homedir(),
        settingSources: [],
        permissionMode: 'default',
        pathToClaudeCodeExecutable: claudeExecutable() || undefined,
        env,
      },
    });
    try {
      return await fn(q);
    } finally {
      q.close();
    }
  }

  // Models and account, for the pickers. Fetched once; the list rarely changes.
  async info() {
    if (!this.infoCache) {
      this.infoCache = this.withQuery(async (q) => {
        const [models, account] = await Promise.all([q.supportedModels(), q.accountInfo().catch(() => ({}))]);
        return {
          models: models.map((m) => ({
            value: m.value,
            name: m.displayName,
            description: m.description,
            efforts: m.supportedEffortLevels || [],
          })),
          plan: account.subscriptionType || null,
          provider: account.apiProvider || null,
        };
      }).catch((e) => {
        this.infoCache = null;
        throw e;
      });
    }
    return this.infoCache;
  }

  // Context window use, plan limits and session totals. Each part is optional:
  // plan limits only exist for claude.ai logins, and the usage call is experimental.
  async usage() {
    return this.withQuery(async (q) => {
      const out = { cost: this.lastCost, modelUsage: this.lastModelUsage, rateLimit: this.lastRateLimit };
      const [ctx, plan] = await Promise.all([
        this.q ? q.getContextUsage({ detail: 'summary' }).catch(() => null) : null,
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }).catch(() => null),
      ]);
      if (ctx) out.context = { used: ctx.totalTokens, max: ctx.maxTokens, percent: ctx.percentage, model: ctx.model };
      if (plan && plan.rate_limits_available && plan.rate_limits) {
        const rl = plan.rate_limits;
        const win = (label, w) => (w && w.utilization != null ? { label, percent: w.utilization, resetsAt: w.resets_at } : null);
        out.plan = {
          type: plan.subscription_type,
          windows: [
            win('5-hour', rl.five_hour),
            win('Weekly', rl.seven_day),
            win('Weekly (Opus)', rl.seven_day_opus),
            win('Weekly (Sonnet)', rl.seven_day_sonnet),
            ...(rl.model_scoped || []).map((m) => win(`Weekly (${m.display_name})`, m)),
          ].filter(Boolean),
          extra: rl.extra_usage && rl.extra_usage.is_enabled ? rl.extra_usage : null,
        };
      }
      return out;
    });
  }

  reportServerErrors(errors) {
    for (const [name, err] of Object.entries(errors || {})) {
      const app = craft.byId[name];
      this.emit({ kind: 'error', text: `${app ? app.name : name} connection failed: ${err}` });
    }
  }

  async canUseTool(toolName, input) {
    const allow = { behavior: 'allow', updatedInput: input };
    const m = toolName.match(/^mcp__([a-z]+)__/);
    const app = m && craft.byId[m[1]];
    let reason = null;
    if (app) {
      if (app.confined) return allow;
      const outside = pathsOutside(input, craft.loadConfig().projectDir);
      if (!outside.length) return allow;
      reason = `${app.name} has no folder lock, and this uses a path outside the project folder: ${outside.join(', ')}`;
    } else if (AUTO_ALLOW.has(toolName) || this.alwaysAllowed.has(toolName)) {
      return allow;
    }
    const answer = await this.askPermission({ toolName, input, reason });
    if (answer.allow && answer.always && !app) this.alwaysAllowed.add(toolName);
    return answer.allow ? allow : { behavior: 'deny', message: 'The user declined this action.' };
  }

  handle(msg) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.sessionId = msg.session_id;
          for (const s of msg.mcp_servers || []) {
            if (craft.byId[s.name] && s.status !== 'connected' && s.status !== 'pending') {
              this.emit({ kind: 'error', text: `${craft.byId[s.name].name} connection: ${s.status}` });
            }
          }
        }
        break;
      case 'stream_event': {
        if (msg.parent_tool_use_id) break; // subagent chatter
        const ev = msg.event;
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          this.emit({ kind: 'delta', text: ev.delta.text });
        }
        break;
      }
      case 'assistant': {
        if (msg.parent_tool_use_id) break;
        for (const block of msg.message.content || []) {
          if (block.type === 'text') this.emit({ kind: 'text', text: block.text });
          else if (block.type === 'tool_use') {
            this.emit({ kind: 'tool', id: block.id, name: block.name, input: block.input });
          }
        }
        break;
      }
      case 'user': {
        const content = msg.message && msg.message.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type !== 'tool_result') continue;
          const parts = Array.isArray(block.content) ? block.content : [{ type: 'text', text: String(block.content ?? '') }];
          const images = parts
            .filter((p) => p.type === 'image' && p.source && p.source.type === 'base64')
            .map((p) => `data:${p.source.media_type};base64,${p.source.data}`);
          const textOut = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
          this.emit({ kind: 'tool_result', id: block.tool_use_id, isError: Boolean(block.is_error), images, text: textOut.slice(0, 2000) });
        }
        break;
      }
      case 'rate_limit_event':
        this.lastRateLimit = msg.rate_limit_info;
        this.emit({ kind: 'rate_limit', info: msg.rate_limit_info });
        break;
      case 'result':
        // total_cost_usd is a running total for the session (an API-price estimate).
        this.lastCost = msg.total_cost_usd;
        this.lastModelUsage = msg.modelUsage;
        this.emit({
          kind: 'result',
          isError: msg.is_error,
          cost: msg.total_cost_usd,
          text: msg.subtype === 'success' || this.stopping ? null : msg.subtype.replace(/_/g, ' '),
        });
        this.finishTurn();
        this.usage()
          .then((u) => this.emit({ kind: 'usage', usage: u }))
          .catch(() => {});
        break;
    }
  }
}

module.exports = { Agent, pathsOutside, claudeExecutable };
