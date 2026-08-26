---
name: overlord-mission
description: Use for the shared Overlord workflow whenever the user refers to an Overlord mission or ticket.
---

# Overlord Mission

Use this core whenever an agent connector needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord. Treat **ticket** as a user-facing synonym for **mission**: invoke this `overlord-mission` skill for either term. There is no separate `overlord-ticket` skill.

Connector adapters may add harness-specific commands, hooks, MCP tools, or launch flags, but they must not replace the lifecycle rules in this core.

## Mode 1: Launched From Overlord Desktop Or CLI

Use this mode when the prompt already contains a mission ID or explicitly says the session was launched by Overlord.

**`<mission_id>` is always the short display id** — `coo:695`, `1:899`: a workspace prefix, a colon, and a number. Pass it as `--mission-id`. **`<objective_id>`** is the objective display id (`coo:695.k7xm`) or UUID; pass it as `--objective-id` when you know which objective to execute. Never pass an objective id as `--mission-id`. If the prompt includes `OVERLORD_OBJECTIVE_ID` or an Objective ID line, include `--objective-id` on attach. If the only id you can find is a bare UUID with no mission display id, re-read the prompt or run `ovld protocol search-missions` rather than guessing.

**An objective display id is a complete address.** `coo:695.k7xm` already spells its mission, so `--mission-id` is optional on every command whenever you pass a full objective display id as `--objective-id`; Overlord derives `coo:695` from it. This is the identifier to reach for when reconnecting to a mission that is running more than one objective, where "the active objective" is ambiguous and a mission id alone is not enough. An objective **UUID** names no mission, so it still needs `--mission-id` alongside it.

1. Attach first with `ovld protocol attach --mission-id <mission_id> [--objective-id <objective_id>]`.
2. The attach response prints JSON to stdout containing `session.sessionKey`. The CLI also persists this key automatically so subsequent `ovld protocol` commands in the same working directory resolve it without `--session-key`. If auto-resolution fails, pass `--session-key <sessionKey>` explicitly on every subsequent call.
3. Treat the Overlord mission prompt as authoritative for the objective, constraints, and delivery target. Begin executing the current objective immediately after attach; do not wait for more instructions or ask for confirmation. This differs from `connect` or `load-context`, which only retrieve mission context and never imply the agent should act.
4. Post updates while working: `ovld protocol update --session-key <sessionKey> --mission-id <mission_id> --summary "..." --phase execute`.
   During long mechanical stretches with nothing meaningful to post, send `ovld protocol heartbeat --session-key <sessionKey> --mission-id <mission_id> [--phase execute] [--percent <0-100>] [--note "..."]` instead of an empty update.
5. Follow-up messages after the initial mission are captured automatically by the installed `UserPromptSubmit` hook and stay in discussion intent while the mission is in review. Do not post `user_follow_up` manually unless the hook is unavailable.
6. If blocked, call `ovld protocol ask --session-key <sessionKey> --mission-id <mission_id> --question "..."` and stop.
7. Deliver last with `ovld protocol deliver --session-key <sessionKey> --mission-id <mission_id> --summary "..."`. Normal delivery is summary-only; objective-ledger evidence syncs independently.

When review facts genuinely apply, you may add `deliveryReport.agentReport` through `--payload-json` / `--payload-file`: use
`humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, and `assumptions`, with empty arrays
when none apply. Human actions are concrete work a user must perform outside completed agent work;
never include Git operations or routine review/testing. Tradeoffs record the implementation decision,
alternatives considered, and rationale. These fields improve review visibility but never block delivery.

For full command syntax, flags, phase values, and event types see **CLI Command Reference** below.

## Missions vs Objectives

**Missions** represent whole features or goals. **Objectives** are the individual steps to implement that goal — one objective equals one agent prompt.

Example:

```
Mission: add CLI command for editing user profile
 - Objective 1: draft plan for this command
 - Objective 2: implement phase 1 of plan
 - Objective 3: implement phase 2 of plan
 - Objective 4: update documentation
