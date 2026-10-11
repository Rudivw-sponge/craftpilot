'use strict';

const api = window.companion;
const $ = (id) => document.getElementById(id);
const log = $('log');
const input = $('input');

let state = null;
let busy = false;
let liveBubble = null; // assistant bubble receiving streamed text
let liveText = '';
const toolRows = new Map(); // tool_use id -> row element
const appNames = {}; // app id -> display name

// ---------- helpers ----------

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function scrollDown() {
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 160;
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function hideWelcome() {
  $('welcome').hidden = true;
}

function addBubble(role, text) {
  hideWelcome();
  const b = el('div', `msg ${role}`);
  if (role === 'assistant') b.innerHTML = window.renderMarkdown(text);
  else b.textContent = text;
  log.appendChild(b);
  log.scrollTop = log.scrollHeight;
  return b;
}

function addNote(text, cls = '') {
  hideWelcome();
  log.appendChild(el('div', `note ${cls}`, text));
  scrollDown();
}

function describeTool(name, input) {
  const m = name.match(/^mcp__([a-z]+)__(.+)$/);
  if (m && appNames[m[1]]) {
    const [, app, tool] = m;
    const who = appNames[app];
    if (tool === 'command_run' || tool === 'run_command' || tool === 'execute' || tool === 'execute_command') {
      return [who, input.id || input.command || ''];
    }
    if (tool === 'command_batch' || tool === 'batch') {
      return [who, (input.steps || []).map((s) => s.id || s.command).join(' → ')];
    }
    if (/^(command_list|list_commands)$/.test(tool)) return [who, `look up commands${input.filter ? ` “${input.filter}”` : ''}`];
    if (tool === 'tool_search') return [who, `find tool “${input.query || input.name || ''}”`];
    if (tool === 'tool_call') return [who, String(input.name || 'tool').replace(/_/g, ' ')];
    if (tool === 'window_command') return [who, input.id];
    if (/preview|render_/.test(tool)) return [who, 'preview'];
    if (/^(doc_inspect|inspect_document)$/.test(tool)) return [who, 'inspect document'];
    if (tool === 'doc_export' && input.path === '.claude-preview.png') return [who, 'render preview'];
    return [who, tool.replace(/_/g, ' ')];
  }
  if (name.startsWith('mcp__')) return [name.split('__')[1], name.split('__').slice(2).join(' ')];
  const detail = input.file_path || input.pattern || input.command || input.path || input.url || '';
  return [name, String(detail).slice(0, 120)];
}

const HIDDEN_TOOLS = new Set(['ToolSearch', 'TodoWrite']);

function addToolRow(ev) {
  if (HIDDEN_TOOLS.has(ev.name)) return;
  hideWelcome();
  const [who, what] = describeTool(ev.name, ev.input || {});
  const row = el('details', 'tool running');
  const sum = el('summary');
  sum.append(el('span', 'dot'), el('span', 'who', who), el('span', 'what', what));
  row.append(sum, el('pre', 'tool-input', JSON.stringify(ev.input, null, 2)));
  log.appendChild(row);
  toolRows.set(ev.id, row);
  scrollDown();
}

function finishToolRow(ev) {
  const row = toolRows.get(ev.id);
  if (!row) return;
  row.classList.remove('running');
  if (ev.isError) row.classList.add('failed');
  if (ev.text) row.append(el('pre', 'tool-output', ev.text));
  for (const src of ev.images || []) {
    const img = el('img', 'preview');
    img.src = src;
    img.alt = 'Preview';
    row.after(img);
  }
  scrollDown();
}

function setBusy(b) {
  busy = b;
  document.body.classList.toggle('busy', b);
  $('send').title = b ? 'Stop' : 'Send (Enter)';
}

// ---------- state ----------

let icons = {}; // app id -> data URL of the app's own icon
let iconsRequested = '';

const CHIP = {
  live: 'Live: Claude drives this window. Edits land in its undo history.',
  closed: 'Not open: Claude works on files in the background. Click to open it live.',
  'no-control': 'Open without Claude control. Save your work, close it, then click to reopen it live.',
  'other-project': 'Open for a different project folder. Close it, then click to reopen it for this project.',
  'headless-only': 'No live window: Claude edits files directly; open them in the app to look.',
};

function renderApps(apps) {
  const nav = $('apps');
  nav.replaceChildren();
  for (const a of apps) {
    appNames[a.id] = a.name;
    const chip = el('button', 'chip');
    chip.dataset.state = a.state;
    chip.title = `${a.name} (${a.like}). ${CHIP[a.state]}${a.confined ? '' : ' No folder lock: paths outside the project ask first.'}`;
    if (icons[a.id]) {
      const img = el('img', 'chip-icon');
      img.src = icons[a.id];
      img.alt = '';
      chip.append(img);
    }
    chip.append(el('span', null, a.name), el('i'));
    chip.disabled = a.state === 'headless-only' || a.state === 'live';
    chip.onclick = () => openApp(a, chip);
    nav.append(chip);
  }
  nav.hidden = !apps.length;
  // Fetch icons once per set of installed apps, then redraw with them.
  const key = apps.map((a) => a.id).join(',');
  if (key && key !== iconsRequested) {
    iconsRequested = key;
    api.getIcons().then((got) => {
      icons = got || {};
      if (state) renderApps(state.apps || []);
    });
  }
}

async function openApp(a, chip) {
  chip.disabled = true;
  chip.classList.add('opening');
  const res = await api.openApp(a.id);
  chip.classList.remove('opening');
  applyState(res.state);
  if (!res.ok && res.message) addNote(res.message, 'error');
}

function applyState(s) {
  state = s;
  $('project-name').textContent = s.projectName || 'Choose project…';
  $('project').title = s.projectDir || 'Choose project folder';
  $('pin').classList.toggle('on', s.alwaysOnTop);
  $('pin').title = s.alwaysOnTop ? 'Keeping on top (click to release)' : 'Keep on top';
  renderApps(s.apps || []);

  const needProject = !s.projectDir;
  const needKey = !needProject && !s.hasApiKey;
  if (!s.hasApiKey) info = null; // models and usage belong to the removed connection
  $('choose').hidden = !needProject;
  $('auth').hidden = !needKey && !showKeySettings;
  $('key-remove').hidden = !s.hasApiKey;
  $('key-btn').classList.toggle('on', showKeySettings);
  $('examples').hidden = needProject || needKey;
  $('welcome-text').textContent = needProject
    ? 'Pick the folder you keep this project’s files in. Claude and the apps work inside it.'
    : needKey
      ? 'Connect to Claude below to start.'
      : 'Ask Claude to work in any of the ArtCraft apps. Green apps are live: Claude sees what’s open there and edits it in front of you. Click a grey app to open it live.';
  input.disabled = needProject || needKey;
  input.placeholder = needKey ? 'Connect to Claude to start…' : 'Ask Claude…';
  $('usage-btn').hidden = !s.hasApiKey;
  if (s.hasApiKey && !info) loadInfo();
  renderPickers();
}

// ---------- connecting to Claude ----------

let showKeySettings = false;

$('key-btn').onclick = () => {
  showKeySettings = !showKeySettings;
  applyState(state);
  if (showKeySettings) $('key-input').focus();
};

$('key-form').onsubmit = async (e) => {
  e.preventDefault();
  const res = await api.setApiKey($('key-input').value);
  $('key-input').value = '';
  $('key-error').hidden = res.ok;
  if (!res.ok) {
    $('key-error').textContent = res.message;
    return;
  }
  showKeySettings = false;
  applyState(res.state);
  input.focus();
};

$('key-remove').onclick = async (e) => {
  e.preventDefault();
  showKeySettings = false;
  applyState(await api.clearApiKey());
};

async function openClaudeCode() {
  const res = await api.openClaudeCode();
  if (!res.ok) addNote(res.message, 'error');
}
$('claude-code').onclick = openClaudeCode;
$('auth-claude-code').onclick = openClaudeCode;

for (const a of document.querySelectorAll('a[data-link]')) {
  a.onclick = (e) => {
    e.preventDefault();
    api.openLink(a.dataset.link);
  };
}

// ---------- events from Claude ----------

api.onEvent((ev) => {
  switch (ev.kind) {
    case 'start': {
      setBusy(true);
      const live = (ev.context || []).filter((l) => /^[A-Za-z]+: live\b/.test(l));
      $('context').hidden = !live.length;
      $('context').textContent = live.map((l) => l.replace(': live - ', ': ').split(';')[0]).join('  ·  ');
      break;
    }
    case 'delta':
      if (!liveBubble) {
        liveBubble = addBubble('assistant', '');
        liveText = '';
      }
      liveText += ev.text;
      liveBubble.innerHTML = window.renderMarkdown(liveText);
      scrollDown();
      break;
    case 'text':
      if (liveBubble) liveBubble.innerHTML = window.renderMarkdown(ev.text);
      else addBubble('assistant', ev.text);
      liveBubble = null;
      break;
    case 'tool':
      liveBubble = null;
      addToolRow(ev);
      break;
    case 'tool_result':
      finishToolRow(ev);
      break;
    case 'error':
      addNote(ev.text, 'error');
      break;
    case 'result':
      if (ev.text) addNote(`Stopped: ${ev.text}`, 'error');
      break;
    case 'usage':
      renderUsage(ev.usage);
      break;
    case 'needs_key':
      setBusy(false);
      addNote('Connect to Claude first: add an API key, or open Claude Code to use your Claude plan.', 'error');
      showKeySettings = true;
      applyState(state);
      break;
    case 'rate_limit':
      noteRateLimit(ev.info);
      break;
    case 'end':
      liveBubble = null;
      for (const row of toolRows.values()) row.classList.remove('running');
      if (ev.stopped) addNote('Stopped.');
      setBusy(false);
      input.focus();
      break;
  }
});

api.onPermission((req) => {
  hideWelcome();
  const card = el('div', 'perm');
  const [who, what] = describeTool(req.toolName, req.input || {});
  card.append(el('div', 'perm-title', `Claude wants to use ${who}`));
  if (req.reason) card.append(el('div', 'perm-reason', req.reason));
  if (what) card.append(el('pre', 'perm-detail', what));
  const actions = el('div', 'perm-actions');
  const answer = (allow, always) => {
    api.answerPermission({ id: req.id, allow, always });
    card.classList.add('answered');
    actions.replaceWith(el('div', 'perm-answer', allow ? (always ? 'Allowed for this chat' : 'Allowed') : 'Declined'));
  };
  const allow = el('button', 'primary small', 'Allow');
  const deny = el('button', 'small', 'Deny');
  allow.onclick = () => answer(true, false);
  deny.onclick = () => answer(false, false);
  actions.append(allow);
  if (!req.reason) {
    const always = el('button', 'small', 'Always this chat');
    always.onclick = () => answer(true, true);
    actions.append(always);
  }
  actions.append(deny);
  card.append(actions);
  log.appendChild(card);
  log.scrollTop = log.scrollHeight;
  allow.focus();
});

api.onReset(() => resetLog());
api.onState(applyState);

// ---------- user actions ----------

function resetLog() {
  for (const n of [...log.children]) if (n.id !== 'welcome') n.remove();
  $('welcome').hidden = false;
  $('context').hidden = true;
  toolRows.clear();
  liveBubble = null;
}

async function submit() {
  if (busy) return api.stop();
  const text = input.value.trim();
  if (!text || !state || !state.projectDir) return;
  input.value = '';
  autosize();
  addBubble('user', text);
  setBusy(true);
  await api.send(text);
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
}

input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});
$('send').onclick = submit;
$('project').onclick = () => api.chooseProject().then(applyState);
$('choose').onclick = () => api.chooseProject().then(applyState);
$('pin').onclick = () => api.togglePin().then(applyState);
$('new-chat').onclick = async () => {
  applyState(await api.newChat());
  resetLog();
  input.focus();
};
for (const b of document.querySelectorAll('#examples button')) {
  b.onclick = () => {
    input.value = b.textContent;
    autosize();
    input.focus();
  };
}

