---
name: overlord-mission
description: Use for chat-started Overlord work, when the user refers to an Overlord mission, ticket or objective and asks to create, find, inspect, discuss, connect or attach. Not needed in a session that Overlord launched, where the attach response carries the instructions.
---

# Overlord Mission

Use this core when the user, in chat, refers to an Overlord mission, ticket or objective and asks to create, find, inspect, discuss, connect or attach. Treat **ticket** as a user-facing synonym for **mission**. There is no separate `overlord-ticket` skill.

Connector adapters may add harness-specific commands, hooks, MCP tools, or launch flags, but they must not replace these rules.

## After You Attach

Once attached, whether from chat or because Overlord launched the session, follow the instructions in the attach response. They carry the working rules, delivery rules, mission summary rules and recovery steps, and take precedence over this skill. Payload examples, limits and error shapes are in [reference/mission-summary.md](reference/mission-summary.md). When attach reports other missions’ open items, use `project-items` / `overlord_project_items` before delivery and verify each resolution before closing. Standalone and delivery closes are both valid. Retain delivery retry identity/body; accepted withheld prose uses fresh publication bases and a separate retained publication operation id, never another close submission.

**`<mission_id>` is always the short display id** (`coo:695`, `1:899`). **`<objective_id>`** is the objective display id (`coo:695.k7xm`) or UUID. Never pass an objective id as `--mission-id`. A full objective display id already names its mission, so `--mission-id` is then optional; an objective UUID still needs `--mission-id`. If you only find a bare UUID, run `ovld protocol search` rather than guessing.

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

To add further objectives to an existing mission:

```
ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"instructions":"..."},{"instructions":"..."}]'
```

## Objective Submission vs Execution

Discussing or otherwise opening a mission from within a chat should cause the draft objective to be marked **submitted** — this signals the mission is in active discussion with an agent, but not yet being executed. Only an explicit order to execute (e.g. "execute this", "do this", "start working on it") should cause you to **attach** to the mission and trigger execution.

- **Discussing / opening a mission** → `ovld protocol discuss-objective --mission-id $MISSION_ID` (draft → submitted, no session). Add `--objective-id <objective_id>` when the mission holds more than one draft and you mean a specific one.
- **Creating a mission** via `ovld protocol create` keeps the objective in `draft` state.
- **Explicitly ordered to execute** → `ovld protocol attach --mission-id $MISSION_ID` (draft/submitted → executing, session begins).

Do not attach to a mission just because it was mentioned or opened in conversation. Only attach when the user clearly asks you to execute the work.

## Working From Chat

Use this when the conversation starts normally and the user asks the agent to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create missions (and does not ask to start execution), resolve the intended project and run `ovld protocol create --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"instructions":"..."}]'`.
   - When `--session-key` and `--mission-id` are provided, it creates a follow-up draft.
   - Creation never infers a project. If the user explicitly asks to capture work outside every project, use `--unassigned-to-project`; otherwise resolve a project first with `ovld protocol discover-project` and pass its id.
   - Pass multiple items in `--objectives-json` when creating ordered steps for the same feature or goal.
   - If the user wants to **add more objectives to an existing mission** (not create a new mission), use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"instructions":"..."}]'` instead.
2. Default to `create` for new missions. Only use `ovld protocol prompt --agent <agent-identifier> --objectives-json '[{"instructions":"..."}]'` when the user explicitly asks to create and execute immediately.
   `prompt` creates the mission in `execute` status and attaches immediately.
3. If the user already has a mission ID and only wants to inspect it, run `ovld protocol load-context --mission-id <mission_id>`. To read one specific objective's context — the only way to read context on a mission running objectives in parallel — add `--objective-id <objective_id>` (or pass it alone).
   When you open or discuss an existing mission that has a draft objective, submit it with `ovld protocol discuss-objective --mission-id <mission_id>`.
