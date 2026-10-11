---
name: pdfcraft
description: PdfCraft (Acrobat-like) specifics for its MCP tools (mcp__pdfcraft__*). Use with the craftpilot skill for PDF pages, text, metadata, combining, splitting, and showing PDFs in the PdfCraft window.
---

# PdfCraft

Follow the `craftpilot` skill's rules. PdfCraft specifics:

- **Two kinds of tools**:
  - **File tools**: `doc_*`, `page_*` and `text_*`, plus anything found with `tool_search`
    and run with `tool_call`. They edit PDF files in the project folder in the background.
  - **Window tools** (live mode only): `window_state`, `window_open`, `window_command` and
    `window_screenshot`. They show results in the user's PdfCraft window.
- **The server is compact**: it lists core tools plus `tool_search` and `tool_call`. Use
  `tool_search` to find anything else.
- **Flow**:
  1. `doc_open` to get a document id.
  2. Inspect with `doc_info`, `text_extract`, `text_find` or `page_render`.
  3. Edit with the `page_*` tools or `doc_set_info`.
  4. **Verify**: `page_render` (or `render_preview`) the changed pages and look at them before
     saving. Rotations, crops and redactions are easy to get wrong.
  5. `doc_save`.
  6. In live mode, `window_open` the saved file so the user sees it.
- **Edits stay in memory until `doc_save`.** `edit_undo` steps back.
- **Page numbers are 1-based.**
- Save results under a new name unless the user asks you to overwrite the original.
- **Live mode**:
  - `window_state` shows which PDFs are open in the window and which page the user is on.
    The `<craft_context>` block has the same information.
  - If you save over a file that is already open in the window, run
    `window_command {"id": "file.revert"}` after `window_open` to reload it from disk.
  - `window_command` runs app commands such as `view.fit_one_page` or `view.layout.two_up`.
    `{"id": "?"}` lists them.
  - Before saving over a file, check `window_state`. If the window shows unsaved changes in
    it, ask the user first.
