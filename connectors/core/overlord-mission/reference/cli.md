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

## Update

```bash
ovld protocol update --session-key <sessionKey> --mission-id $MISSION_ID --summary "What you did and why." --phase execute
```

## Heartbeat

```bash
ovld protocol heartbeat --session-key <sessionKey> --mission-id $MISSION_ID --phase execute --percent 40 --note "Running the integration suite"
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
evidence independently before the lifecycle transition.

Artifacts, optional change rationales, and a delivery report remain current annotations when
they add review value. Use `--payload-json` when the full delivery object fits comfortably inline
(roughly under 8 KB). Larger inline `--*-json` values are rejected; stream them through the
corresponding `--*-file -` flag.

If `heartbeat` succeeds but `deliver` or `update` fails, the session is likely fine — retry with the corresponding `--*-file -` flag instead of inline `--*-json`.

### Change ledger health

Use this only to inspect or troubleshoot objective-ledger synchronization and hook health:

```bash
ovld protocol changes --mission-id $MISSION_ID
```

It may flush pending metadata-only ledger entries for the attached objective, then reports the
binding, synchronization result, evidence source/quality, and bounded hook health. It does not
read or diff the worktree, classify files by agent ownership, draft rationales, or gate delivery.
Native paths normalized by the connector-owned codec as `file.edited` are valid, non-exclusive
`declared_edit`/`direct` evidence. Codec-normalized read, search, and fetch callbacks are silent
no-ops. Mutation-capable callbacks without a normalized edit path, plus shell, generic, unknown,
and unmapped callbacks, report unavailable evidence health.

### Shared worktree safety (critical)

The working tree may contain file changes from **other agents, missions, or objectives** running concurrently in the same checkout or worktree. Those changes are **not yours to undo**.

**Never revert, delete, or restore another agent's work to make delivery succeed.** This includes:

- `git checkout`, `git restore`, `git reset`, or any command that rolls back uncommitted edits you did not make for this mission
- Deleting or overwriting files you do not recognize as your own

If `git status` shows dirty paths outside your work, leave them intact. The ledger is evidence
about the addressed objective, not an ownership arbiter for a shared worktree. Read-only work
uses the same summary-only delivery as every other objective.

Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

## Optional Change Rationales

Rationales are optional annotations stored as `change_rationales` rows. Overlord records
which files an objective changed on its own, so a delivery never requires them and cannot
fail for lacking them. Supply one only when the reason for a change is not obvious from the
diff.

Attach them to `update` while working, or to `deliver` at the end. Inline
`--change-rationales-json` is fine for a few entries; larger arrays are **rejected** — use
`--change-rationales-file -` and stream JSON on stdin. The same ~8 KB inline limit applies to
`--payload-json` and other `--*-json` flags.

**Fields per entry:** `filePath`, `label`, `summary`, `why`, `impact` (all strings),
plus optional `hunks` containing only a `header` string. Use the canonical
`filePath` spelling. Do not wrap the entry under a `rationale` key. Unknown keys
discard only that advisory item or hunk with a bounded warning; the last valid
item wins when a canonical path is repeated.

```bash
ovld protocol update --session-key <sessionKey> --mission-id $MISSION_ID \
  --summary "Added retry logic." --phase execute \
  --change-rationales-json '[{"label":"Add backoff","filePath":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
```

For many entries (roughly 5+), stream them through `--change-rationales-file -` to avoid shell quoting failures:

```bash
ovld protocol deliver --session-key <sessionKey> --mission-id $MISSION_ID \
  --summary "Narrative: what you did and next steps." \
  --change-rationales-file - <<'EOF'
