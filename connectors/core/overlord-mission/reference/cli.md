# CLI Command Reference

## Addressing a mission or an objective

Every `ovld protocol` subcommand that takes `--mission-id` also takes
`--objective-id`, and an objective **display** id (`coo:756.k7xm`) already names
its mission — so `--mission-id` is optional whenever you pass one:

```bash
ovld protocol update --objective-id coo:756.k7xm --summary "..."      # mission derived
ovld protocol update --mission-id coo:756 --objective-id coo:756.k7xm # same thing
```

Use the objective form when reconnecting to a mission that is running more than
one objective: "the active objective" is ambiguous there, and commands that
rediscover it (`attach`, `load-context`, `connect`) fail with
`ambiguous_active_objective` until you name one.

An objective **UUID** carries no parent mission, so it still needs
`--mission-id` next to it. The CLI also fills `--objective-id` in from
`OVERLORD_OBJECTIVE_ID` on session-scoped commands, so a launched agent rarely
types it at all. Two commands deliberately never inherit it:
`update-objective` (the id names the row being changed) and `discuss-objective`
(it wants a draft, not the objective already executing).

## Attach

```bash
ovld protocol attach --mission-id $MISSION_ID [--objective-id $OVERLORD_OBJECTIVE_ID]
ovld protocol attach --objective-id coo:756.k7xm
```

`attach` establishes the objective/session binding used by the local change ledger. It does not snapshot or diff the working tree.

For a mission with a summary, the attach JSON (and `resume-follow-up`) also carries a top-level
`missionSummary` editing baseline: `{ contentRevision, headline, summary, author, openItems:
[{ id, kind, objective, text, blocking? }], truncated }`. `load-context` and `connect` never
carry it. You rewrite it at delivery; see **Mission summary at delivery** below.

## Update

```bash
ovld protocol update --session-key <sessionKey> --mission-id $MISSION_ID --summary "What you did and why." --phase execute
```

## Heartbeat

```bash
ovld protocol heartbeat --session-key <sessionKey> --mission-id $MISSION_ID --phase execute --note "Running the integration suite"
```

Use `heartbeat` for liveness pings and transient UI telemetry when you have no meaningful narrative summary to post. It updates the attached session without creating a mission event.

Supported `--phase` values:

- `draft`
- `execute`
- `review`
- `deliver`
- `complete`
- `blocked`
- `cancelled`

These are hardcoded CLI-supported values for the `--phase` flag. They are not user-defined phase types.

Event types:

- `update` for standard progress updates
- `user_follow_up` — only when the `UserPromptSubmit` hook is unavailable; the hook normally posts follow-ups to the activity feed
- `alert` for warnings or non-blocking issues
- `discussion_summary` for important discussion outcomes that should remain visible on the mission
- `decision` for explicit non-file decisions made during follow-up discussion

- Post-delivery follow-up modes:

- User follow-up messages default to `discussion` intent while the mission is in review.
- Use `ovld protocol resume-follow-up --mission-id $MISSION_ID --summary "Beginning follow-up work."` when post-delivery implementation starts after the original session has ended or its key is unavailable.
- Use `ovld protocol update --begin-follow-up-work --follow-up-intent execution --summary "Beginning follow-up work."` before moving a delivered/review mission back to execution.
- Use `--follow-up-intent pending_delivery` when implementation is complete but final delivery is still being prepared.

## Ask

```bash
ovld protocol ask --session-key <sessionKey> --mission-id $MISSION_ID --question "Specific question for the PM."
```

## Deliver

```bash
ovld protocol deliver --session-key <sessionKey> \
  --mission-id $MISSION_ID \
  --summary "Narrative: what you did and next steps."
```

This is the normal delivery shape: a summary is sufficient. The CLI syncs objective-ledger
evidence independently before the lifecycle transition; tracking gaps and sync failures never
block delivery. Write the summary by behavior or component (outcome, why, verification, and
limitations); there is no per-file explanation input.

Artifacts and a delivery report remain optional annotations when they add review value. Use
`--payload-json` when the full delivery object fits comfortably inline (roughly under 8 KB).
Larger inline `--*-json` values are rejected; stream them through the corresponding `--*-file -`
flag.

If `heartbeat` succeeds but `deliver` or `update` fails, the session is likely fine — retry with the corresponding `--*-file -` flag instead of inline `--*-json`.

### Mission summary at delivery

