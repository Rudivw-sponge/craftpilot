# Architecture

CraftPilot connects Claude to the ArtCraft creative apps. It has two front ends that share one
library:

| Part | Path | Talks to Claude through |
|---|---|---|
| Panel app (Electron) | `src/` | The Claude Agent SDK, with the user's Anthropic API key |
| Claude Code plugin | `plugin/` | Claude Code itself, signed in however the user chooses |
| Shared library | `plugin/lib/` | n/a: the app registry, config, launching, control clients |

```
Panel (Electron) ──► Claude Agent SDK ──► Claude Code ─┐
                                                       ├─► one MCP server per app ──► app window (live)
Claude Code + plugin ──► bin/craft-mcp.js <app> ───────┘                         └─► headless engine
```

## The apps and their interfaces

Each ArtCraft app ships:

- **An MCP server**, started with `<app>-cli mcp`. It runs **headless** (an engine inside the
  CLI) or **bridged** to a running window.
- **A control channel** for its window, started with `<app> --control <port>`. It speaks JSON
  lines over loopback TCP. The panel reads context from it, and the MCP bridges use it.

How each app is driven is defined in `plugin/lib/apps.js`:

| App | Port | Live MCP | Headless MCP | Folder lock | Context source |
|---|---|---|---|---|---|
| PhotoCraft | 7878 | `--bridge 127.0.0.1:P --control-token-file T` + roots | roots | both modes | `document.inspect` |
| VectorCraft | 7979 | `--connect 127.0.0.1:P` (the app enforces its launch roots) | `--headless` + roots | yes | `ui.inspect`, `document.inspect` |
| DesignCraft | 7981¹ | `--connect P` | none | no | `ui.inspect`, `document.inspect` |
| EffectCraft | 9877 | `--bridge P` + roots | roots | yes, by the CLI | `ui.inspect`, `comp.info` |
| FilmCraft | 9876 | `--bridge 127.0.0.1:P` | none | no | `sequence.inspect` |
| LightCraft | 7980 | `--compact --connect 127.0.0.1:P` | `--compact` | no | `ui.inspect`, `photo.inspect` |
| PdfCraft | control file² | proxy, see below | `--root <project> --compact` | yes | `pdfcraft-cli ui … state` |

"Roots" means `--automation-read-root` and `--automation-write-root`, both set to the project
folder.

¹ DesignCraft's documented default port, 7979, clashes with VectorCraft's.
² PdfCraft picks a random port and writes `{pid, port, token}` to the control file.

Each entry in `apps.js` provides:

- `launchArgs`: how to start the app with live control.
- `mcpArgs`: the MCP server's arguments for live and headless mode.
- `confined`: whether the app can be locked to the project folder.
- `context` or `snapshot`: a short summary of what is open, for Claude.

## App state

`craft.appStates()` reports one state per installed app:

| State | Meaning |
|---|---|
| `live` | The control channel is up, and CraftPilot launched the app for the current project |
| `other-project` | The control channel is up, but the app was launched for another folder or by someone else |
| `no-control` | The app is running without a control channel |
| `closed` | The app isn't running |
| `headless-only` | The app has no live mode |

**Polling:**

- **Control channels:** checked every 2.5 s. A loopback connect costs about 2 ms.
- **Process list:** used only to tell `closed` from `no-control`. It is cached for 30 s because
  starting `tasklist` costs about 280 ms of CPU on Windows, and the cache is cleared whenever the
  app launches something.

**Launch records:** `config.launched` remembers which project each app was launched for. That
is how a running app is known to be locked to the current folder.

## The panel's Claude session

`src/agent.js` keeps one long-running Agent SDK `query()`, fed through a streaming input queue:

- **Persistent servers:** MCP servers stay up between messages, so headless documents persist
  for the whole chat.
- **App state changes:** when an app goes live or closes, only that app's server is swapped. The
  changed server is removed with `setMcpServers`, then added back.
- **Model:** a model change calls `query.setModel()`, so the session continues.
- **Effort:** effort is fixed per session, so changing it starts a new session that `resume`s the
  same conversation.
- **Context:** each message starts with a `<craft_context>` block saying which apps are live or
  headless, and what is open in each live app.