// ---------- model, effort and usage ----------

let info = null;
const EFFORT_LABEL = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

function option(value, label, selected) {
  const o = el('option', null, label);
  o.value = value;
  o.selected = selected;
  return o;
}

function renderPickers() {
  if (!state) return;
  if (!info) {
    if (!state.hasApiKey) {
      $('model').replaceChildren(option('', 'Connect to choose a model', true));
      $('effort').replaceChildren(option('', 'Effort', true));
    }
    $('model').disabled = $('effort').disabled = true;
    return;
  }
  $('model').disabled = false;
  const model = info.models.find((m) => m.value === state.model) || info.models[0];
  $('model').replaceChildren(...info.models.map((m) => option(m.value, m.name, m === model)));
  $('model').title = `Model: ${model.description || model.name}`;
  const efforts = model.efforts;
  $('effort').replaceChildren(
    option('', efforts.length ? 'Effort: default' : 'No effort setting', !state.effort),
    ...efforts.map((e) => option(e, `Effort: ${EFFORT_LABEL[e] || e}`, e === state.effort)),
  );
  $('effort').disabled = !efforts.length;
}

$('model').onchange = async () => {
  const s = await api.setModel($('model').value);
  const model = info.models.find((m) => m.value === s.model);
  // Drop an effort the new model doesn't offer.
  applyState(s.effort && model && !model.efforts.includes(s.effort) ? await api.setEffort(null) : s);
};

