# File-Change Attribution And Rationale: Audit And Remediation Plan

Mission `coo:825`, objective `coo:825.kr8r`. Investigation only — no behavioral code changed.

Companion artifact (tables, evidence, severity cards): published from this session.

## Question

Agents and the protocol often disagree about how to attribute file changes and their
rationales, resulting in either blocked delivery or fabricated rationales. What exactly
does the agent produce, what does the protocol determine, how do they combine, what
happens when two agents touch one file — and which is the bigger blocker, attribution
or rationale production?

## Answer

**Attribution is the upstream defect; rationale production is where the cost lands.**
Rationale authoring is the visible pain — it scales linearly with file count, it is
all-or-nothing, and every documented incremental path is broken. But agents write
dishonest rationales because attribution hands them files they cannot honestly explain:
a collapsed directory, a peer's edit, a file a shell command touched.

Three defects dominate:

1. The changed-file list is **wrong at the source**. `git status --porcelain` without
   `-uall` collapses a wholly-untracked directory to one entry, so Overlord does not
   record which files were created inside it. **12 of 523** sampled production
   rationales have a *directory* as their `file_path`.
2. **The mechanical file list never reaches a human.** `listChangedFilesForReview` has
   no product caller — only tests. The webapp's File Changes panel runs
   `FROM change_rationales cr LEFT JOIN changed_files cf`, so a file Overlord verifiably
   watched change is invisible unless someone wrote prose about it.
3. **Delivery is unavoidably monolithic.** `ovld protocol record-change-rationales`
   returns HTTP 404 (verified live), the `record_change_rationales` MCP tool and the
   `file_changes` table the docs name do not exist, and `update --change-rationales-json`
   writes only to the event's `payload_json`. Deliver's gate consults *only* the array
   in that call, never persisted rows. A 190-file mission must land 760 prose fields at
   once or land nothing.

## The pipeline

| Stage | Actor | Produces | Lands in | Keyed by |
|---|---|---|---|---|
| attach | CLI | Baseline: dirty paths + `git hash-object` | `~/.ovld/vcs-baselines/` | **cwd + missionId** |
| attach | CLI | Active-session manifest entry (12h TTL) | `~/.ovld/vcs-sessions/` | cwd only |
| attach | CLI | *Wipes* touched log and edit notes | (deletes) | **cwd + missionId** |
| Edit/Write/MultiEdit | hook | Touched path **and** edit note (tool, intent, transcript snippet) | `vcs-touched/`, `vcs-rationale-notes/` | **cwd + missionId** |
| Bash/Shell | hook | Touched path only — **no edit note** | `vcs-touched/` | **cwd + missionId** |
| deliver 1 | CLI | Run delta: porcelain − unchanged baseline − `.overlordignore` | `--changed-files-json` | **cwd + missionId** |
| deliver 2 | CLI | Classify `mine` / `claimed` / `unclaimed`; `claimed` dropped + auto-skipped | `attribution` (never persisted) | **cwd + missionId** |
| deliver 3 | CLI | Draft rationales from edit notes, merged into the agent's array | `--change-rationales-json` | **cwd + missionId** |
| deliver 4 | **agent** | `{file_path, label, summary, why, impact}[]` — free-text paths | `--change-rationales-json` | an unvalidated string |
| deliver 5 | server | Upsert `changed_files`; rows absent from `observedDirtyPaths` → `resolved` | `changed_files` | session + **objective** + path |
| deliver 6 | server | **Gate**: every `present`, non-`package-lock` row *for the objective* needs a rationale in this call or a skip | throws before insert | **objectiveId** |
| deliver 7 | server | Insert `change_rationales`, linked by path lookup or `NULL` | `change_rationales` | **objectiveId** |

**The join is one exact string match** between `changedFiles[].filePath` (mechanical,
mission-keyed) and `changeRationales[].file_path` (agent-typed). No existence check, no
case folding, no basename fallback. It is asymmetric: an observed path the agent did not
name is a hard 400 that rejects the whole delivery; a named path nothing observed is
silently accepted with a null link.

## Two agents, same file