When attach returned `missionSummary`, send the rewritten mission headline and summary and the
items you closed, either as a `missionSummary` field of `--payload-json` / `--payload-file` or
with `--mission-summary-file <path|->` (which wins over the payload field):

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID --payload-file - <<'EOF'
{
  "summary": "Narrative for the reviewer about this objective.",
  "missionSummary": {
    "baseContentRevision": 7,
    "headline": "One sentence, at most 140 characters.",
    "summary": "Markdown, at most 1,200 characters, true for the whole mission now.",
    "closeItems": [{ "id": "<openItems[].id>", "status": "done", "reason": "Why, at most 280 characters." }]
  }
}
EOF
```

- `baseContentRevision` is `missionSummary.contentRevision` from attach; required with prose.
- `headline` and `summary` go together; `closeItems` may be sent alone (at most 50 entries).
- `status` is `done` (addressed) or `dismissed` (no longer applies); `reason` is required.
- Malformed input is rejected with 400 `invalid_input` before anything is written. Unknown,
  foreign or already-closed ids are skipped with a `mission_summary_item_skipped` warning.
- The response carries `missionSummary { contentRevision, narrativeWritten, closedItemIds,
  warnings }`; `mission_summary_style` warnings are advisory.
- Only one `--*-file` flag may read stdin at a time.

On 409 `mission_summary_conflict` nothing is delivered. The CLI exits non-zero and prints
`{ error, code, baseContentRevision, missionSummary }` on stdout, where `missionSummary` is the
fresh baseline. Rewrite from it and deliver again once with its `contentRevision`. If that
conflicts again, deliver without `headline` and `summary` and say so in the delivery summary.
Writing guidance is in the **Mission Summary** section of the skill.

### Captured file evidence

Read the objective's captured paths once before writing the delivery summary:

```bash
ovld protocol changes --objective-id $OBJECTIVE_ID            # this checkout's sessions
ovld protocol objective-changes --objective-id $OBJECTIVE_ID  # synchronized server history
```

`changes` is local-only: it syncs pending ledger entries (failure is advisory) and returns
`LocalObjectiveChangesDto` with `scope: "local_objective_sessions"`, synced and pending paths
deduplicated by path, a 200-row cap with pre-cap `total` and `truncated`, and capture and sync
warnings. `coverage: "unavailable"` means no local session matched, not that nothing changed.
`objective-changes` (hosted MCP `overlord_changes`) returns `ObjectiveFileChangesDto` with
`scope: "server_objective"` across every session, resource, and device, but cannot see
unsynchronized local rows. Neither read diffs the worktree, classifies ownership, or gates
delivery.

Rows are cumulative objective evidence, including edits later reverted. `source` is
`declared_edit` (Native: at least one successful native edit callback), `agent_declared`
(Declared), or `null` (Unknown historical provenance). Native capture appends a path only for a
codec-normalized edit with a successful outcome; reads, searches, and fetches are silent. Gap
codes mean capture may be incomplete, not that a file changed: `shell_activity_unverified`
(shell ran), `outcome_partial` / `outcome_unavailable` (an edit failed partway or its result was
unknown, so no path was recorded), and `direct_path_unavailable` (an unmappable tool ran).
Binding warnings distinguish an unbound session, a bound session with no observed callback, and
unknown (hosted) availability.

When you know you changed files capture missed (shell or heredoc writes, script or generator
outputs, deletes, and both rename endpoints), declare exactly those on the existing `update` or
`deliver` call:

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID \
  --summary "Narrative: what you did and next steps." \
  --paths src/generated/schema.ts,docs/old-name.md,docs/new-name.md
```

Use `--paths-file <path|->` with a JSON string array for long lists or paths containing commas.
Paths are normalized against the checkout; traversal, symlinks leaving the checkout, ignored
paths, and Overlord-managed paths are rejected with a reason on stderr and never fail the call.
Absent targets (deleted or renamed-away files) are valid. Never enumerate every changed or
opened file, and when unsure, describe the coverage gap in the summary instead of guessing.

Quote an inline value containing spaces: `--paths "planning/demo environment.md,src/generated.ts"`.
If the local binding or ledger is unavailable, pass `--session-key` and `--objective-id`
explicitly and keep the path flags. The CLI warns and submits normalized paths through the
authenticated session as Declared; do not drop the paths from delivery. Fallback sync failures
warn and need the declarations repeated on a later update/deliver (no local retry copy).
Use `objective-changes` to read synchronized fallback evidence. Local `changes` instead reports
the missing/invalid binding in `capture.healthCodes` and stderr. Restore native capture by
re-running attach in the intended checkout with the same `OVLD_HOME` and writable storage.

### Shared worktree safety (critical)

The working tree may contain file changes from **other agents, missions, or objectives** running concurrently in the same checkout or worktree. Those changes are **not yours to undo**.

