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
   During long mechanical stretches with nothing meaningful to post, send `ovld protocol heartbeat --session-key <sessionKey> --mission-id <mission_id> [--phase execute] [--note "..."]` instead of an empty update.
5. Follow-up messages after the initial mission are captured automatically by the installed `UserPromptSubmit` hook and stay in discussion intent while the mission is in review. Do not post `user_follow_up` manually unless the hook is unavailable.
6. If blocked, call `ovld protocol ask --session-key <sessionKey> --mission-id <mission_id> --question "..."` and stop.
7. Deliver last with `ovld protocol deliver --session-key <sessionKey> --mission-id <mission_id> --summary "..."`. Normal delivery is summary-only; objective-ledger evidence syncs independently.

When review facts genuinely apply, you may add `deliveryReport.agentReport` through `--payload-json` / `--payload-file`: use
`humanActions`, `tradeoffsMade`, `knownRisks`, `deferredWork`, and `assumptions`, with empty arrays
when none apply. Human actions are concrete work a user must perform outside completed agent work;
never include Git operations or routine review/testing. Every human action needs `action`, `reason`,
and `category`; add `command`, `verify`, and `link` whenever they exist so the operator can act
without re-reading the delivery (see **Delivery Evidence** below). Tradeoffs record the
implementation decision, alternatives considered, and rationale.
Each `deferredWork` item is one recommended objective outside this mission. Be very
concise. `title` names the work in an imperative phrase. `change` states only the specific
change that is needed. `location` says where to find it in the code: the file, function,
component, or command. `doneWhen` states the observable result in one sentence. Do not add
instructions on how to do the work, background, or rationale. The operator turns the item
into an objective or a mission as written, so it must read as a task, not as a note.
Never list work already covered by this mission's future objectives, leftover slices of
the current objective (add an objective to this mission instead), or human implementation
follow-up such as deploy, secrets, or migrations (those belong in `humanActions`). Use an
empty array when nothing qualifies. These fields improve review visibility but never block
delivery.

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

1. If the user wants to create missions (and does not ask to start execution), resolve the intended project and run `ovld protocol create --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"objective":"..."}]'`.
   - When `--session-key` and `--mission-id` are provided, it creates a follow-up draft.
   - Creation never infers a project. If the user explicitly asks to capture work outside every project, use `--unassigned-to-project`; otherwise resolve a project first with `ovld protocol discover-project` and pass its id.
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
8. If the user wants to **record work that is already finished** in this chat (for example, something you just built in a chat app) as a completed mission, run `ovld protocol record-work --project-id <project-id>` (or the hosted `overlord_record_work` MCP tool). This creates a mission with one completed objective, records any paths you declare as Declared evidence, lands it in the review column, and runs the standard Gemini delivery summary — all in one call, with no `attach`/`deliver`. Do **not** use it for in-progress work. The exact submission format is in [reference/record-work.md](reference/record-work.md).
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
evidence independently before the lifecycle transition, and tracking gaps or sync failures never
block delivery. See **Delivery And Change Evidence** below for how to prepare the summary.

When you know you changed files that native capture could not name (shell or heredoc writes,
script or generator outputs, deletes, and both endpoints of a rename), add exactly those to the
same `update` or `deliver` call with `--paths path/one.ts,path/two.ts`, or `--paths-file <path|->`
with a JSON string array when a path contains a comma or the list is long. They are recorded as
Declared, never as native capture. Never use it to enumerate every changed or opened file, and
never make a separate call just to declare paths.

If attach warns that its local binding or ledger is unavailable, keep the explicit
`--session-key` and `--objective-id` on `update` / `deliver` and include the known missed
paths normally. The CLI still submits them through the authenticated session as Declared;
do not omit paths or replace the file evidence with a list in the summary. Check stderr for
acceptance/sync warnings. If fallback synchronization fails, repeat those declarations on a
later update/deliver because no local retry copy exists. Re-run attach in the intended checkout
with the same `OVLD_HOME` to restore native capture. `changes` reports the local coverage gap
in `capture.healthCodes`; `objective-changes` reads synchronized evidence, including fallback
declarations, from the server.

Artifacts and a delivery report remain optional annotations when they add review value. There
is no per-file explanation input. Use `--payload-json` when the full delivery object fits comfortably inline
(roughly under 8 KB). Larger inline `--*-json` values are rejected; stream them through the
corresponding `--*-file -` flag. A real scratch path belongs under `$OVERLORD_TMPDIR` (this launch's private
`.overlord/tmp/sessions/<id>/` directory); `deliver` removes that directory for you, and nothing
else under `.overlord/tmp` is yours to delete.

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
and rationale.
Each `deferredWork` item is one recommended objective outside this mission. Be very
concise. `title` names the work in an imperative phrase. `change` states only the specific
change that is needed. `location` says where to find it in the code: the file, function,
component, or command. `doneWhen` states the observable result in one sentence. Do not add
instructions on how to do the work, background, or rationale. The operator turns the item
into an objective or a mission as written, so it must read as a task, not as a note.
Never list work already covered by this mission's future objectives,
leftover slices of the current objective (add an objective to this mission instead), or
human implementation follow-up such as deploy, secrets, or migrations (those belong in
`humanActions`). Use an empty array when nothing qualifies. Omit the report when none of these facts apply.

