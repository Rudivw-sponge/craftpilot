---
name: filmcraft
description: FilmCraft (Premiere Pro-like) specifics for its MCP tools (mcp__filmcraft__*). Use with the craftpilot skill for video editing, timelines, clips, transitions and exports.
---

# FilmCraft

Follow the `craftpilot` skill's rules. FilmCraft specifics:

- **Inspect**: `doc_inspect` (project and active sequence), `project_inspect` or
  `sequence_inspect`. They return the item, clip and track ids that commands need.
- **Time** is in ticks, 254016000000 per second. Commands also accept `seconds`, `frame` or
  `timecode`, which are easier to get right.
- **Media**: `media_import` brings files from the project folder into the project.
- **Verify**: `render_frame` at a given time, or `render_preview`. In live mode these
  screenshot the Program monitor.
- **Export**: run the `file.exportMedia` command with an output path inside the project folder.
  Long exports run as jobs.
- **No folder lock**: FilmCraft can read and write any path, so keep every path inside the
  project folder.
- **Live-only tools**: `ui_elements` lists clickable ids, and `ui_click`, `ui_drag` and
  `ui_key` operate the window. Prefer commands, and use these only when there is no command
  for the job.