**Never revert, delete, or restore another agent's work to make delivery succeed.** This includes:

- `git checkout`, `git restore`, `git reset`, or any command that rolls back uncommitted edits you did not make for this mission
- Deleting or overwriting files you do not recognize as your own

If `git status` shows dirty paths outside your work, leave them intact. The ledger is evidence
about the addressed objective, not an ownership arbiter for a shared worktree. Read-only work
uses the same summary-only delivery as every other objective.

Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

## Retired Per-File Inputs

`--change-rationales-json|file`, `--changed-files-json|file`, and the `changeRationales` /
`changedFiles` payload fields are rejected on `update`, `deliver`, and `record-work`. Explain
changes in the summary and declare missed paths with `--paths` / `--paths-file`.

## Project Discovery And Mission Creation

When creating missions from within a repository:

- Prefer `create` by default for draft mission creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- `create`, `prompt`, and `record-work` require an explicit `--project-id`; use `discover-project` first when the project is known only from the checkout. They never infer a destination project.
- Use `create --unassigned-to-project` only when the user deliberately requests an account-owned inbox capture.
- Create multiple missions when each prompt represents a different feature or goal.
- Add objectives to the same mission when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`.
- `create` and `prompt` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "objective": "...", "title": "...", "description": "...", "autoAdvance": true }` objects. A single objective is just an array with one item. `--auto-advance` / `--no-auto-advance` map each opted-in item to authoritative Run Queue membership (default off).
- `add-objectives` uses the same per-item `autoAdvance` field and `--auto-advance` / `--no-auto-advance` mapping.
- Every objective item on `create`, `prompt`, and `add-objectives` also takes optional `"agent"` and `"model"` (a model requires an agent), and `--objective-agent <id>` / `--objective-model <id>` set the default for items that name no `agent` of their own. Assign the agent on the objectives you are already creating rather than appending a second objective just to name one. `--objective-agent` is distinct from `--agent`, which records creation provenance (and, on `prompt`, the attaching agent).
- Objective `"description"` (optional, on every item of `create`, `prompt`, and `add-objectives`) is the human-facing summary; the `objective` text stays the complete instruction for the executing agent, which never receives the description. Write one to three short prose paragraphs in Simplified Technical English style that open with the goal and close with the done-when sentence (about 120 words). Omit it and Overlord writes one for long (280+ characters) agent-written objectives. With a single `--objective`, use `--objective-description <text>` or `--objective-description-file <path|->` instead (rejected with `--objectives-json`). Style issues come back as advisory `warnings` (`{ code, message, rule?, excerpt?, suggestion? }`, code `description_style` or `description_suppressed`) on the matching created objective; the text is stored as written.
- `update-objective --description <text>` / `--description-file <path|->` sets the description (empty removes it); `--description-request summarize|regenerate|retry` asks Overlord to write one (it cannot be combined with `--description`). Agents may do both only on `draft` objectives (400 `description_not_editable`). `retry` re-requests only a failed generation (409 `description_not_failed`); instructions under 280 characters are not summarized (409 `description_not_eligible`). If a person removed the summary, agent text is not stored (warning `description_suppressed`) and summarize/regenerate are refused (409 `description_suppressed`); only the person's Summarize in the app turns summaries back on. The response carries a top-level `warnings` array.
- Use `ovld protocol run-queue [--project-id <id|slug|name>|--objective-id <id>|--mission-id <id>] [--queue <id|name>]` to inspect live queues. Entry operations use `queue-objective --objective-id <id> [--queue <id|name>] [--after <queued-entry|objective>|--front|--position <rank>]`, `dequeue-objective --objective-id <id>`, and `reorder-run-queue --queue <id|name> --ordered-entries-json <json>`; they require `execution_request:create`. Queue-definition operations use `create-run-queue`, `update-run-queue`, `delete-run-queue`, and `reorder-project-run-queues`; they require `project:update` and therefore a full-scope token.
- `record-work` creates exactly one **completed** objective from a single `--objective` (or positional / an `objective` field in `--payload-json`) plus a `--summary` and optional `declaredPaths` — it does not take `--objectives-json`. See [record-work.md](record-work.md).

```bash
ovld protocol create --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"objective":"Capture follow-up work from this repository"}]'
```

```bash
# One call: a draft mission whose first objective is already assigned to Codex.
ovld protocol create --agent <agent-identifier> \
  --project-id <project-id> \
  --objectives-json '[{"objective":"Implement the API","agent":"codex","model":"gpt-6.1-terra"},{"objective":"Add CLI docs","agent":"claude"}]'
```

