---
name: photocraft
description: PhotoCraft (Photoshop-like) specifics for its MCP tools (mcp__photocraft__*). Use with the craftpilot skill whenever the user asks to edit, retouch, adjust, create or export an image in PhotoCraft.
---

# PhotoCraft

Follow the `craftpilot` skill's rules. PhotoCraft specifics:

- **Inspect** with `doc_inspect` (layer tree, selection, history) or the
  `photocraft://document` resource.
- **Commands**: `command_list` with a `filter` such as `"curves"`, `"blur"` or
  `"layer.new"`. Run them with `command_run` or `command_batch`.
  - Adjustment layers are `layer.newAdjustmentLayer.<kind>`, e.g. `photoFilter` or `curves`.
  - Rename a layer with `layer.renameLayer`.
- **Verify**:
  - Headless: `render_preview` with `max_side` 768 renders the flattened canvas.
  - Live: `render_preview` returns a screenshot of the whole window, where the canvas is
    small. For a real look, `doc_export` to `.claude-preview.png` in the project folder
    (overwriting is fine), then `Read` it. Exporting writes a copy; the open document keeps
    its own file. `doc_export` can't create folders, so write the preview to the project
    root.
- **Saving**: `doc_save` writes native `.pcraft`, or exports by extension (`.psd`, `.png`,
  `.jpg`, `.tif`, `.webp`, …). Without a path, only a PSD, PSB or `.pcraft` document is
  written back to its own file.
- **Long jobs** (filters, Content-Aware Fill, Photomerge): pass `wait: false`, then use
  `jobs_list` and `jobs_cancel`.
- **Live-only tools**: `ui_set` (tool, zoom, brush size), `ui_menu_invoke` (without params it
  opens the command's dialog, so the user can fine-tune values themselves) and
  `ui_screenshot`.