```

When to create a mission vs an objective:

- **Create a new mission** when the user describes a distinct feature, bug, or goal that stands on its own.
- **Add objectives to an existing mission** when the work is a sequential step toward the same feature or goal already tracked in a mission.

To add further objectives to an existing mission (Mode 2):

```
ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."},{"objective":"..."}]'
```

## Objective Submission vs Execution

Discussing or otherwise opening a mission from within a chat should cause the draft objective to be marked **submitted** — this signals the mission is in active discussion with an agent, but not yet being executed. Only an explicit order to execute (e.g. "execute this", "do this", "start working on it") should cause you to **attach** to the mission and trigger execution.

- **Discussing / opening a mission** → `ovld protocol discuss-objective --mission-id $MISSION_ID` (draft → submitted, no session). Add `--objective-id <objective_id>` when the mission holds more than one draft and you mean a specific one.
- **Creating a mission** via `ovld protocol create` keeps the objective in `draft` state.
- **Explicitly ordered to execute** → `ovld protocol attach --mission-id $MISSION_ID` (draft/submitted → executing, session begins).

Do not attach to a mission just because it was mentioned or opened in conversation. Only attach when the user clearly asks you to execute the work.

## Mode 2: Asked From Chat To Use Overlord

Use this mode when the conversation starts normally and the user asks the agent to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create missions (and does not ask to start execution), run `ovld protocol create --agent <agent-identifier> --objectives-json '[{"objective":"..."}]'`.
   - When `--session-key` and `--mission-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord project resource directories, then creates a standalone draft.
   - Pass multiple items in `--objectives-json` when creating ordered steps for the same feature or goal.
   - If the user wants to **add more objectives to an existing mission** (not create a new mission), use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'` instead.
2. Default to `create` for new missions. Only use `ovld protocol prompt --agent <agent-identifier> --objectives-json '[{"objective":"..."}]'` when the user explicitly asks to create and execute immediately.
   `prompt` creates the mission in `execute` status and attaches immediately.
3. If the user already has a mission ID and only wants to inspect it, run `ovld protocol load-context --mission-id <mission_id>`. To read one specific objective's context — the only way to read context on a mission running objectives in parallel — add `--objective-id <objective_id>` (or pass it alone).
   When you open or discuss an existing mission that has a draft objective, submit it with `ovld protocol discuss-objective --mission-id <mission_id>`.
4. If the user wants to route the current session onto an existing mission by ID, run `ovld protocol connect --mission-id <mission_id>` (add `--objective-id <objective_id>` to pin the session to a specific objective).
5. If the user wants to establish a persistent session with a mission by ID, run `ovld protocol attach --mission-id <mission_id>`.
6. If the user wants to find a mission but does not know the ID, run `ovld protocol search-missions --query "..." --status execute,review` and ask the user to confirm.
7. If you need to understand project routing before prompting, use `ovld protocol discover-project`.
8. If the user wants to **record work that is already finished** in this chat (for example, something you just built in a chat app) as a completed mission, run `ovld protocol record-work` (or the hosted `overlord_record_work` MCP tool). This creates a mission with one completed objective, records explicitly supplied changed files and optional rationales, lands it in the review column, and runs the standard Gemini delivery summary — all in one call, with no `attach`/`deliver`. Do **not** use it for in-progress work. The exact submission format is in [reference/record-work.md](reference/record-work.md).
9. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
10. Once you attach to a mission, switch back to Mode 1 and follow the full mission lifecycle.

For mission creation examples, project discovery, and `--objectives-json` format see **CLI Command Reference** below. For recording already-completed work, see [reference/record-work.md](reference/record-work.md).

## CLI Command Reference

### Attach

```bash
ovld protocol attach --mission-id $MISSION_ID
ovld protocol attach --mission-id $MISSION_ID --objective-id $OBJECTIVE_ID   # pin the objective
ovld protocol attach --objective-id $OBJECTIVE_ID                            # display id only
```

The third form works because an objective display id (`coo:695.k7xm`) already
names its mission — use it when reconnecting and the mission id is not at hand.

`attach` establishes the objective/session binding used by the local change ledger. It does not snapshot or diff the working tree.

### Update

```bash
ovld protocol update --session-key <sessionKey> --mission-id $MISSION_ID --summary "What you did and why." --phase execute
```

### Heartbeat

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

### Ask

