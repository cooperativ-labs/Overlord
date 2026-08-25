# File Change Recording Accuracy: Why Files Are Missed And What To Do About It

Mission `coo:851`, objective `coo:851.00xt`. Ideas/design only — no behavioral code changed.

## Problem

Agents are inconsistent when recording file changes: some files an agent genuinely changed
appear in the objective ledger, others silently do not. The constraint is fixed: **do not
force the agent to explain (or even enumerate) all VCS changes.** The coo:825 flip
deliberately traded over-reporting for under-reporting; this document is about winning
back recall without reintroducing the gate, the arbitration, or forced prose.

## How recording works today (and exactly where files fall through)

The pipeline is: harness fires a `PostToolUse`-style hook → `capture-change-hook.sh`
(requires `OVERLORD_OBJECTIVE_ID` + `ovld` on PATH) → `ovld protocol capture-change`
parses the payload with the connector-owned codec → only an event normalized to
`file.edited` with an exact path becomes `declared_edit`/`direct` evidence in the local
ledger (`cli/src/capture-change.ts`, `cli/src/change-ledger.ts`) → evidence syncs at
update/deliver/`changes`.

A file is recorded **only if every one of these holds**:

1. The harness ships an edit hook at all. `claude`, `codex`, `cursor` do; `antigravity`,
   `opencode`, `pi` do not → those sessions record **zero** file evidence.
2. The tool name normalizes to `write` or `edit` (`pure/tool-normalize.ts`). `shell`,
   `mcp`, `task`, `generic` never become `file.edited` — a `sed -i`, `mv`, codegen
   script, formatter, `yarn connectors:capabilities`, or a file-writing MCP tool is
   invisible; the ledger records only a `direct_path_unavailable` health code.
3. The codec finds a path at a declared key. Claude/Codex declare only
   `tool_input.file_path`. Misses:
   - Claude `NotebookEdit` → normalizes to `edit`, but its key is `notebook_path` → dropped.
   - Codex `apply_patch` → normalizes to `edit`, but its input is patch *text* with no
     path key → dropped. `apply_patch` is Codex's primary edit tool, so Codex sessions
     under-record structurally.
   - Cursor already carries `filePath`/`path` fallbacks; Claude and Codex do not.
4. The hook environment is intact: `OVERLORD_OBJECTIVE_ID` exported, `ovld` resolvable
   inside the hook's PATH, payload ≤ `MAX_AGENT_SESSION_PAYLOAD_BYTES` (an oversized
   payload is dropped whole), and an active objective-session binding matches. Every one
   of these fails **silently** from the reviewer's point of view.
5. The path survives normalization (inside the worktree, not `.overlordignore`d, not
   Overlord-managed).

Renames and deletions have no representation at all, on any harness.

**The observability half of the problem:** all of these failures are recorded as bounded
health codes in the local ledger, but health surfaces only through the diagnostic
`ovld protocol changes`. A reviewer looking at a delivery cannot distinguish "the agent
changed three files" from "the agent changed eleven files and the hook saw three."
Under-recording is invisible, which is why it reads as agent inconsistency.

## Unused headroom already in the schema

The ledger and the sync path (`cli/src/commands.ts:166`) already accept a second evidence
tier — `source: 'window_observed'`, `quality: 'window'`, `toolWindowId`, and an
`overlap` flag — but **nothing produces it**. The two-tier design (exact vs. inferred
attribution) was specified in the coo:825 plan; only the exact tier shipped. Most of the
ideas below are "produce the tier the schema reserved."

## Ideas, ordered by leverage per unit cost

### A. Codec recall fixes — cheap, immediate, pure wins

1. Add `notebook_path` to Claude's `filePathPaths`; add `filePath`/`path` fallbacks to
   Claude and Codex to match Cursor.
2. Add a declarative patch-text extraction rule to the codec vocabulary (e.g.
   `filePathPatchTextPaths: [tool_input.patch]` matching `*** Add/Update/Delete File:`
   headers) so Codex `apply_patch` yields its full path set. Multi-path: let
   `file.edited` carry every extracted path — the ledger already accepts arrays.
3. Optional codec rules mapping known file-writing MCP tools (e.g.
   `mcp__filesystem__write_file`) to `file.edited` with their path keys. Keep it
   declarative and per-adapter, consistent with the codec's review model.
4. **Codec conformance fixtures**: record real hook payloads per harness (Claude
   Write/Edit/NotebookEdit, Codex apply_patch, Cursor variants) and replay them in CI.
   Today a harness renaming a key degrades silently; fixtures make it fail loudly. This
   directly attacks the "inconsistent between agents" symptom.

