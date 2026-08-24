# Week 33, 2026 (10–16 Aug)

Consolidated from per-objective reports created this week.

## Touched-files hook logging failure (coo:710, 2026-08-13)

Deliver warned that the touched-files hook was not logging and fell back to baseline-only attribution. The hook was firing; Cursor Agent CLI `postToolUse` payloads omit `cwd` (they send `workspace_roots` and `CURSOR_PROJECT_DIR` / `CLAUDE_PROJECT_DIR`), so `record-touched` hashed the hook process cwd (`~/.cursor`) and missed the attach manifest.

Fix: resolve cwd from `cwd` → `workspace_roots[0]` → Cursor/Claude project dir env vars; accept Cursor `path` / `filePath` aliases; skip linking a non-linkable execution request on attach and retry without the recovered id. Deliver warning now names both hook log files.

## Latch session UI locale (coo:716, 2026-08-13)

Mission-page Latch session card showed “Device is not reachable” and a tmux unexpected-session-row error. Latch had switched its tmux row separator to U+001F; tmux sanitizes that to `_` when the client has no UTF-8 locale (Finder/launchd Desktop has none).

Fix: `latchChildEnvironment()` forces UTF-8 `LC_CTYPE` on every Latch child Overlord spawns (inspect/open/stop, events, send, discovery, runner launch). Residual: Latch itself still breaks for non-Overlord callers without UTF-8; packaged Desktop needs a rebuild to pick this up.
