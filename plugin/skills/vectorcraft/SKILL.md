---
name: vectorcraft
description: VectorCraft (Illustrator-like) specifics for its MCP tools (mcp__vectorcraft__*). Use with the craftpilot skill for logos, icons, vector illustration and SVG work.
---

# VectorCraft

Follow the `craftpilot` skill's rules. VectorCraft specifics:

- **Coordinates** are points in document space: y points down, and the origin is the first
  artboard's top-left. A new document is 612×792 (Letter).
- **Drawing**: `draw_shape` and `draw_path` for geometry, `set_paint` for fill and stroke,
  `add_text` for type, `pathfinder` to combine shapes, `transform` to move, scale and rotate.
  New objects become the selection, and most commands act on the selection or on explicit
  `ids`.
- **Inspect**: `doc_inspect` or `inspect_document`. On a big document, use `{depth: 0}` and
  then read single objects (`vectorcraft://object/{id}`) instead of dumping everything.
- **Ready-made workflows**: `prompts/list` on the server.
- **Verify**: `render_preview`.
- **Saving**: `save_file` (native) and `export` (SVG, PNG, PDF, … by extension) into the
  project folder.
- Undo and redo are tools (`undo`, `redo`), and each is one step in the user's history.
