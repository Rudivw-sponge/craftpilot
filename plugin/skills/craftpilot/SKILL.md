---
name: craftpilot
description: Ground rules for working in the ArtCraft apps (PhotoCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, LightCraft, PdfCraft) through their MCP servers (mcp__photocraft__*, mcp__vectorcraft__*, …). Use whenever the user asks to create, edit, inspect or export something in any of these apps, or to move work between them.
---

# Working in the ArtCraft apps

Each app has its own MCP server, named after the app. Its tools appear as `mcp__<app>__*`, and
the server's own instructions describe its tools. Pick the app that matches the job:

| App | Like | For |
|---|---|---|
| PhotoCraft | Photoshop | photos and raster images, layers, retouching |
| VectorCraft | Illustrator | logos, icons, vector illustration, SVG |
| DesignCraft | InDesign | page layout, posters, multi-page documents with text |
| EffectCraft | After Effects | motion graphics, animated titles, compositing |
| FilmCraft | Premiere Pro | video editing on a timeline |
| LightCraft | Lightroom | photo library, raw development, batch photo grading |
| PdfCraft | Acrobat | PDF pages, text and metadata; live mode can show results in its window |

## Live or headless

Each server runs in one of two modes:

- **Live**: connected to the user's open app window. Your edits appear on their screen and land
  in the app's undo history. Window tools (`ui_*`, screenshots, clicks) work.
- **Headless**: a background engine with no window. Open files, edit, save or export. Window
  tools return errors.

A `<craft_context>` block at the start of a message, when present, lists which apps are live
and what is open in each. If there is none, inspect first (`doc_inspect`, or the app's
inspect tool).

## Sharing a window with the user (live mode)

- Look before you act: inspect first, and work on what the user has open unless they ask for
  something new.
- Never close documents, discard work, or save over a file the user opened without asking.
  Save new results under new names unless told otherwise.
- Each command is one undo step. Mention that the user can undo with Ctrl+Z.
- Changes apply on the app's next frame. If an inspect looks stale right after an edit,
  inspect again.

## The loop for every app

1. **Inspect**: find what is open and the ids you need.
2. **Find the command**: `command_list` (or `list_commands`) with a filter. Read the
   parameter docs, and never guess ids or params.
3. **Act**: one command, or a batch for several steps (ordered, not atomic).
4. **Verify**: render a preview and look at it before saying you're done.

Prefer non-destructive edits: new layers, adjustment layers, masks, effects or develop settings
over changing original pixels. Name what you create clearly.

## Files and the project folder

- Work inside the project folder. PhotoCraft, VectorCraft, EffectCraft and PdfCraft refuse
  paths outside it.
- DesignCraft, FilmCraft and LightCraft have no folder lock, so keep their paths inside the
  project folder yourself. The user is asked to approve any path outside it.
- Use paths relative to the project folder where the tool accepts them, and absolute paths
  inside it otherwise.

## Moving work between apps

Apps don't share memory, so hand work over through files in the project folder. Export from
one app and open or place the file in the next. Examples:

- VectorCraft logo → export SVG or PNG → place it in DesignCraft or PhotoCraft.
- PhotoCraft image → export PNG → import it into EffectCraft or FilmCraft.
- DesignCraft layout → export PDF → check or edit its pages in PdfCraft.
