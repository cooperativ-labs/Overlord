# coo:1199.1cqh: connector outcome gating and rename capture

Objective: coo:1199.1cqh. Date: 2026-10-24. Intermediate slice of the coo:1199 cutover; see
`coo-1199-change-tracking-implementation.md` for the full specification.

## What changed

- **Codec dialect** (`packages/core/service/agent-session/pure/codec.ts`, validated by
  `scripts/generate-harness-capabilities.mjs`):
  - `outcomePath` now also decodes numeric exit codes (0 → `ok`, other integers → `error`).
  - `outcomeExitCodePrefix` decodes a leading `<prefix><n>` line of a text result. Only the
    decoded value is kept. A string without that leading line is unknown; there is no fallback to
    word matching.
  - `successOnly: true` (only on `tool.completed` rules) seals `ok` when nothing was decoded. It is
    a harness guarantee and must cite evidence.
  - Patch extraction reduces `*** Move to:` alongside Add/Update/Delete File headers, so a rename
    keeps both endpoints. Existing bounds still apply: 1 MiB patch text, 32 paths, and
    `reduceEvidencePath`.
- **Capture** (`cli/src/capture-change.ts`) appends native `declared_edit` evidence only for a
  `file.edited` event whose outcome is `ok`. Every other case appends nothing:

  | Outcome or event                         | Health recorded             |
  | ---------------------------------------- | --------------------------- |
  | `blocked`                                | none                        |
  | `error` / `cancelled`                    | `outcome_partial`           |
  | unknown                                  | `outcome_unavailable`       |
  | shell `tool.completed`                   | `shell_activity_unverified` |
  | other no-path / generic / unmapped       | `direct_path_unavailable`   |

  Every scoped callback, including a harmless read, still records callback observation first.
- **Local ledger** (`cli/src/change-ledger.ts`): when the 32-entry health list overflows, non-gap
  entries are evicted before any `CAPTURE_GAP_CODES` entry, so gaps stay sticky locally as well as
  server-side.

## Per-adapter evidence

| Adapter | Capture registration | Outcome declaration | Evidence |
| --- | --- | --- | --- |
| Claude | `PostToolUse` | `successOnly` | Installed Claude Code 2.1.310 binary hook table: "PostToolUse — Run after successful tool", "PostToolUseFailure — Run after tool fails". Failure event not registered. |
| Cursor | `postToolUse` | `successOnly` | Shipped cursor-agent 2026.09.23 bundle (`190.index.js`): `fireSuccessAsync` (postToolUse, `tool_output`) runs only when `isSuccess(result)`/stream success. Errors, aborts and preToolUse/permission denials call `fireFailureAsync` → `postToolUseFailure` (`error_message`, `failure_type`, `is_interrupt`). Not registered. |
| Codex | `PostToolUse` | `outcomePath: tool_response`, `outcomeExitCodePrefix: 'Exit code: '` | codex-rs (via DeepWiki over openai/codex): `apply_patch` `tool_response` is the `ApplyPatchToolOutput` text, and the upstream hook test `post_tool_use_records_additional_context_for_apply_patch` asserts it starts `Exit code: 0` and contains `Success. Updated the following files:`. Verification failures return `FunctionCallError` and do not dispatch PostToolUse. Exit-time failures carry a non-zero exit code. |
| OpenCode | none (control plane, `observe.fileEdit` not-implemented) | existing `properties.part.state.status` | unchanged |
| Pi, Antigravity | none (`observe.fileEdit` not-implemented) | — | unchanged |

New Codex fixtures: `normalize-post-tool-use.json` (now the upstream `Exit code: 0` text shape),
`normalize-post-tool-use-failed.json` (`Exit code: 1` → `error`), and
`normalize-post-tool-use-rename.json` (Move to + Delete → three paths). Claude and Cursor
post-tool fixtures now expect `outcome: ok`.

**These are source/binary and fixture proofs, not live harness smokes.** A live Codex dump through
a temporary hook config was attempted. It needs `--dangerously-bypass-hook-trust` for an
untrusted scratch hook, and this session's permission policy refused that flag. No live Claude or
Cursor dump was taken. Final validation (coo:1199.k85p) should capture real sanitized payloads
from each installed harness and replace or extend these fixtures.

## Unsupported or unverified payloads (remain unavailable, never guessed)

- **Codex code mode.** Recent Codex rollouts invoke tools through the JS `exec` code-mode tool.
  That normalizes as `shell` and records `shell_activity_unverified`. Whether nested
  `apply_patch` calls inside `exec` dispatch their own `PostToolUse` with `tool_name:
  apply_patch` is unverified.
- **Codex partial application.** A non-zero `apply_patch` exit can leave some files written. The
  harness does not say which, so no path is appended and `outcome_partial` asks the agent to
  declare actual writes.
- **Codex `tool_response` without the exit line** (format drift, or a hook-replaced response) is
  unknown, so it records `outcome_unavailable`.
- **Cursor tools outside the edit vocabulary** (for example a delete tool) normalize as
  generic/unmapped and record `direct_path_unavailable`.
- **Claude renames and deletes** happen through shell, which records `shell_activity_unverified`.
  Agents declare those paths through `--paths`/`--paths-file`.
- **Failure events** (`PostToolUseFailure`, `postToolUseFailure`) are deliberately not registered:
  a failed call contributes no native evidence.

## Handoffs

- **coo:1199.j1qg:** shared mission skill and docs still describe the pre-gating health
  vocabulary ("Mutation-capable callbacks … report unavailable evidence health") and rationales.
  Explain `outcome_partial` / `outcome_unavailable` / `shell_activity_unverified` and the need to
  declare shell, script and partial writes.
- **coo:1199.k85p:** live harness smokes for success, failure and rename on Claude, Codex and
  Cursor, including a Codex code-mode nested apply_patch check. The capture hook comment and the
  compiled codec registry changed, so installed connectors and the CLI must be reinstalled together
  (connector 0.3.55). Codex may ask to re-trust hooks if the rendered hook definition hash changes.