### B. Implement the window tier — the structural fix for shell-mediated changes

Produce `window_observed` evidence automatically, with no agent involvement:

- When a mutation-capable callback arrives **without** a direct path (normalized `shell`,
  `mcp`, `generic`, or an `edit` whose path extraction failed), fingerprint the worktree
  (bounded `git status --porcelain -uall` + content hashes of dirty paths, cached from
  the previous callback) and diff against the previous fingerprint. Paths that changed
  inside the window become `window_observed`/`window` evidence stamped with a
  `toolWindowId`.
- **Concurrency honesty**: keep a per-worktree registry of open windows (the
  active-objective-sessions manifest is already per-worktree). If two attached
  objectives' windows overlap in time, stamp both sides `overlap: true` instead of
  guessing an owner. The schema field exists for exactly this.
- **Cost control**: fingerprint only when such a callback actually fires; bound the scan
  (file count/bytes/time); on a blown bound, record `window_scan_skipped` health rather
  than blocking or lying. Change tracking stays advisory.

This closes the single biggest hole (Bash/codegen/formatters), captures renames and
deletions as path evidence, and the honest quality tag means review can render it as
"observed during this agent's shell activity" rather than "the agent claims this" — no
forced explanation anywhere.

### C. Surface evidence health at review time — make under-recording visible

Even with A+B, gaps will exist. Stop letting them be silent:

- Propagate ledger health codes with the evidence sync (the sync path already carries
  `hookHealth` per entry) and render a per-delivery **evidence confidence badge** in the
  webapp: e.g. "3 files (direct) + 5 files (window) · 2 shell calls with no observable
  window". A PM who can see "hook degraded" stops reading a short list as agent
  sloppiness.
- Extend `ovld doctor` with capture-path checks: hooks installed and current version,
  `ovld` resolvable in a hook-like PATH, `OVERLORD_OBJECTIVE_ID` present in launch env,
  a synthetic end-to-end capture probe.
- Oversized payloads: before dropping, run a bounded targeted extraction of just
  `tool_name` + declared path keys (streaming or prefix parse) so a giant Write payload
  still yields its one path.

### D. Session-window fallback for hookless adapters

For `antigravity`/`opencode`/`pi` (and any session whose hooks never fire — detectable
because the ledger stays empty while the session posts updates): baseline at attach,
delta at deliver, recorded as `window_observed` with a session-scoped window id and
`overlap` when other objectives share the worktree. Over-reporting at window quality is
acceptable now that nothing gates or demands prose; an empty ledger masquerading as "no
changes" is worse. This reuses B's fingerprint machinery.

### E. Cheap affirmative declaration — optional, paths-only, no prose

`ovld protocol declare-changes --paths <a,b,c>` (+ MCP equivalent): the agent may record
paths it *knows* it produced (codegen output, files written by a script it ran) as
declared-tier evidence. No labels, no why/impact, no gate — strictly additive, one line
in the connector prompt ("after running a generator, you may declare its outputs").
This is the escape hatch the coo:825 plan called for, kept deliberately prose-free so it
cannot regress into the old rationale interrogation.

### F. Explicitly not recommended

- **Gating delivery on evidence coverage** — reintroduces the blocked-delivery /
  fabricated-prose failure coo:825 removed.
- **Asking the agent to reconcile `git status` at deliver** — this is precisely the
  "explain all VCS changes" burden the objective rules out, and in shared worktrees it
  manufactures false claims.
- **Shell command parsing** (`sed`/`mv`/redirect extraction) as the primary shell
  answer: unknowable recall, high maintenance. The window tier dominates it. Worth
  revisiting only later as a *rationale seed*, never as the attribution source.

## Suggested sequencing

| Phase | Work | Effort | Recall impact |
|---|---|---|---|
| 1 | A1–A3 codec fixes + A4 fixtures | days | Fixes NotebookEdit, Codex `apply_patch`, MCP writes — likely most of the day-to-day "some files missing" reports on hooked harnesses |
| 2 | C health surfacing + doctor checks | days | No recall change, but converts silent gaps into visible, diagnosable ones |
| 3 | B window tier | ~1–2 weeks | Shell/codegen/formatter changes, renames, deletes |
| 4 | D hookless fallback | small once B exists | Three adapters go from zero evidence to window-quality evidence |
| 5 | E declare-changes | small | Long-tail precision for generated outputs |

Phases 1–2 are independent of each other and of 3; both are safe to start immediately.