```bash
ovld protocol prompt --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"objective":"Implement feature X"}]'
```

```bash
ovld protocol add-objectives --mission-id 1:899 --objectives-json '[{"objective":"Implement the API","autoAdvance":true},{"objective":"Add CLI docs"}]'
```

```bash
ovld protocol update-objective --objective-id <objective-uuid> --auto-advance
```

```bash
ovld protocol update-objective --objective-id <objective-uuid> --description-file - <<'EOF'
Add retry with backoff to the sync worker. ... The work is done when the retry test passes.
EOF
```

### Record Completed Work

Record already-finished chat work as a completed review mission in one call — no
`attach`/`deliver`. Creates a mission with one completed objective, records declared paths as
Declared evidence, lands it in review, and runs the Gemini delivery summary. An optional
`missionSummary` (or `--mission-summary-file`) writes the new mission's headline and summary
without a `baseContentRevision`.

```bash
ovld protocol record-work --payload-file - <<'EOF'
{
  "objective": "Add a CSV export button to the reports page.",
  "summary": "Added a CSV export control and the serializer behind it.",
  "declaredPaths": ["src/reports/export.ts"]
}
EOF
```

The full submission format, including `declaredPaths` rules and the MCP equivalent, is in [record-work.md](record-work.md).

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
ovld protocol discover-project --project-id <id-or-name>
ovld protocol discover-project --project-id "My Project"
ovld protocol discover-project --directory /path/to/repo
```

Use `--project-id` when the project ID or name is already known (names are unique per organization, matched case-insensitively). Use `--directory` to override cwd path matching; resource-directory matching automatically prefers the device the CLI is running on (its identity is sent as request headers). Set `OVERLORD_DEVICE_FINGERPRINT` to pin a stable execution-target identity across disposable containers that share one environment (AgentPod sets this). Set `OVERLORD_DEVICE_LABEL` to override the display name (defaults to hostname); alone it does not change the fingerprint.

## Creating Projects

Users and agents can create a project directly from the CLI. By default the current
working directory is registered as the new project's primary resource in the same
call (one-step setup); pass `--no-directory` to create a bare project.

```bash
# Create a project and link the current directory in one step
ovld protocol create-project --name "Acme Web"

# Link a specific directory
ovld protocol create-project --name "Acme Web" --directory /path/to/repo

# Create a bare project with no directory
ovld protocol create-project --name "Acme Web" --no-directory
```

`ovld create-project --name "<name>"` is the top-level convenience command; it accepts
only `--name`, `--directory`/`--no-directory`, and `--json`, and always creates the
project in your resolved workspace. When a directory is registered it also writes
`.overlord/project.json` so future cwd-based resolution finds the project.

`ovld protocol create-project --name "<name>"` is the parentless Protocol surface;
unlike the top-level command it does not link a local directory. Pass
`--workspace-id <id|slug|name>` to choose a workspace when you belong to more than one
(omitting it returns `workspace_selection_required` with your choices); optional
`--description <text>` and `--slug <text>` are also accepted. There is no `--color`
flag on either surface.

### Resolving the project ID when you don't have one

When you need a project ID for a protocol command and the mission prompt did not supply one, resolve it in this order.

**Locally (CLI inside a shell on the user's machine):**

1. `--project-id` if explicitly provided.
2. Otherwise, run `ovld protocol discover-project` for the current working directory, then pass its returned id via `--project-id`.
3. If discovery returns nothing, read `.overlord/project.json` from the cwd (or any ancestor you have access to). Select the `projects[]` entry with `isPrimary: true` and pass its id via `--project-id`. If the array or primary entry is missing, treat the metadata as invalid and run `ovld doctor`; do not fall back to a top-level projection. To associate missions with a different linked project, pass that project's id explicitly.

**Over MCP (web agents and hosted tools, where the server cannot see the agent's cwd):**

1. `projectId` (hosted MCP) or `project_id` (local shim) if explicitly provided or found in the mission/context.
2. Read `.overlord/project.json` from the directory the user is accessing. Select the `projects[]` entry with `isPrimary: true` and pass its id as `projectId` / `project_id`.
3. As a last resort, try `workingDirectory` / `working_directory` resolution. If a device fingerprint is available, include `deviceFingerprint` / `device_fingerprint`.

A checkout may be linked to more than one project. Default mission association to the `isPrimary: true` project — that is whichever project most recently set this resource as primary. `ovld protocol discover-project` returns that project plus additive `linkedProjects`. Only ask the user which linked project to use when you need a different one than that default or the canonical primary entry is missing.