4. If the user wants to route the current session onto an existing mission by ID, run `ovld protocol connect --mission-id <mission_id>` (add `--objective-id <objective_id>` to pin the session to a specific objective).
5. If the user wants to establish a persistent session with a mission by ID, run `ovld protocol attach --mission-id <mission_id>`.
6. If the user wants to find a mission but does not know the ID, run `ovld protocol search --query "..." --status execute,review` and ask the user to confirm.
7. If you need to understand project routing before prompting, use `ovld protocol discover-project`.
8. If the user wants to **record work that is already finished** in this chat (for example, something you just built in a chat app) as a completed mission, run `ovld protocol record-work --project-id <project-id>` (or the hosted `overlord_record_work` MCP tool). This creates a mission with one completed objective, records any paths you declare as Declared evidence, lands it in the review column, and runs the standard Gemini delivery summary — all in one call, with no `attach`/`deliver`. Do **not** use it for in-progress work. The exact submission format is in [reference/record-work.md](reference/record-work.md).
9. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
10. Once you attach, follow the instructions in the attach response.

For mission creation examples, project discovery, and `--objectives-json` format see **CLI Command Reference** below. For recording already-completed work, see [reference/record-work.md](reference/record-work.md).
## CLI Command Reference

### Attach

```bash
ovld protocol attach --mission-id $MISSION_ID
ovld protocol attach --mission-id $MISSION_ID --objective-id $OBJECTIVE_ID   # pin the objective
ovld protocol attach --objective-id $OBJECTIVE_ID                            # display id only
```

`attach` is the go-ahead to start work; `connect` and `load-context` only retrieve context. It establishes the objective/session binding used by the local change ledger and does not snapshot or diff the working tree. The response prints JSON with `session.sessionKey`; the CLI persists it for later `ovld protocol` calls in the same directory.

### Shared worktree safety (critical)

The working tree may contain file changes from **other agents, missions, or objectives** running concurrently in the same checkout or worktree. Those changes are **not yours to undo**.

**Never revert, delete, or restore another agent's work to make delivery succeed.** This includes:

- `git checkout`, `git restore`, `git reset`, or any command that rolls back uncommitted edits you did not make for this mission
- Deleting or overwriting files you do not recognize as your own

If `git status` shows dirty paths outside your work, leave them intact. The ledger is evidence
about the addressed objective, not an ownership arbiter for a shared worktree. Read-only work
uses the same summary-only delivery as every other objective.

Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.
### Project Discovery And Mission Creation

When creating missions from within a repository:

- Prefer `create` by default for draft mission creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- `create`, `prompt`, and `record-work` require an explicit `--project-id`; use `discover-project` first when the project is known only from the checkout. They never infer a destination project.
- Use `create --unassigned-to-project` only when the user deliberately requests an account-owned inbox capture.
- Create multiple missions when each prompt represents a different feature or goal.
- Add objectives to the same mission when each prompt is a sequential step toward the same feature or goal; use `ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"instructions":"..."}]'`.
- `create` and `prompt` require `--objectives-json` or `--objectives-file` with an ordered array of `{ "instructions": "...", "title": "...", "summary": "...", "autoAdvance": true }` objects. A single objective is just an array with one item. `--auto-advance` / `--no-auto-advance` set the default when an item omits `autoAdvance` (default off).
- `add-objectives` uses the same per-item `autoAdvance` field and `--auto-advance` / `--no-auto-advance` default.
- **Assign the agent on the objectives you are already creating.** Every objective item on `create`, `prompt`, and `add-objectives` takes optional `"agent"` (and `"model"`, which requires an agent), and `--objective-agent <id>` / `--objective-model <id>` set the default for items that name no `agent` of their own. Never create a mission and then append a second objective just to name an agent — that leaves a duplicate objective behind. Note this is **not** `--agent`, which records who created the mission (and, on `prompt`, which agent attaches).
- To change auto-advance on an existing objective: `ovld protocol update-objective --objective-id <id> --auto-advance` or `--no-auto-advance`.
- `record-work` is different: it creates exactly one **completed** objective. It takes a single `--objective` (or positional / an `objective` field in `--payload-json`) plus a `--summary` and the file-change data — not `--objectives-json`. See [reference/record-work.md](reference/record-work.md).
- `create`, `prompt`, `create-mission`, and `record-work` accept `--assigned-to <member>` to set the mission's human owner. Accepts a username, an email, a user-id UUID, or the `orgid:username` member ID. When omitted, the assignee defaults to the mission creator.

```bash
ovld protocol create --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"instructions":"Capture follow-up work from this repository"}]'
```

