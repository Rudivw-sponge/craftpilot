---
name: lightcraft
description: LightCraft (Lightroom-like) specifics for its MCP tools (mcp__lightcraft__*). Use with the craftpilot skill for photo libraries, raw development, presets, culling and batch photo exports.
---

# LightCraft

Follow the `craftpilot` skill's rules. LightCraft specifics:

- **Library**: in live mode you are working in the user's real photo library. Ratings, flags,
  albums, deletions and develop settings all persist.
  - Ask before deleting photos, emptying Recently Deleted, moving originals, or changing many
    photos at once.
  - Develop edits are non-destructive, so they are safer.
- **Photos have integer ids**, and most editing acts on the *active* photo. Tools that take
  an `id` make that photo active first.
- **Loop**:
  1. `query_photos`.
  2. `select_photos`, or pass an `id`.
  3. `list_controls`.
  4. `set_develop {values: {"light.exposure": 0.5}}`.
  5. `render_preview` to look at the result.
  6. `export`.
- **Positions** (crop rectangles, mask points, brush strokes) are normalized 0..1 image
  coordinates, with the origin at the top-left.
- **Headless mode** starts with an empty in-memory session. `import` photos from the project
  folder first, and remember that headless edits aren't saved to the user's library.
- **No folder lock**: keep `import` and `export` paths inside the project folder.
