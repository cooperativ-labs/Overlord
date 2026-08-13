# coo:710 — Touched-files hook logging failure

## What was happening

Deliver warned that the touched-files hook was not logging (`~/.ovld/logs/post-tool-use-hook.log`) and fell back to baseline-only attribution.

The hook **was** firing. Live agent-pod logs showed both Cursor and Claude post-tool-use hooks returning:

```
recorded: false
reason: no active session manifest entry for this cwd
```

Cursor Agent CLI sessions that run a Claude model invoke **both** hook systems with the same payload, which is why the warning pointed at the Claude log path.

## Root cause

Cursor Agent CLI `postToolUse` payloads do not include `cwd`. They send `workspace_roots: [workspacePath]` and set `CURSOR_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` on the hook process. User-level hooks run from `~/.cursor`.

`ovld protocol record-touched` only read `payload.cwd`, then fell back to `process.cwd()` (the hook cwd). That hash never matched the session manifest written at attach from the project checkout, so nothing was recorded in `~/.ovld/vcs-touched/`.

A second failure: agent-pod recovers `OVERLORD_EXECUTION_REQUEST_ID` from the launch script. If the runner has already cleared that request, attach failed entirely, so `writeActiveSession` never ran.

## Fix

- Resolve hook cwd from `cwd`, then `workspace_roots[0]`, then `CURSOR_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` / `CLAUDE_PROJECT_ROOT`.
- Accept Cursor `path` / `filePath` aliases in the tool input.
- Attach: skip linking a non-linkable execution request (backend) and retry attach without the recovered id (CLI, works against current production).
- Deliver warning now names both hook log files.
