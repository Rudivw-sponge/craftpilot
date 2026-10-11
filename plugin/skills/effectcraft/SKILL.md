---
name: effectcraft
description: EffectCraft (After Effects-like) specifics for its MCP tools (mcp__effectcraft__*). Use with the craftpilot skill for motion graphics, animated titles, keyframes and compositing.
---

# EffectCraft

Follow the `craftpilot` skill's rules. EffectCraft specifics:

- **Flow**:
  1. `command_run comp.new`.
  2. `command_run layer.newText` or `layer.newSolid`, which returns the layer id.
  3. `set_property` and `add_keyframe`.
  4. `command_run effect.apply`.
  5. `render_preview` to look at the result.
- **Inspect**: `doc_inspect`, `get_project`, `get_comp` and `get_layer`. Every property node
  carries its `path`, e.g. `transform/position` or `effects/#1/blurriness`. Use those paths
  with `get_property` and `set_property`.
- **Times are seconds.**
- **Check motion at several times**: render frames at the start, the middle and the end of an
  animation, not just one.
- **Confinement**: file paths in commands must be absolute paths inside the project folder.
  Scripts (`run_script`), and in live mode the clicking and typing tools, are refused while
  confined. Use engine commands instead.
- **Headless work is in memory** until `save_project`, so save to the project folder before
  you finish.
