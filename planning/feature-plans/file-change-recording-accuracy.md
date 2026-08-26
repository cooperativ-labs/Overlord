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

---

# Addendum: is explicit agent declaration simpler and more accurate?

Objective `coo:851.fdd0`. The question: rather than the layered capture approach above,
should the agent simply note each file path it changes — during operation, or just before
delivery? Specifically, could it paste each path into a temp file whenever it opens a file,
and **how significant would the token overhead actually be?**

Short answer: the token overhead of *declaring paths* is negligible — about **0.1% of a
session** — so token efficiency is not the reason to reject the idea. But the overhead of
*when and how* you ask for them varies by roughly **6,000×** between the two shapes in the
question, and the expensive shape buys information the harness is already handing us for
free. The right move is to keep the layered capture and add a batched, prose-free
declaration for the one thing the agent knows and the hook cannot see.

## Method

Measured against real data rather than estimates:

- **35 Claude Code session transcripts** for this repo
  (`~/.claude/projects/-Users-jake-Development-Cooperativ-Overlord/*.jsonl`), 19 of which
  contain at least one edit-tool call. Token counts come from the recorded `usage` fields,
  not from guessing.
- **The 7 real change-ledgers** on this machine (`~/.ovld/change-ledgers/*.json`).
- Timing of `git status --porcelain -uall` in this worktree.

## What a session actually looks like

| Measure | Value |
|---|---|
| Assistant turns per edit-session (mean) | 124 |
| Tool calls per edit-session (mean) | 73 |
| **Context tokens re-read per assistant turn** | **127,475 mean / 114,962 median** |
| Output tokens per assistant turn (mean) | 695 |
| Output tokens per edit-session (mean) | ~96,000 |
| Unique files edited per edit-session | 4.2 mean, 3 median, 19 max |
| Repo-relative path length | 60 chars mean ≈ 15 tokens |

The decisive number is the third row. In an agentic loop an extra tool call is not "a few
tokens" — it is a full forward pass over the entire conversation, ~127K tokens of (cached)
context plus a fresh generation, plus a real-time round trip. **Paths are free; turns are
not.**

## The four shapes, priced

| Shape | Extra turns | Extra tokens (mean / worst observed) | Share of session | Added latency |
|---|---|---|---|---|
| **Hook capture (today)** | 0 | 0 | 0% | ~20 ms subprocess |
| **Paths appended to the `deliver` call the agent already runs** | 0 | ~90 / ~310 | 0.09–0.32% of generated tokens | 0 |
| **A separate `declare-changes` call before delivering** | 1 | ~128,000 | ~0.8% of session tokens | one round trip |
| **Append per file changed** (the proposal) | 4–19 | ~538,000 / ~2,400,000 | +3.5% mean, ~+7% on the heaviest session | 15–90 s |
| **Append per file *opened*** | 30–100+ | multi-million | +20–50% | minutes |

Same information, delivered two ways: **~90 tokens and zero round trips, or ~538,000
tokens and a dozen round trips.** The per-file variant also compounds — every logged line
joins the context that every later turn re-reads.

The last row matters because the question says "anytime it opens a new file." Opening is an
order of magnitude more frequent than changing (145 `Read` calls plus most of 1,907 `Bash`
calls used `cat`/`sed -n` to read), and reads are not what the ledger wants anyway.

**So: batching is not an optimization, it is the whole cost.** Anything folded into a call
the agent was already going to make is effectively free. Anything that adds its own turn is
not.

## The temp-file instinct is right — and it already exists

The proposal's real insight is externalizing the record so it does not depend on the agent
remembering, mid-session, what it touched 80 turns ago. That is correct, and it is exactly
what ships today: the temp file is `~/.ovld/change-ledgers/<hash>.json`, and the thing
appending to it is the `PostToolUse` hook, not the agent. It costs **zero tokens and zero
turns** because the harness runs it out-of-band.

The consequential finding is what that hook is already being handed. The Claude matcher is:

```json
"PostToolUse": [{ "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash", ... }]
```

**`Bash` is already in the matcher.** Every one of the 1,907 shell commands in those 35
sessions already arrived at `ovld protocol capture-change` with its full command text, for
free — and the codec discarded it, because `bash` normalizes to `shell` and `shell` has no
declared path key. We are not missing the signal. We are dropping it after it arrives.

Asking the agent to retype, at 128K tokens per turn, information that reached the machine
for free 200 ms earlier is the most expensive possible way to obtain it.

## Would declaration be more *accurate*?