#### Writing a deferred-work item

| Field      | Limit     | What to write                                                |
| ---------- | --------- | ------------------------------------------------------------ |
| `title`    | 80 chars  | The work, as an imperative phrase. Shown as the row title.   |
| `change`   | 400 chars | The specific change that is needed, in one or two sentences. |
| `location` | 200 chars | Where to find it: the file, function, component, or command. |
| `doneWhen` | 200 chars | The observable result, in one sentence.                      |

All four fields are required. A plain string item is rejected with `invalid_input`.

> Vague: `{ "title": "Fix flaky test", "change": "The sync worker has a flaky test.", "location": "backend", "doneWhen": "It passes." }`
> Good: `{ "title": "Advance the fake clock before the second retry", "change": "The test asserts the retry fired but never advances the fake clock between attempts, so it passes or fails on real time.", "location": "backend/sync-worker.test.ts › retries after a 503", "doneWhen": "The test passes 20 consecutive runs with the fake clock driving both attempts." }`

#### Writing a human action the operator can complete

Human actions are shown on the delivery card, where the operator reads them without your
session transcript. Each item must stand alone:

| Field      | Expected   | What to write                                                                                     |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `action`   | required   | One imperative sentence naming the exact thing to do, where, and with what value.                 |
| `reason`   | expected   | Why the step is needed and what breaks or stays incomplete until it is done.                      |
| `category` | expected   | `environment`, `database`, `deployment`, `codegen`, `packaging`, `external_service`, or `other`.  |
| `blocking` | optional   | `true` when the delivered work does not function until this is done.                              |
| `command`  | when known | The exact command, setting name, or value to apply, verbatim. Placeholders in `<angle brackets>`. |
| `verify`   | when known | How the operator confirms it worked: a command to run, a URL to open, or the state to observe.    |
| `link`     | when known | An HTTP(S) URL or a repository-relative file path (never another URI scheme).                     |

Vague (the operator has to rediscover everything):

```json
{ "action": "Set up the env var for Gemini." }
```

Good (the operator can finish it from the card alone):

```json
{
  "action": "Add GEMINI_API_KEY to the production backend service on Railway.",
  "reason": "The delivery-compose worker falls back to the raw summary until a provider key is present.",
  "category": "environment",
  "blocking": false,
  "command": "railway variables set GEMINI_API_KEY=<key> --service backend",
  "verify": "The next delivery card shows a composed presentation instead of 'fallback' in the worker log.",
  "link": ".env.example"
}
```

Overlord also derives its own `deterministic_rule` actions from the changed paths (new
migrations, `.env.example` changes, dependency manifests, CI workflow files) and always shows
them, so leaving one out never hides it; reporting it yourself with a real `command` and
`verify` replaces the generic wording with something the operator can follow.

### Reading captured file evidence

Read the objective's captured paths once before you write the delivery summary:

```bash
ovld protocol changes --objective-id $OBJECTIVE_ID
```

This is a local read of this checkout's sessions for the objective. It syncs pending ledger
entries first (sync failure is advisory), then returns synced and pending paths deduplicated by
path, capped at 200 rows with a pre-cap `total` and `truncated`, plus capture and sync warnings.
`coverage: "unavailable"` means no local session matched, not "no files changed". It is not
complete cross-device history: `ovld protocol objective-changes --objective-id $OBJECTIVE_ID`
(hosted MCP `overlord_changes`) reads the objective's synchronized evidence across sessions,
resources, and devices, but cannot see unsynchronized local rows. Neither read diffs the
worktree, classifies ownership, or gates delivery.

Each row is cumulative objective evidence, including edits later reverted, with a source:

- `declared_edit` (shown as Native): at least one successful native edit callback named the path.
- `agent_declared` (shown as Declared): you or a record-work call declared the path.
- `null` (shown as Unknown): historical evidence whose provenance could not be established.

Native capture appends a path only for a codec-normalized edit whose outcome is successful.
Reads, searches, and fetches are silent. Warnings tell you where capture may be incomplete:

- `shell_activity_unverified`: a shell command ran; it may or may not have written files.
- `outcome_partial` / `outcome_unavailable`: an edit failed partway or its result was unknown,
  so no path was recorded.
- `direct_path_unavailable`: a tool ran that capture cannot map to paths.
- Binding warnings: tracking was not active for the session (unbound), is configured but no
  callback has been observed, or its availability is unknown (hosted).
- Sync warnings: some captured paths have not synchronized yet.

A warning is not proof that a file changed. Declare only files you know you changed and capture
missed; when unsure, say in the summary that coverage may be incomplete instead of guessing.