- **System prompt:** the plugin's skills are appended to the Claude Code system prompt.

### Authentication

- **API key only:** the panel uses the user's Anthropic API key. It is encrypted with Electron
  `safeStorage` (DPAPI on Windows) in `%APPDATA%\CraftPilot\api-key.bin`.
- **The environment Claude Code gets:**
  - `ANTHROPIC_API_KEY` set to the user's key.
  - Other Anthropic credential variables removed.
  - **`CLAUDE_CONFIG_DIR`** pointing to `%APPDATA%\CraftPilot\claude-code`. This is required:
    with only the key set, Claude Code still uses a claude.ai login stored in the user's normal
    config folder. With a config folder that holds no login, the key is the only credential.
- **No key:** the panel starts no Claude process at all.
- **Claude plans:** people with a Claude plan use the plugin route instead. The panel's
  **Open in Claude Code** button runs the installed `claude` with `--plugin-dir` in the project
  folder, in Windows Terminal when available.

### Permissions

`canUseTool` decides each tool call:

- **App tools:** allowed, except that calls to apps without a folder lock (DesignCraft,
  FilmCraft, LightCraft) ask first when any argument is a path outside the project folder.
  `pathsOutside()` in `agent.js` checks absolute paths, `..`, UNC paths and `~`.
- **Read-only tools:** `Read`, `Glob`, `Grep`, `TodoWrite` and `ToolSearch` are allowed.
- **Everything else:** shows a permission card. The user can allow it once, allow it for the
  chat, or deny it.

### Usage

- **Context window:** `getContextUsage({detail: 'summary'})`.
- **Cost and tokens:** the running `total_cost_usd` and `modelUsage` from each `result` message.
- **Rate limits:** `rate_limit_event` messages, shown as warnings in the chat.
- **Plan windows:** the SDK's experimental usage call, which only applies to plan sign-ins, is
  wrapped in `catch` and hidden when it is unavailable.

## PdfCraft window proxy

- **The problem:** PdfCraft's MCP server edits files but can't touch its window.
- **The window channel:** PdfCraft has a separate window-control channel
  (`pdfcraft --control <file>`), driven by `pdfcraft-cli ui --control <file> <method>`.
- **The proxy:** `plugin/bin/pdfcraft-live-mcp.js` runs PdfCraft's MCP server and passes all
  traffic through.
  - It adds `window_state`, `window_open`, `window_command` and `window_screenshot` to
    `tools/list`, and handles calls to them itself.
  - It adds a note to the server's `initialize` instructions.
  - `window_open` refuses paths outside the project folder.
- **Running it:** inside the panel it runs on Electron's built-in Node (`ELECTRON_RUN_AS_NODE=1`),
  so Node.js doesn't need to be installed.

## Packaging

`npm run dist` (electron-builder) produces a per-user NSIS installer and a portable exe.

- **Claude Code isn't bundled:** the SDK's own copy (`@anthropic-ai/claude-agent-sdk-<platform>`,
  about 260 MB) is excluded. `claudeExecutable()` uses the installed Claude Code, looking at
  `CLAUDE_CODE_PATH`, then `~/.local/bin`, then `PATH`, then the SDK's copy when present.
- **Unpacked plugin:** `plugin/**` is unpacked from `app.asar`, because the app starts its
  scripts as separate processes and passes the plugin folder to Claude Code. Paths into
  `app.asar` are rewritten to `app.asar.unpacked`.
- **Releases:** `.github/workflows/release.yml` builds on `windows-latest` and attaches the
  executables to a GitHub Release when a `v*` tag is pushed.

## Configuration

Settings live in `%APPDATA%\CraftPilot` (override with `CRAFTPILOT_DIR`):

| File | Contents |
|---|---|
| `config.json` | Project folder, model, effort, panel pin, install overrides, launch records |
| `api-key.bin` | The encrypted API key |
| `<app>.token`, `<app>-control.json` | Control-channel credentials for PhotoCraft and PdfCraft |
| `claude-code/` | The panel's own Claude Code configuration |

Settings from earlier versions (`artcraft-claude`, `photocraft-claude`) are read once if there
is no config yet.