| Configuration | Touched-log behavior | Outcome |
|---|---|---|
| Two missions, one checkout, `MISSION_ID` set | Separate logs; peer logs read as claims | **Correct** — the case the design was built for |
| Two missions, one checkout, `MISSION_ID` unset (agent pods) | `resolveActiveMissionForCwd` returns most-recent + `ambiguous`, which the caller discards | **Silent under-report** — real work excluded, annotated with a false reason |
| One mission, two objectives in parallel | Shared log (peer scan skips same-mission); second attach **overwrites the shared baseline** | **Total loss** — objective A delivers zero files, no error |
| One objective, two sessions | Shared log and baseline; coverage is objective-scoped and ignores persisted rationales | **Re-authoring**; duplicate rows, last-write-wins link |
| Either agent runs Bash | Whole-worktree diff folds in the peer's concurrent edit | **False claim** with no edit note behind it |

## Defects, by severity

1. **Critical — untracked directories collapse.** `readChangedFiles` omits `-uall`.
   Verified in production data (12 directory-valued `file_path`s).
2. **Critical — no working incremental rationale path.** 404 verified live; only
   `deliverSession` and `recordWork` insert rationale rows.
3. **Critical — the mechanical file list has no product surface.**
   `listChangedFilesForReview` is called only from tests; `listMissionFileChanges`
   (backend/repository.ts:4479 → webapp) selects `FROM change_rationales` and
   left-joins the observed row. Hidden: every `skipped` and `resolved` row — exactly
   the rows exempt from the coverage gate. Shown: phantom rationales with nothing
   behind them.
4. **High — client-side attribution keyed by mission, coverage enforced by objective.**
   *Not a schema problem* — see "Re-keying" below. Includes the baseline-overwrite
   total-loss case above.
5. **High — Bash edits get attribution but no draft**, and the diff is unscoped.
6. **High — ambiguous mission resolution guesses, then asserts the guess** as a skip
   reason on the agent's behalf. (Three missions are attached to one checkout on this
   machine right now.)
7. **Medium — the gate is one-directional.** Phantom rationales in 6 of 22 sampled
   missions, up to 6 per mission.
8. **Medium — rationale content is unvalidated.** 115 of 523 bodies (22%) are
   byte-identical to another; one `why` string repeats 123 times.
9. **Medium — duplicate-path rows link non-deterministically** and double-count in
   review. Addressed by the index change below, not by an FK change.
10. **Low — files deleted before attach are permanently unattributable**
    (`base.contentHash === null` returns false unconditionally).
11. **Low — docs describe a table, a route, and an MCP tool that do not exist**, and
    `cli/docs/11` still says the delta is "intersected with" the touched log when
    `unclaimed` paths are deliberately kept.

## Re-keying file changes to the objective: what it does and does not fix

The natural reading of #4 is that `changed_files` hangs off the mission and should hang
off the objective. Half of that is already true.

**The schema is already objective-keyed.** Both `changed_files.objective_id` and
`change_rationales.objective_id` are `NOT NULL`, and the coverage gate already runs
`WHERE objective_id = ?`. The mission-keying is three files on disk, all named
`sha256(abspath(cwd) + NUL + missionId)` — baseline, touched log, rationale notes. Fixing
it is one function in `cli/src/vcs.ts`, not a migration.

**The collision is real, and it is the unique index, not the FK:**

```sql
CREATE UNIQUE INDEX idx_changed_files_active_session_objective_path
  ON changed_files (session_id, objective_id, file_path)
  WHERE session_id IS NOT NULL AND deleted_at IS NULL;
```

`session_id` in the key is why two sessions on one objective produce two rows for one
file. Moving to `UNIQUE (objective_id, file_path)` collapses them and matches the model:
one objective is one agent prompt.

| Change | Fixes | Does not fix |
|---|---|---|
| Unique index → `(objective_id, file_path)` | #9 entirely | Nothing about attribution — that is decided client-side |
| Re-key client hash to `objectiveId` | #4 entirely | Nothing in the database; no migration |
| Drop `mission_id` from both tables | Nothing — it is a denormalization beside `workspace_id`/`project_id` | Costs a join on every mission-scoped read. Not recommended |

Three things the index change must handle:

1. `recordWork` inserts with `session_id NULL`, which the *partial* index excludes today.
   An unconditional index catches those rows and `recordWork` does a bare `INSERT` — it
   would begin throwing on a re-record. Needs `ON CONFLICT`.
2. `upsertChangedFiles` looks up by `session_id AND objective_id AND file_path`; that key
   changes with the index.
3. Keep `session_id` as a plain last-observer column rather than removing it.

## Target architecture: invert the source of truth

The audit above diagnoses a system built to answer *"what changed in this working tree?"* The
requirement is different:

```
Must have    the paths this agent proactively changed, bound to its objective
Nice to have a rationale per path — valuable, never required
Must not     agents competing over who changed a file
Must not     delivery blocked by a file the agent did not change
Assume       several agents working in one worktree at the same time
```

Autoformatting, build artifacts, the user's own IDE edit, a peer agent's work — all are changes,
none are this agent's doing, none belong in its record.

**The inversion.** Stop deriving the candidate set from git and filtering it by the log. Derive it
from the log and filter it by git.

| | Today — git leads | Proposed — the log leads |
|---|---|---|
| Candidate set | everything dirty in the tree | paths this agent's own tools wrote |
| Git's job | produce the set | answer one question per path: still different from the attach-time commit? |
| Log's job | classify into `mine`/`claimed`/`unclaimed` | **be** the set |
| Files the agent never touched | kept for completeness → must be arbitrated | never candidates |
| Result | arbitration blocks deliveries and manufactures prose | nothing to arbitrate |

Both hard constraints then hold structurally, not by policy. **Agents cannot compete:** two agents
editing one file each record it in their own log, both report it, both are right. **Nobody blocks on
a file they did not change:** the gate only ever sees paths the agent's own tools produced.

**This is mostly a deletion.** Remove: the baseline snapshot and `isRunAttributableChange`;
`readPeerTouchedClaims`; the `claimed` class and its auto-skip with an asserted reason; the
`unclaimed` class; `observedDirtyPaths` reconciliation; `missing_rationale` as a blocking error.
Keep, repurposed: `git status --porcelain -uall` as the per-path filter, the touched log promoted to
source of truth, and edit notes as the rationale default.

**What it costs.** You trade over-reporting for under-reporting. Today a broken hook degrades to a
noisy list; under the flip it degrades to an *empty* one, silently — indistinguishable from an honest
"I changed nothing." That is why hook-health reporting and the affirmative escape hatch below are not
optional extras.

## What the flip does to the eleven defects

| # | Defect | Fate | Why |
|---|---|---|---|
| 1 | Untracked directories collapse | **Still needed** | Git remains the filter, and a filter reporting `sub/` cannot confirm `sub/a.txt` is still different |
| 2 | No incremental rationale path | Downgraded | With rationales never blocking, this is a convenience; the docs still lie either way |
| 3 | Mechanical list has no product surface | **Blocking** | The log-derived list becomes the whole deliverable; a rationale-first panel would hide most of it |
| 4 | Client artifacts keyed by mission | **Prerequisite** | Two objectives in one worktree share a log; the diff currently masks it |
| 5 | Bash: no note, unscoped diff | **Central hole** | A whole-worktree diff imports peer edits into the authoritative set |
| 6 | Ambiguous mission resolution | **Prerequisite** | Misfiling directly corrupts the authoritative set, with no diff to mask it |
| 7 | Gate accepts unmatched paths silently | Dissolved | Becomes the affirmative escape hatch — a feature |
| 8 | Rationale content unvalidated; 22% paste | Dissolved | Nothing demanded, nothing fabricated |
| 9 | Duplicate-path rows | Still needed | Unchanged; the index change still applies |
| 10 | Deleted-before-attach unattributable | Dissolved | Lives inside `isRunAttributableChange`, which is deleted |
| 11 | Documentation drift | Expands | `cli/docs/11` and CONTRACT both describe the delta-led model |

## Deployment constraint: half the fleet has no edit hook

Today a hookless connector degrades to baseline-delta attribution and still produces a file list.
Under the flip, no hook means no log means no files.

| Adapter | Edit hook | `editHook` declared |
|---|---|---|
| claude, codex, cursor | ships a PostToolUse edit hook | yes |
| antigravity, opencode, pi | none | no |

No adapter ships `PreToolUse` — it exists only as the declared-but-unregistered `observe.toolCall`
capability in Claude's manifest.

The fallback is nearly free once the gate is gone: a hookless session keeps today's delta behavior and
over-reports, which was only harmful *because it blocked*. What it must not do is masquerade as
precision, so stamp every record:

```
attributionQuality: exact     — from this agent's own tool-call log
attributionQuality: inferred  — from the worktree delta; may include others' edits
```

Whether the three hookless harnesses can host a hook at all was not investigated.

## Bash: the one hole the flip does not close

Three layers, increasing cost:

1. **Snapshot on every tool call**, not only Bash calls. Today the window spans from the last shell
   command; the matcher already fires on all five tools, so this shrinks it to seconds. CLI-only — no
   connector release, which matters given the fleet above.
