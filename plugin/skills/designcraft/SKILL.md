---
name: designcraft
description: DesignCraft (InDesign-like) specifics for its MCP tools (mcp__designcraft__*). Use with the craftpilot skill for page layout, posters, flyers and multi-page documents.
---

# DesignCraft

Follow the `craftpilot` skill's rules. DesignCraft specifics:

- **Coordinates** are points in spread space: y points down. On a single-page spread the
  page's top-left is (0,0), and a default Letter page is 612×792. On a two-page spread, the
  right page starts at x = page width.
- **Flow**:
  1. `new_document` (or use the open one).
  2. `execute frame.create {rect:[x0,y0,x1,y1], content:"text", text:"…"}`.
  3. `set_story_text` and paragraph or character styles.
  4. `place_image` for pictures.
  5. `render_page` to look at the result.
- **Commands**: `list_commands` and `execute`, or `batch` for several steps. This server
  names them differently from the other apps.
- **Inspect**: `inspect_document` lists pages, items with their ids and bounds, stories and
  styles. Check stories for **overset text**, which is text that doesn't fit its frame, and
  fix it before you call the layout done.
- **No folder lock**: DesignCraft can reach any path, so keep `open_document`,
  `save_document`, `place_image` and export paths inside the project folder.