For hook-visible edits, no. In this sample all **174** edit-tool calls carried
`tool_input.file_path`, so on this harness the direct tier already sees every `Write`/`Edit`.
An agent-declared list can only match that at best, and it has failure modes the hook does
not: it depends on the agent's recall across a 124-turn session, it survives context
compaction only by luck, and — the reason coo:825 removed agent-declared changed-file lists
in the first place — a model asked to enumerate what it changed will confidently produce a
plausible list rather than an observed one. Declaration is a *memory*; the hook is a
*recording*.

Where declaration is not merely equal but strictly better is the set the hook structurally
cannot see. By a conservative keyword heuristic, 67 of those 1,907 Bash calls mutated files
inside the repo:

| Mutation | Count | Path recoverable from command text? |
|---|---|---|
| `cat > file` / heredoc | 13 | yes |
| codegen / migrate / `connectors:capabilities` | 12 | **no** — outputs unknown |
| `sed -i` | 10 | yes |
| `rm` / `git rm` / `git checkout --` | 9 | yes |
| `eslint --fix` | 7 | usually |
| `touch` | 6 | yes |
| `prettier --write` | 6 | usually |
| redirect into a source file | 2 | yes |
| `mv` | 1 | yes (both sides) |
| `mkdir` | 1 | n/a |

That is **67 shell mutations against 174 edit-tool calls — roughly one in four mutation
events is invisible today.** (Caveat: these are Claude Code sessions in a repo whose
conventions push work through Bash, so one-in-four is likely an upper bound for other
environments; and the heuristic both over- and under-counts at the margins.)

The live ledgers agree. Across the 7 on this machine: 11 evidence entries, **all**
`declared_edit/direct`, and health codes `direct_path_unavailable` ×5,
`direct_path_observed` ×3, `native_payload_unavailable` ×2. Five of seven ledgers already
record "a mutation-capable callback arrived and I could not name a path." The system knows
where its blind spots are and tells no one.

## Revised recommendation

Keep the layered capture; do not replace it with agent declaration. Change the plan in three
ways:

1. **Promote E (`declare-changes --paths`) from phase 5 to phase 2, and scope it
   correctly.** It is nearly free, so the earlier objection ("long-tail, do it last") does
   not survive the measurement. But the prompt line must not be "declare the files you
   changed" — that is the coo:825 failure mode, and it also duplicates a signal the hook
   already has perfectly. It must be *"after running a generator, migration, or script that
   writes files, you may declare its outputs."* One sentence, paths only, no prose, no gate.
   That targets precisely the 12 codegen mutations above — the one row of the table nothing
   else in this plan can recover.
2. **Prefer the zero-turn delivery path.** Accept `--paths` on the existing `update` and
   `deliver` commands, not only as a standalone subcommand, so declaration costs ~90 tokens
   and no round trip. A standalone call is 1,400× more expensive for the same fact.
3. **Add A5: use the shell command text we already receive.** Not as an attribution source —
   the plan is right to reject that (§F) — but as a *corroborator* for the window tier:
   extract unambiguous path operands from the command, then promote a path to evidence only
   when the worktree confirms it actually changed in that window. This also recovers deletes
   and renames, which mtime alone cannot express.

One cost assumption in phase 3 is now measured rather than feared: `git status --porcelain
-uall` in this worktree runs in **~20 ms**. Fingerprinting on every mutation-capable
callback would have added ~38 s across all 35 sessions — about **1 s per session**. The
window tier is cheap; it was never the token budget that made it look expensive.

## Revised sequencing

| Phase | Work | Effort | Recall impact |
|---|---|---|---|
| 1 | A1–A3 codec fixes + A4 fixtures | days | Fixes NotebookEdit, Codex `apply_patch`, MCP writes |
| 2 | E declare-changes, scoped to generator output, folded into `update`/`deliver` | small | Recovers codegen outputs (~18% of shell mutations) at ~90 tokens |
| 3 | C health surfacing + doctor checks | days | Makes the 5-of-7 `direct_path_unavailable` ledgers visible to reviewers |
| 4 | B window tier (+ A5 shell-text corroboration) | ~1–2 weeks | The remaining shell/formatter mutations, renames, deletes |
| 5 | D hookless fallback | small once B exists | Three adapters go from zero evidence to window-quality evidence |

## What this rules out

Asking the agent to log every file it opens. It is the most expensive shape of the cheapest
question, it records reads the ledger does not want, and it re-derives by hand — at ~128K
tokens per entry — data the hook is already receiving and throwing away.