```bash
ovld protocol ask --session-key <sessionKey> --mission-id $MISSION_ID --question "Specific question for the PM."
```

### Deliver

```bash
ovld protocol deliver --session-key <sessionKey> \
  --mission-id $MISSION_ID \
  --summary "Narrative: what you did and next steps."
```

This is the normal delivery shape: a summary is sufficient. The CLI syncs objective-ledger
evidence independently before the lifecycle transition.

After running a generator, migration, or script that writes files, you may add its known outputs
to this existing call with `--paths path/one.ts,path/two.ts`. This is optional, paths-only
metadata for outputs the native hook cannot name; never use it to enumerate every changed or
opened file, and never make a separate call just to declare paths.

Artifacts, optional change rationales, and a delivery report remain current annotations when
they add review value. Use `--payload-json` when the full delivery object fits comfortably inline
(roughly under 8 KB). Larger inline `--*-json` values are rejected; stream them through the
corresponding `--*-file -` flag. A real scratch path belongs under `.overlord/tmp` and should be
removed after delivery.

If `heartbeat` succeeds but `deliver` or `update` fails, the session is likely fine — retry with the corresponding `--*-file -` flag instead of inline `--*-json`.

### Delivery Evidence

Send agent-authored facts in the delivery payload; Overlord stores an immediate deterministic
presentation, so do not wait for or invoke an AI provider.

```json
{
  "deliveryReport": {
    "schemaVersion": 1,
    "agentReport": {
      "humanActions": [],
      "tradeoffsMade": [],
      "knownRisks": [],
      "deferredWork": [],
      "assumptions": []
    }
  }
}
```

Only list a human action when a person must perform a concrete non-Git step outside the
agent's completed work (for example, add a secret, run a production migration, deploy, or
configure an external integration). Never list committing, pushing, opening a pull request,
reviewing code, or ordinary tests. A tradeoff must state the decision, alternatives considered,
and rationale. Omit the report when none of these facts apply.

### Change ledger health (diagnostic)

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

### Optional Change Rationales

Rationales are optional annotations. Overlord records which files an objective changed on its
own, so a delivery never needs them and can never fail for lacking them. Supply one only when
the reason for a change is not obvious from the diff.

Attach them to `update` while working, or to `deliver` at the end. Inline
`--change-rationales-json` is fine for a few entries; larger arrays are **rejected** — use
`--change-rationales-file -` and stream JSON on stdin. The same ~8 KB inline limit applies to
`--payload-json` and other `--*-json` flags.

**Fields per entry:** `filePath`, `label`, `summary`, `why`, `impact` (all strings).
Use the canonical `filePath` spelling. Do not wrap the entry under a `rationale` key.

**Never revert, restore, or delete file changes from other agents or missions.** Leave
unrelated dirty files intact.

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

### Project Discovery And Mission Creation

When creating missions from within a repository:

- Prefer `create` by default for draft mission creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override or `--project-id` to be explicit.
- Follow-up `create` calls under an active session inherit the current mission's project by default, but `--project-id` can override that when the follow-up belongs in a different project.
- Create multiple missions when each prompt represents a different feature or goal.
- Add objectives to the same mission when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`.
- `create` and `prompt` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "objective": "...", "title": "...", "autoAdvance": true }` objects. A single objective is just an array with one item. `--auto-advance` / `--no-auto-advance` set the default when an item omits `autoAdvance` (default off).
- `add-objectives` uses the same per-item `autoAdvance` field and `--auto-advance` / `--no-auto-advance` default.
- To change auto-advance on an existing objective: `ovld protocol update-objective --objective-id <id> --auto-advance` or `--no-auto-advance`.
- `record-work` is different: it creates exactly one **completed** objective. It takes a single `--objective` (or positional / an `objective` field in `--payload-json`) plus a `--summary` and the file-change data — not `--objectives-json`. See [reference/record-work.md](reference/record-work.md).
- `create`, `prompt`, `create-mission`, and `record-work` accept `--assigned-to <member>` to set the mission's human owner. Accepts a username, an email, a user-id UUID, or the `orgid:username` member ID. When omitted, the assignee defaults to the mission creator.

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

#### Local Durability For New Missions

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

### Creating Projects

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