$('effort').onchange = async () => {
  applyState(await api.setEffort($('effort').value || null));
  if (!$('welcome').hidden) return;
  addNote('Effort changes apply from your next message.');
};

const pct = (n) => `${Math.round(n)}%`;
const level = (n) => (n >= 90 ? 'bad' : n >= 70 ? 'warn' : '');

function resetText(iso) {
  if (!iso) return '';
  const ms = new Date(iso) - Date.now();
  if (!(ms > 0)) return 'resets now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `resets in ${mins} min`;
  if (mins < 24 * 60) return `resets in ${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `resets ${new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`;
}

function meter(label, percent, detail) {
  const row = el('div', `meter ${level(percent)}`);
  const head = el('div', 'meter-head');
  head.append(el('span', null, label), el('span', 'meter-value', pct(percent)));
  const bar = el('div', 'meter-bar');
  const fill = el('div', 'meter-fill');
  fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  bar.append(fill);
  row.append(head, bar);
  if (detail) row.append(el('div', 'meter-detail', detail));
  return row;
}

const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));

function renderUsage(u) {
  if (!u) return;
  const chip = [];
  if (u.context) chip.push(`ctx ${pct(u.context.percent)}`);
  const five = u.plan && u.plan.windows.find((w) => w.label === '5-hour');
  if (five) chip.push(`5h ${pct(five.percent)}`);
  else if (u.cost != null) chip.push(`~$${u.cost.toFixed(2)}`);
  $('usage-chip-text').textContent = chip.join(' · ') || 'Usage';
  const worst = Math.max(u.context ? u.context.percent : 0, ...((u.plan && u.plan.windows) || []).map((w) => w.percent));
  $('usage-btn').className = `usage-chip ${level(worst)}`;

  const panel = $('usage-panel');
  panel.replaceChildren();
  if (u.plan) {
    const sec = el('section', 'usage-sec');
    sec.append(el('h3', null, `Plan limits${u.plan.type ? ` · ${u.plan.type[0].toUpperCase()}${u.plan.type.slice(1)}` : ''}`));
    for (const w of u.plan.windows) sec.append(meter(w.label, w.percent, resetText(w.resetsAt)));
    if (u.plan.extra) {
      const e = u.plan.extra;
      sec.append(el('div', 'meter-detail', `Extra usage on${e.utilization != null ? `: ${pct(e.utilization)} of monthly limit used` : ''}`));
    }
    panel.append(sec);
  }
  if (u.context) {
    const sec = el('section', 'usage-sec');
    sec.append(el('h3', null, 'Context window'));
    sec.append(meter('This chat', u.context.percent, `${tokens(u.context.used)} of ${tokens(u.context.max)} tokens · start a new chat (+) to reset`));
    panel.append(sec);
  }
  if (u.cost != null || u.modelUsage) {
    const sec = el('section', 'usage-sec');
    sec.append(el('h3', null, 'This chat'));
    if (u.cost != null) {
      sec.append(
        el(
          'div',
          'usage-line',
          `${u.cost > 0 && u.cost < 0.01 ? '< $0.01' : `≈ $${u.cost.toFixed(2)}`} estimated, billed to your Anthropic API account`,
        ),
      );
    }
    for (const [model, m] of Object.entries(u.modelUsage || {})) {
      sec.append(
        el(
          'div',
          'usage-line muted',
          `${model}: ${tokens(m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens)} in (${tokens(m.cacheReadInputTokens)} cached) · ${tokens(m.outputTokens)} out`,
        ),
      );
    }
    panel.append(sec);
  }
  if (!panel.children.length) panel.append(el('div', 'usage-line muted', 'Usage appears after your first message.'));
}

function noteRateLimit(r) {
  if (!r || r.status === 'allowed') return;
  const which = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet', overage: 'extra usage' }[r.rateLimitType] || 'usage';
  const when = r.resetsAt ? ` It resets ${resetText(new Date(r.resetsAt * 1000).toISOString()).replace(/^resets /, '')}.` : '';
  addNote(
    r.status === 'rejected'
      ? `You've reached your ${which} limit.${when}`
      : `You've used ${r.utilization != null ? pct(r.utilization * (r.utilization <= 1 ? 100 : 1)) : 'most'} of your ${which} limit.${when}`,
    r.status === 'rejected' ? 'error' : 'warn',
  );
}

$('usage-btn').onclick = async () => {
  const panel = $('usage-panel');
  panel.hidden = !panel.hidden;
  $('usage-btn').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) renderUsage(await api.getUsage().catch(() => null));
};

// Models and usage need a connection to Claude, so they load once an API key is set.
let infoLoading = false;
async function loadInfo() {
  if (infoLoading) return;
  infoLoading = true;
  try {
    info = await api.getInfo();
    renderPickers();
    api.getUsage().then(renderUsage).catch(() => {});
  } catch (e) {
    $('model').replaceChildren(option('', 'Models unavailable', true));
    addNote(`Couldn't connect to Claude: ${e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error');
  } finally {
    infoLoading = false;
  }
}

api.getState().then((s) => {
  applyState(s);
  input.focus();
});