2. **Parse the resolvable subset**: `sed -i`, `mv`, `cp`, `rm`, `touch`, `git mv`, `>`, `>>`, `tee`,
   heredocs. Not resolvable: `make`, `yarn build`, `python x.py`, anything with vars/globs/subshells.
   Precision high, **recall unknowable** — a parse returning nothing must never read as "nothing
   changed." Its real value is being the only rationale seed for shell-mediated changes.
3. **Register `PreToolUse`** for a scoped before/after window. `CAPABILITIES.md:67` declined it as
   offering *"no benefit a PostToolUse registration does not already provide."* The flip defeats that
   premise — bounded shell attribution is a benefit PostToolUse cannot provide — but the blast-radius
   cost it names is unchanged.

## Rationales under the stated priority

```
path       recorded unconditionally from the log — no agent action, no gate
rationale  auto-filled from the edit note; agent may override
blocking   none
```

`missing_rationale` was an attribution guarantee. Under the flip that guarantee moves upstream into
the log, enforced structurally rather than by interrogation. The gate becomes redundant, not relaxed.

## The work, ordered

**Phase 0 — make the log trustworthy (must precede the flip)**

1. Re-key client artifacts to `objectiveId`, mission as fallback. Closes #4.
2. Never misfile an ambiguous edit: record nothing and warn. Closes #6.
3. Promote hook health to an integrity signal — extend the existing `commands.ts:1271` check to an
   *empty* log and surface it on the delivery, not just stderr.

**Phase 1 — the flip (mostly deletion)**

4. Log becomes the candidate set; git becomes the per-path "still different?" filter.
5. Add `-uall` so the filter sees files inside new directories. Closes #1.
6. Remove `missing_rationale` as a blocking error.
7. Add `--also-changed-json` — affirmative, additive, never blocking.
8. Stamp `attributionQuality`; keep the delta path for hookless adapters.

**Phase 2 — close the Bash hole (ship layer 1 first)**

9. Snapshot on every tool call.
10. Parse the resolvable command subset.
11. Register `PreToolUse` (contract + connector release).

**Phase 3 — make it visible and honest**

12. Invert the File Changes panel to `FROM changed_files`. Closes #3.
13. Unique index → `(objective_id, file_path)`. Closes #9; the only schema change.
14. Rewrite `cli/docs/11` and CONTRACT; ship or delete `record-change-rationales`. Closes #2, #11.

**Smallest thing that proves the design:** phase 0 plus items 4 and 6 — enough to run one mission with
two concurrent agents in one worktree and see two disjoint, accurate, non-competing file lists, with
no delivery blocked.

## Method and limits

Read end to end: `cli/src/vcs.ts`, `cli/src/vcs-sessions.ts`, `cli/src/record-touched.ts`,
`cli/src/commands.ts`, `packages/core/service/protocol.ts`
(`deliverSession`, `updateSession`, `upsertChangedFiles`, `recordWork`),
`packages/core/service/changes.ts`, `backend/protocol.ts`, the Postgres/SQLite schemas for
`changed_files` and `change_rationales`, and the Claude/Codex/Cursor `PostToolUse` hooks.

Corpus: 523 rationales from missions coo:781, 784, 786, 789, 801, 803 via
`ovld changes status --json`.

**Coverage-failure rates are not measurable from the database** — delivery blocks until
coverage is complete, so every stored record is a survivor and uncovered reads as zero in
all 22 sampled missions. The evidence here is structural, plus the artifacts that failures
leave behind: directory-valued paths, phantom rows, duplicated prose.

The 404 was reproduced live against the real backend. Git's untracked-directory collapse
was reproduced in a scratch repo, then confirmed against production data. Findings 3, 4,
5, 9, and 10 are inspection-only: each names the exact code that produces it, but none was
reproduced end to end.

Defect 3 and the re-keying section were added in follow-up, after the question was raised
of whether re-keying `changed_files` to the objective would fix the contention problem.
Checking that premise is what surfaced the missing product surface — the original pass
traced writes rather than reads.

The target architecture is a **proposal, not a finding**. It replaces an earlier remediation
plan written before the requirement was stated as "what this agent proactively changed"
rather than "what changed." The connector-fleet table is verified (3 of 6 adapters ship an
edit hook and declare `editHook`; none ship `PreToolUse`); whether the three hookless
harnesses can host a hook was not investigated. An earlier draft recommended per-objective
worktree isolation — superseded, since the requirement assumes a shared worktree and the
flip makes isolation unnecessary rather than merely optional.
