# coo:825.w81h — File changes missing from MissionPanel

## Verdict

**Recording failure, not display.** `MissionPanel` → `LiveFileChanges` →
`GET /api/missions/:id/file-changes` correctly reads `changed_files` (LEFT JOIN
optional rationales). `coo:825` returns 68 rows. Post-cutover Cursor missions
such as `coo:830` return `[]` because the objective ledger never received
evidence.

## Evidence (coo:830)

- Delivery exists with a full summary.
- `GET /api/missions/coo:830/file-changes` → `[]`.
- Local ledger for objective `aadc98d6-…` exists with `evidence: []` and
  `health: []` (attach reset the ledger; capture never bound a session).

## Root cause

Cursor `postToolUse` hooks:

1. Run with `PWD=/Users/jake/.cursor` (not the project).
2. Often omit `cwd` from the native payload while still sending absolute
   `tool_input.file_path`.
3. `capture-change` used payload `cwd` / process cwd to open the
   active-objective-sessions manifest, missed the real worktree binding, and
   returned `no matching objective session binding`.

Secondary gaps fixed in the same change:

- `StrReplace` lowercased to `strreplace` and mapped to `generic` (now `edit`).
- Cursor hook matcher now includes `StrReplace`.
- Cursor codec `filePathPaths` also accepts `filePath` / `path` (write formatter
  parity).

## Fix

- `resolveWorkingDirectoryForObjective`: recover the worktree by explicit
  objective id across active-session manifests; absolute path hints only break
  multi-worktree ties.
- After recovery, seed a missing top-level `cwd` so absolute edit paths
  relativize under `reduceEvidencePath`.
- Connector release **0.3.36**. Re-run `ovld agent-setup cursor` so the installed
  hook matcher picks up `StrReplace`.

## Live verification

After installing the rebuilt CLI, a real Cursor Write (no `cwd` in payload)
recorded `.overlord/tmp/coo-825-w81h-hook-probe-live.txt` on objective
`coo:825.w81h`.