### Shared worktree safety (critical)

The working tree may contain file changes from **other agents, missions, or objectives** running concurrently in the same checkout or worktree. Those changes are **not yours to undo**.

**Never revert, delete, or restore another agent's work to make delivery succeed.** This includes:

- `git checkout`, `git restore`, `git reset`, or any command that rolls back uncommitted edits you did not make for this mission
- Deleting or overwriting files you do not recognize as your own

If `git status` shows dirty paths outside your work, leave them intact. The ledger is evidence
about the addressed objective, not an ownership arbiter for a shared worktree. Read-only work
uses the same summary-only delivery as every other objective.

Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

### Declaring paths native capture missed

Per-file explanations no longer exist: `--change-rationales-*`, `--changed-files-*`, and the
`changeRationales` / `changedFiles` payload fields are rejected. Explain changes in the summary.

Declare known misses on the call you are already making. A rename declares both endpoints, and
a deleted or renamed-away path is valid even though it no longer exists:

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID \
  --summary "Narrative: what you did and next steps." \
  --paths src/generated/schema.ts,docs/old-name.md,docs/new-name.md
```

For a long list, or a path containing a comma, stream a JSON string array:

```bash
ovld protocol deliver --session-key <sessionKey> --objective-id $OBJECTIVE_ID \
  --summary "Narrative: what you did and next steps." \
  --paths-file - <<'EOF'
["src/generated/schema.ts", "fixtures/a,b.json"]
EOF
```

For spaces, quote the whole inline value, for example
`--paths "planning/demo environment.md,src/generated.ts"`, or use the JSON array form.

Paths are normalized against the checkout. Traversal, symlinks that leave the checkout, ignored
paths, and Overlord-managed paths are rejected with a reason on stderr and never fail the call.

### Project Discovery And Mission Creation

When creating missions from within a repository:

- Prefer `create` by default for draft mission creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- `create`, `prompt`, and `record-work` require an explicit `--project-id`; use `discover-project` first when the project is known only from the checkout. They never infer a destination project.
- Use `create --unassigned-to-project` only when the user deliberately requests an account-owned inbox capture. `--inbox` is a compatibility alias.
- Create multiple missions when each prompt represents a different feature or goal.
- Add objectives to the same mission when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"..."}]'`.
- `create` and `prompt` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "objective": "...", "title": "...", "autoAdvance": true }` objects. A single objective is just an array with one item. `--auto-advance` / `--no-auto-advance` set the default when an item omits `autoAdvance` (default off).
- `add-objectives` uses the same per-item `autoAdvance` field and `--auto-advance` / `--no-auto-advance` default.
- **Assign the agent on the objectives you are already creating.** Every objective item on `create`, `prompt`, and `add-objectives` takes optional `"agent"` (and `"model"`, which requires an agent), and `--objective-agent <id>` / `--objective-model <id>` set the default for items that name no `agent` of their own. Never create a mission and then append a second objective just to name an agent — that leaves a duplicate objective behind. Note this is **not** `--agent`, which records who created the mission (and, on `prompt`, which agent attaches).
- To change auto-advance on an existing objective: `ovld protocol update-objective --objective-id <id> --auto-advance` or `--no-auto-advance`.
- `record-work` is different: it creates exactly one **completed** objective. It takes a single `--objective` (or positional / an `objective` field in `--payload-json`) plus a `--summary` and the file-change data — not `--objectives-json`. See [reference/record-work.md](reference/record-work.md).
- `create`, `prompt`, `create-mission`, and `record-work` accept `--assigned-to <member>` to set the mission's human owner. Accepts a username, an email, a user-id UUID, or the `orgid:username` member ID. When omitted, the assignee defaults to the mission creator.

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

#### Resolving the project ID when you don't have one

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

## Delivery And Change Evidence

The reviewer sees your summary and, separately, a cumulative **Files changed during this
objective** list grouped by resource. Prepare delivery cheaply:

1. Read the captured paths once (`ovld protocol changes --objective-id <id>`, or
   `overlord_changes` over MCP). See **Reading captured file evidence** above.
2. If capture warns about shell, partial, or unsupported activity and you know of files you
   changed that it missed, declare exactly those with `--paths` / `--paths-file` on `deliver`.
3. Write the summary by behavior or component: the outcome, why it matters, how you verified it,
   and material limitations, including any capture gap you could not reconcile. A handful of
   representative paths is enough; never enumerate every file or explain files one by one.

- Do not run `git status` or `git diff` on a shared worktree to build the list, and do not send
  `file_changes` artifacts. Never infer ownership from timestamps, cwd, a branch, or an
  unrelated dirty file.
- The list is not a Git diff, a delivery-time snapshot, or proof of exclusive ownership; late
  synchronization may extend it after delivery. That never blocks or invalidates delivery.
- **Never revert, restore, or delete file changes from other agents or missions.**
- A read-only result uses the same delivery command; summarize that no code change was needed.

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

<!-- version: 0.8.0 -->