[
  {"label":"Add backoff","filePath":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x."},
  {"label":"Update config","filePath":"lib/config.ts","summary":"Added timeout.","why":"Match new defaults.","impact":"Requests time out after 30s."}
]
EOF
```

## Project Discovery And Mission Creation

When creating missions from within a repository:

- Prefer `create` by default for draft mission creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override or `--project-id` to be explicit.
- Follow-up `create` calls under an active session inherit the current mission's project by default, but `--project-id` can override that when the follow-up belongs in a different project.
- Create multiple missions when each prompt represents a different feature or goal.
- Add objectives to the same mission when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`.
- `create` and `prompt` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "objective": "...", "title": "...", "autoAdvance": true }` objects. A single objective is just an array with one item. `--auto-advance` / `--no-auto-advance` map each opted-in item to authoritative Run Queue membership (default off).
- `add-objectives` uses the same per-item `autoAdvance` field and `--auto-advance` / `--no-auto-advance` mapping.
- Use `ovld protocol run-queue [--project-id <id|slug|name>|--objective-id <id>|--mission-id <id>] [--queue <id|name>]` to inspect live queues. Entry operations use `queue-objective --objective-id <id> [--queue <id|name>] [--after <queued-entry|objective>|--front|--position <rank>]`, `dequeue-objective --objective-id <id>`, and `reorder-run-queue --queue <id|name> --ordered-entries-json <json>`; they require `execution_request:create`. Queue-definition operations use `create-run-queue`, `update-run-queue`, `delete-run-queue`, and `reorder-project-run-queues`; they require `project:update` and therefore a full-scope token.
- `record-work` creates exactly one **completed** objective from a single `--objective` (or positional / an `objective` field in `--payload-json`) plus a `--summary` and file-change data — it does not take `--objectives-json`. See [record-work.md](record-work.md).

```bash
ovld protocol create --agent <agent-identifier> --objectives-json '[{"objective":"Capture follow-up work from this repository"}]'
```

```bash
ovld protocol prompt --agent <agent-identifier> --objectives-json '[{"objective":"Implement feature X"}]' --priority medium
```

```bash
ovld protocol add-objectives --mission-id 1:899 --objectives-json '[{"objective":"Implement the API","autoAdvance":true},{"objective":"Add CLI docs"}]'
```

```bash
ovld protocol update-objective --objective-id <objective-uuid> --auto-advance
```

### Record Completed Work

Record already-finished chat work as a completed review mission in one call — no
`attach`/`deliver`. Creates a mission with one completed objective, records explicitly supplied
changed files and optional rationales, lands it in review, and runs the Gemini delivery summary.

```bash
ovld protocol record-work --payload-file - <<'EOF'
{
  "objective": "Add a CSV export button to the reports page.",
  "summary": "Added a CSV export control and the serializer behind it.",
  "changeRationales": [
    { "filePath": "src/reports/export.ts", "label": "CSV serializer",
      "summary": "New CSV serializer.", "why": "Users need offline reports.",
      "impact": "Reports can be exported as CSV." }
  ]
}
EOF
```

The full submission format, including the `record-work`-only `changedFiles` field and MCP
equivalent, is in [record-work.md](record-work.md).

### Local Durability For New Missions

`create`, `prompt`, `add-objectives`, and `record-work` save the objective/mission text to a local draft (`~/.overlord/pending-missions/`) **before** sending it, and delete that draft only once the server confirms the write. If the network drops mid-call, your text is never lost — the failure message points at the saved file. Manage outstanding drafts with `pending-missions`:

```bash
ovld protocol pending-missions               # list drafts the server never confirmed
ovld protocol pending-missions --retry <id>  # re-send a saved draft; clears it on success
ovld protocol pending-missions --clear <id>  # delete one draft after confirming it landed
ovld protocol pending-missions --clear-all   # delete every draft
```

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

`ovld create-project` is a friendly top-level alias for `ovld protocol create-project`.
When a directory is registered the command also writes `.overlord/project.json` so
future cwd-based resolution finds the project. Pass `--organization-id <id>` to create
in a specific organization (defaults to your membership); `--color <#rrggbb>` sets the
project color.

### Resolving the project ID when you don't have one

When you need a project ID for a protocol command and the mission prompt did not supply one, resolve it in this order.

**Locally (CLI inside a shell on the user's machine):**

1. `--project-id` if explicitly provided.
2. Otherwise, let the CLI match the current working directory (the default behavior of `create`, `prompt`, `discover-project`).
3. If working-directory resolution returns nothing, read `.overlord/project.json` from the cwd (or any ancestor you have access to). Select the `projects[]` entry with `isPrimary: true` and pass its id via `--project-id`. If the array or primary entry is missing, treat the metadata as invalid and run `ovld doctor`; do not fall back to a top-level projection. To associate missions with a different linked project, pass that project's id explicitly.

**Over MCP (web agents and hosted tools, where the server cannot see the agent's cwd):**

1. `projectId` (hosted MCP) or `project_id` (local shim) if explicitly provided or found in the mission/context.
2. Read `.overlord/project.json` from the directory the user is accessing. Select the `projects[]` entry with `isPrimary: true` and pass its id as `projectId` / `project_id`.
3. As a last resort, try `workingDirectory` / `working_directory` resolution. If a device fingerprint is available, include `deviceFingerprint` / `device_fingerprint`.

A checkout may be linked to more than one project. Default mission association to the `isPrimary: true` project — that is whichever project most recently set this resource as primary. `ovld protocol discover-project` returns that project plus additive `linkedProjects`. Only ask the user which linked project to use when you need a different one than that default or the canonical primary entry is missing.