#### Resolving the project ID when you don't have one

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

## Delivery And Change Evidence

Normal delivery contains the narrative summary only. The CLI synchronizes objective-ledger
evidence independently; neither the agent nor a shared working tree supplies an ownership list.

- Add a change rationale only when a non-obvious implementation reason materially helps review.
- Do not send `file_changes` as an artifact or reconstruct paths from `git status`.
- `ovld protocol changes` is a ledger-sync and hook-health diagnostic. It does not classify
  ownership or draft annotations.
- Do not include unrelated worktree changes in delivery annotations or artifacts.
- **Never revert, restore, or delete file changes from other agents or missions.**
- A read-only result uses the same delivery command; summarize that no code change was needed.

The optional annotation shape and `--change-rationales-file -` guidance are under **Optional Change Rationales** above.

## Rules

- Always attach first and always deliver last once you are on a mission.
- `--objective-id` is accepted anywhere `--mission-id` is, and a full objective display id (`coo:695.k7xm`) makes `--mission-id` optional. Prefer passing it on every call once you know which objective you are running, so events, artifacts, and file changes land on that objective rather than on whichever one Overlord would rediscover.
- `attach` is itself the go-ahead to start work — proceed with implementation immediately after attaching, without pausing to ask the user whether to continue. Only `connect` or `load-context` are for inspection without action; do not treat `attach` the same way.
- Use `ovld protocol` commands and the connector's native commands/tools instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- Include at least one progress update before delivering.
- After delivery, answer ordinary questions and clarifications in discussion mode; hook capture records those user turns as `user_follow_up` activity.
- When explicit follow-up implementation starts on a delivered/review mission and no live session exists, call `ovld protocol resume-follow-up --mission-id <mission_id> --summary "Beginning follow-up work."` and use the returned session key before code changes.
- When explicit follow-up implementation starts while a live delivered session still accepts updates, call `ovld protocol update --begin-follow-up-work --follow-up-intent execution --summary "Beginning follow-up work."` before code changes or `--phase execute`.
- During follow-up execution, post progress updates and let the objective ledger capture file evidence as during initial execution.
- Record important non-file decisions with `--event-type decision` or `--event-type discussion_summary`.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- When a summary or question contains backticks, `$vars`, or other shell-special characters, always use `--summary-file -` (or `--question-file -`) with a single-quoted heredoc (`<<'EOF'`). Never retry by stripping or escaping content — pipe stdin instead. See [reference/shell-escaping.md](reference/shell-escaping.md).
- Use `write-context` for facts a future agent session should know.
- Use `add-artifact` (or MCP `overlord_add_artifact`) to publish a plan, notes, decision, or URL artifact during a turn without delivering. Delivery may still attach additional artifacts later.
- Use `update-artifact` (or MCP `overlord_update_artifact`) to revise an existing mission artifact in place instead of delivering a duplicate when a later objective updates a plan or notes.
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` yourself before asking the user to log in again or proceed without Overlord updates.
- If you must run `ovld auth login`, `--organization-id <id>` is optional — it validates/scopes that login or command but does not create a stored default organization.
- Do not add or commit changes unless the user explicitly asks you to commit.
- **Never revert, restore, or delete concurrent work from other agents or missions** to deliver your own changes. Leave unrelated dirty files intact.
- Delivery is the concluding step. After delivering, stop implementation work unless the user explicitly asks for follow-up execution; once follow-up execution is complete, deliver again.

## Reference

- [reference/cli.md](reference/cli.md) — Full protocol command syntax, flags, phases, mission creation, and project discovery
- [reference/record-work.md](reference/record-work.md) — Recording already-completed chat work as a review mission: the exact CLI/MCP submission format for `record-work` / `overlord_record_work`
- [reference/mcp.md](reference/mcp.md) — MCP tool naming, key casing, hosted vs local shim defaults
- [reference/devices.md](reference/devices.md) — Device fingerprints, project resources, and `--for-human`
- [reference/context.md](reference/context.md) — Shared state, attachments, and large artifact policy
- [reference/shell-escaping.md](reference/shell-escaping.md) — Heredoc input through explicit `--*-file -` flags

<!-- version: 0.6.0 -->