```bash
# One call: a draft mission whose first objective is already assigned to Codex.
ovld protocol create --agent <agent-identifier> \
  --project-id <project-id> \
  --objectives-json '[{"instructions":"Implement the API","agent":"codex","model":"gpt-6.1-terra"},{"instructions":"Add CLI docs","agent":"claude"}]'
```

```bash
ovld protocol prompt --project-id <project-id> --agent <agent-identifier> --objectives-json '[{"instructions":"Implement feature X"}]'
```

```bash
ovld protocol add-objectives --mission-id 1:899 --objectives-json '[{"instructions":"Implement the API","autoAdvance":true},{"instructions":"Add CLI docs"}]'
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

#### Objective Instructions and Summary

Each objective has two texts with different readers. **Do not swap them.**

| Field | Reader | Content | Usually |
| --- | --- | --- | --- |
| `instructions` (`--objective-instructions`) | The executing agent; it receives nothing else | The complete brief: context, steps, constraints, done-when | The LONG text |
| `summary` (`--objective-summary`) | The person who decides whether to launch | One to three prose paragraphs, about 120 words: the goal first, the done-when sentence last. No headings or numbered steps | The SHORT text |

- Write the summary in Simplified Technical English style. You may omit it: Overlord writes one for long (280+ characters) agent-written objectives. Shorter instructions are shown in full.
- Pass it as per-item `"summary"` in `--objectives-json` (`create`, `prompt`, `add-objectives`), as `--objective-summary <text>` / `--objective-summary-file <path|->` with `--objective-instructions`, or later with `ovld protocol update-objective --objective-id <id> --summary <text>` (or `--summary-file`). `--summary-request summarize|regenerate|retry` asks Overlord to write one instead.
- **Swap warning.** If the summary is at least 3 times as long as its instructions (and 400+ characters) the response carries an `objective_fields_swapped` warning saying the texts look swapped; a weaker signal (1.5 times longer, or headings, numbered steps or a `Done when:` label over short instructions) carries the same code. Both texts are stored as written. When you get this warning, check the objective and fix a swap with `ovld protocol update-objective --objective-id <id> --instruction-text-file <brief> --summary <overview>`.
- Agents may change summaries only on `draft` objectives (400 `summary_not_editable`). An empty `--summary` removes the summary.
- Style issues come back as advisory `warnings` (`summary_style`); the text is stored as written. Fix them if you can, but they never block the write.
- **Never fight a person's removal.** If a person removed the summary, your text is not stored (warning `summary_suppressed`) and summary requests are refused (409 `summary_suppressed`). Do not retry or work around it; only the person's Summarize in the app turns summaries back on.

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
`--summary <text>` and `--slug <text>` are also accepted. There is no `--color`
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
## Rules

- Do not attach to a mission only because it was mentioned. Attach when the user asks you to execute the work.
- Use `ovld protocol` commands and the connector's native commands/tools instead of ad hoc scripts. Do not invent subcommands; use `ovld protocol help` when unsure.
- When a summary or question contains backticks, `$vars`, or other shell-special characters, use `--summary-file -` (or `--question-file -`) with a single-quoted heredoc. See [reference/shell-escaping.md](reference/shell-escaping.md).
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` before asking the user to log in again. `--organization-id <id>` on `ovld auth login` only scopes that login.
- Do not add or commit changes unless the user explicitly asks you to commit.
- **Never revert, restore, or delete concurrent work from other agents or missions.**

## Reference

- [reference/mission-summary.md](reference/mission-summary.md) — Mission summary, delivery report and changed-files payload shapes, limits and error shapes (the rules themselves are in the attach response)
- [reference/cli.md](reference/cli.md) — Full protocol command syntax, flags, phases, mission creation, and project discovery
- [reference/record-work.md](reference/record-work.md) — Recording already-completed chat work as a review mission: the exact CLI/MCP submission format for `record-work` / `overlord_record_work`
- [reference/mcp.md](reference/mcp.md) — MCP tool naming, key casing, hosted vs local shim defaults
- [reference/devices.md](reference/devices.md) — Device fingerprints, project resources, and `--for-human`
- [reference/context.md](reference/context.md) — Shared state, attachments, and large artifact policy
- [reference/shell-escaping.md](reference/shell-escaping.md) — Heredoc input through explicit `--*-file -` flags

<!-- version: 1.0.0 -->
