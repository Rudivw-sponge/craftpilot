---
description: Open an ArtCraft app (PhotoCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, LightCraft, PdfCraft) with live control for this project
argument-hint: "<app> [file to open]"
allowed-tools: Bash(node:*)
---

The user asked to open: $ARGUMENTS

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/launch-app.js" <app> "$PWD" [file]` with the app name
lower-cased, and the file only if one was given. For example, for
`/craftpilot:open VectorCraft logo.svg` run
`node "${CLAUDE_PLUGIN_ROOT}/bin/launch-app.js" vectorcraft "$PWD" logo.svg`.

Report the result in one line. If the app is now open with live control, tell the user to run
`/mcp` and reconnect that app's server, so it switches from headless to the live window.
