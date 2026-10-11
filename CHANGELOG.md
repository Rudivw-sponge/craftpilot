# Changelog

## 0.3.0

First public release.

- **Panel:** a chat window that docks beside the ArtCraft apps. Claude works in seven apps:
  PhotoCraft, VectorCraft, DesignCraft, EffectCraft, FilmCraft, LightCraft and PdfCraft.
- **Live and headless modes:** apps opened from the panel are driven in their own windows.
  The others run headless, and their documents persist for the whole chat.
- **Context:** each message carries a summary of what's open in every live app.
- **PdfCraft window tools:** open, inspect and screenshot the live PdfCraft window.
- **Project folder:** apps that support it are locked to the project folder. For the others,
  CraftPilot asks before Claude uses a path outside it.
- **Model and effort:** pickers for both, plus a usage panel with context-window use and
  estimated cost.
- **Sign-in:** the panel uses an Anthropic API key, encrypted with Windows data protection.
  **Open in Claude Code** starts Claude Code with CraftPilot loaded, for Claude plan users.
- **Claude Code plugin:** `/craftpilot:open`, a shared skill and one skill per app.
- **Builds:** a Windows installer and a portable executable.
