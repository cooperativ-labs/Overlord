# Overlord Users Guide

This guide covers how to use Overlord after your initial setup. If you haven't completed the onboarding steps yet, start with the [New User Onboarding Guide](new-user-onboarding.md).

## Core Product Pieces

### Web App

The web app is the system of record.

Use it to:

- create and edit tickets
- organize work by project
- set status and priority
- review activity, questions, artifacts, and deliveries
- manage account and organization settings
- configure project-level details

### Desktop App

The desktop app is the local execution surface.

Use it to:

- Everyting the web app can do, and;
- link Overlord projects to local repository folders
- launch agents into the correct working directory
- keep terminal sessions close to the ticket
- review local Git changes in Current Changes
- inspect hunk-level change rationales
- manage local agent connectors

### CLI

The CLI supports both human workflows and agent protocol workflows. On your main workstation it is included with Overlord Desktop. Install the standalone CLI only on machines where Desktop is not present or not the right fit, such as a home server, remote shell, or automation host.

Common human commands:

```bash
ovld attach
ovld create "Investigate the failing build" --agent codex
ovld prompt "Draft a fix for the onboarding flow" --agent codex
ovld tickets list --status next-up
ovld ticket context <ticket_id>
ovld launch codex
ovld restart codex
```

Agent protocol commands live under `ovld protocol`. They are the stable lifecycle surface agents should use after receiving a ticket.

### MCP Server
The MCP server gives remote or hosted agent runtimes a tool-based way to work with Overlord. It is useful when an agent is not running through the local desktop app or a local terminal connector.
You can access the full tool documentation [here](https://www.ovld.ai/.well-known/overlord-mcp-tools.json).

Use cases include:

- reading ticket context from a hosted agent
- creating tickets from agent workflows
- posting updates and final delivery from cloud runtimes
- integrating Overlord into orchestration systems

## Projects and Local Working Directories

Projects are whole initiatives, ongoing or temporary, that share a code repository, folders, and other resources. For local work, they map tickets to the repository folders agents should use.

A good default is one project per codebase. For a monorepo, use one project when the same repo and review workflow owns the work. Split projects when different teams, repositories, permissions, or deployment surfaces need separate tracking.

In the desktop app, set the project's local working directory to an absolute folder path. When a ticket is launched for that project, agent terminals open there.

The CLI also uses local working directory matching. For example, when you create a ticket from inside a repository, Overlord can resolve the project whose configured local working directory matches the current directory:

```bash
ovld protocol discover-project
ovld protocol create --agent codex --objectives-json '[{"objective":"Capture follow-up work from this repository"}]'
```

For sequential steps toward the same feature or goal, create one ticket with ordered objectives:

```bash
ovld protocol create --agent codex \
  --objectives-json '[{"objective":"Draft the plan"},{"objective":"Implement the approved plan"}]'
```

Create multiple tickets instead when each prompt represents a different feature or goal.

When the work is already done in chat and you want to record it after the fact, use `record-work` instead of `create`:

```bash
ovld protocol record-work \
  --objectives-json '[{"objective":"User asked me to investigate the billing regression and summarize the fix."}]' \
  --summary "Confirmed the root cause, implemented the fix, added verification, and recorded the rationale."
```

Use `--project-id` when you want to bypass automatic project discovery:

```bash
ovld protocol create --agent codex --project-id <project-id> --objectives-json '[{"objective":"Add billing tests"}]'
```

Use `--personal` for private standalone tickets that should not be assigned to a project:

```bash
ovld protocol create --agent codex --personal --objectives-json '[{"objective":"Draft a private investigation note"}]'
```

## Tickets

Tickets are higher-level goals in Overlord, like a feature, bug fix, investigation, or review thread. They are composed of objectives that share context. A useful ticket usually includes:

- a clear title
- one or more concrete objectives that share context
- acceptance criteria when the expected result is specific
- status and priority
- project assignment
- execution target
- available tools or constraints when the agent needs boundaries

Execution target matters:

- `agent` means the work can be completed by an AI agent in a terminal, browser, editor, or hosted runtime.
- `human` means the task requires human judgment, credentials, physical-world action, business approval, or other work an agent cannot complete independently.

When in doubt, ask whether the work can be done entirely by an agent with available computer tools. If yes, use `agent`. If no, use `human`.

## Objectives

Objectives are the unit of work in Overlord: the prompt, agent choice, checkpoint, attachments, and execution state for one agent pass.

You can add more objectives over time instead of opening a new chat or duplicating context. Planning, implementation, review passes, and cleanup can all live on one ticket as separate objectives.

The agent’s instructions live at the objective level. The ticket keeps the shared context for the higher-level goal.

Typical fields and behaviors include:

- the instruction text (what to build, fix, or research)
- status for that slice of work (for example executing while an agent has it)
- attachments scoped to that instruction
- agent and model choice for that pass
- the checkpoint that anchors review and file-change rationale

Attachments belong to a specific objective so files stay tied to the task they support.

When to add a new objective:

- the first pass was “spike a design” and the next pass is “implement it”
- implementation is done and you want a dedicated review or hardening pass
- follow-up work appeared after delivery and should stay on the same ticket record

You do not need a new ticket for every follow-up if the work still belongs to the same story.

Agents can append ordered objectives to an existing ticket:

```bash
ovld protocol add-objectives \
  --ticket-id 1:899 \
  --objectives-json '[{"objective":"Add tests"},{"objective":"Update docs"}]'
```

Index 0 is the first newly added objective to execute; later indexes queue after it.

## The Normal Workflow

### 1. Create the Ticket

Create tickets in the web app, desktop app, or CLI.

For a draft ticket from the CLI:

```bash
ovld create "Investigate why invite emails are not sending" --agent codex
```

For a ticket that should be created and launched immediately:

```bash
ovld prompt "Fix the invite email regression" --agent codex
```

Agents should use the protocol equivalents:

```bash
ovld protocol create --agent codex --objectives-json '[{"objective":"Investigate why invite emails are not sending"}]'
ovld protocol prompt --agent codex --objectives-json '[{"objective":"Fix the invite email regression"}]'
ovld protocol add-objectives --ticket-id 1:899 --objectives-json '[{"objective":"Add tests"},{"objective":"Update docs"}]'
ovld protocol record-work --objectives-json '[{"objective":"User asked me to X; I completed it in chat."}]' --summary "Narrative for review and feed post."
```

Default to `create` when you want to capture future work as a draft. Use `prompt` when you explicitly want to start execution immediately. Use `record-work` when the work is already done in chat and should be recorded as a ticket in `review` with a generated feed post.

### 2. Launch the Agent

From the desktop app, open the ticket and launch it with the desired connector. Overlord starts the agent in the linked working directory and includes the ticket prompt, ticket ID, and protocol instructions.

From the CLI, use:

```bash
ovld attach
```

You can also launch or resume a specific agent:

```bash
ovld launch codex
ovld restart codex
```

### 3. Attach to the Ticket

The first thing an agent must do after receiving a ticket ID is attach:

```bash
ovld protocol attach --ticket-id <ticket_id>
```

Attach returns the ticket, objective IDs, attachments, history, artifacts, shared context, assembled prompt context, and a `session.sessionKey`. The session key is required for later lifecycle calls.

Agents can use `connect` when they only need a lightweight session key:

```bash
ovld protocol connect --ticket-id <ticket_id>
```

Agents can inspect a ticket without creating a working session:

```bash
ovld protocol load-context --ticket-id <ticket_id>
```

### 4. Post Progress Updates

Agents should post meaningful progress while working:

```bash
ovld protocol update \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --phase execute \
  --summary "Inspected the invite email flow and found the regression in the SMTP provider branch."
```

Supported update phases are:

- `draft`
- `execute`
- `review`
- `deliver`
- `complete`
- `blocked`
- `cancelled`

Use `execute` during active work.

Supported activity event types are:

- `update` for normal progress
- `user_follow_up` for a human message sent after the initial ticket
- `alert` for a warning or non-blocking issue

On connectors that support lifecycle hooks (Claude Code and Codex `UserPromptSubmit`, Cursor IDE `beforeSubmitPrompt` via `~/.cursor/hooks.json` after `ovld setup cursor` / desktop bundle install), follow-up user messages after the initial ticket are captured automatically and appear as `user_follow_up` events in the activity feed. If hooks are unavailable or misconfigured, the agent should publish the message verbatim before continuing:

```bash
ovld protocol update \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --phase execute \
  --event-type user_follow_up \
  --summary "User follow-up: <verbatim message>"
```

### 5. Ask When Blocked

If an agent needs a human decision or cannot continue safely, it should ask a blocking question:

```bash
ovld protocol ask \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --question "Which payment provider should remain the source of truth for failed invoice retries?"
```

After `ask` succeeds, the agent should stop until the human responds.

For tool permission prompts, installed connectors may use:

```bash
ovld protocol permission-request --ticket-id <ticket_id> --payload-file -
```

That is normally handled by connector hooks rather than typed manually.

### 6. Deliver the Work

When the work is done, the agent delivers a final narrative, artifacts, and change rationales:

```bash
ovld protocol deliver \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --summary "Updated the invite email flow, added regression coverage, and verified the targeted tests pass." \
  --artifacts-json '[{"type":"test_results","label":"Verification","content":"yarn test invite-email passed."}]' \
  --change-rationales-json '[{"label":"Fix invite email fallback","file_path":"lib/actions/invites.ts","summary":"Restored SMTP fallback handling.","why":"The previous branch skipped provider fallback when the primary response was empty.","impact":"Invite emails retry through the configured fallback provider again.","hunks":[{"header":"@@ -42,7 +42,13 @@"}]}]'
```

Use `--payload-json` when the complete delivery object fits comfortably inline. For larger delivery payloads, agents should prefer stdin so they do not create scratch JSON files:

```bash
ovld protocol deliver --session-key <session-key> --ticket-id <ticket_id> --payload-file -
```

Deliveries move the ticket into review. A human can then inspect the summary, artifacts, changes, and rationales before deciding what to do next.

### 7. Record Completed Work From Chat

When the agent already completed the work directly in chat and there is no attached session to deliver, use `record-work` instead of `create` + `attach` + `deliver`:

```bash
ovld protocol record-work --payload-file - <<'EOF'
{
  "objective": "User asked me to fix the invite email regression and explain the change.",
  "summary": "Fixed the fallback path, added verification, and documented the behavior for review.",
  "artifacts": [{"type":"test_results","label":"Verification","content":"Targeted invite email tests passed."}],
  "changeRationales": [{"label":"Restore fallback path","file_path":"lib/actions/invites.ts","summary":"Reintroduced SMTP fallback handling.","why":"The primary branch could return no provider and drop the send path.","impact":"Invite emails now retry through the configured fallback provider.","hunks":[{"header":"@@ -42,7 +42,13 @@"}]}]
}
EOF
```

Use this only for already-completed work. If the work still needs to happen, use `create` or `prompt` instead.

Project resolution follows the same working-directory rules as `create` and `prompt`. If Overlord cannot match the current directory to a project, ask for `--project-id`. Use `--personal` only when the work is not tied to any project.

## Change Rationales

Change rationales explain why a file changed. They are structured records stored alongside the ticket and surfaced in the desktop Change Viewer.

Each meaningful tracked file change should have a rationale with:

- a short label
- file path
- summary of what changed
- why the change was made
- expected impact
- relevant diff hunk headers

Agents can include rationales during `update`, record them separately, or include them in final `deliver`.

Record rationales without a normal progress update:

```bash
ovld protocol record-change-rationales \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --summary "Recorded rationale details for the latest docs changes." \
  --phase execute \
  --change-rationales-json '[{"label":"Expand user guide","file_path":"docs/overlord-new-user-guide.md","summary":"Added setup and protocol workflow detail.","why":"New users need the current end-to-end process in one place.","impact":"Readers can follow the current setup and ticket lifecycle without guessing.","hunks":[{"header":"@@ -1,225 +1,430 @@"}]}]'
```

Do not send file changes as a generic artifact. Use change rationales so Overlord can store them as first-class file-change records.

## Attachments, Artifacts, and Shared Context

Attachments are files tied to ticket objectives. Attach returns visible attachment IDs and objective IDs. Agents can refresh the list:

```bash
ovld protocol attachment-list --session-key <session-key> --ticket-id <ticket_id>
```

Upload a local file to an objective:

```bash
ovld protocol attachment-upload-file \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --objective-id <objective-id> \
  --file ./spec.pdf \
  --content-type application/pdf
```

Get a download URL for an attachment:

```bash
ovld protocol attachment-download-url \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --attachment-id <attachment-id>
```

Artifacts are structured delivery records submitted at final delivery time. Common artifact types include:

- `test_results`
- `next_steps`
- `note`
- `url`
- `decision`
- `migration`

Shared context is persistent ticket memory for future sessions. Use it for facts a later agent should know:

```bash
ovld protocol write-context \
  --session-key <session-key> \
  --ticket-id <ticket_id> \
  --key "repo.testing" \
  --value '"Use yarn test:e2e:ci for full browser regression checks."' \
  --tags repo,testing
```

Read it later:

```bash
ovld protocol read-context --session-key <session-key> --ticket-id <ticket_id>
```

## Review Workflow

After delivery, review the ticket in Overlord.

Check:

- the final summary
- test results and other artifacts
- open questions or caveats
- changed files in the desktop Current Changes view
- hunk-level change rationales
- whether the ticket objective and acceptance criteria were actually met

The desktop Change Viewer reads the linked local Git working directory. It does not upload repository contents just because the project is linked. It shows local uncommitted diffs and connects rationale records back to ticket activity.

## Security and Data Boundaries

Connecting a repository or opening a terminal does not automatically send your repository contents to Overlord.

Overlord stores:

- ticket fields and objectives
- ticket activity
- progress updates
- blocking questions
- delivery summaries
- artifacts
- uploaded attachments
- shared context
- structured change rationales

Overlord does not automatically store:

- arbitrary local file contents
- full repository contents
- terminal output unless an agent or user writes it into a ticket update
- secrets unless a user or agent explicitly puts them in ticket content

Treat ticket content as a persistent shared record. Do not paste secrets, private keys, production credentials, or sensitive customer data into ticket fields, updates, artifacts, or shared context.

## Troubleshooting

### The CLI Is Not Found on a Server or Remote Machine

If you are on a machine that does not have Overlord Desktop, install or reinstall the standalone CLI:

```bash
npm install -g overlord-cli
ovld version
```

Make sure the global npm bin directory is on your `PATH`.

If you are on your main workstation, open Overlord Desktop first. Desktop includes the local CLI used by launches and connectors, so a separate npm install is not part of normal desktop setup.

### The CLI Cannot Authenticate

Check status:

```bash
ovld auth status
```

Repair shared desktop credentials:

```bash
ovld auth repair
```

Log in again if repair does not restore access:

```bash
ovld auth login
```

### The Wrong Project Is Selected

Check project discovery from inside the repository:

```bash
ovld protocol discover-project
```

If no project is found, set the local working directory for the project in Overlord Desktop or pass `--project-id` when creating the ticket.

### Agent Connectors Are Stale

Run:

```bash
ovld doctor
ovld setup <agent>
ovld setup antigravity
```

Use `ovld setup all` when you want to refresh every supported connector.

**Antigravity (replaces Gemini CLI):** Google is deprecating Gemini CLI in favor of Antigravity CLI. Install with `ovld setup antigravity`, launch tickets with `ovld launch antigravity --ticket-id <ticket_id>`, and choose models inside Antigravity — Overlord does not pass model or thinking flags for that connector.

### An Agent Is Blocked

The agent should call `ovld protocol ask` with one precise question and stop. Answer the question in the ticket so the session has a durable record of the decision.

### A Delivery Is Missing Change Rationales

Ask the agent to record or redeliver with `changeRationales`. The desktop Change Viewer depends on those records to explain why specific hunks changed.

## Useful Command Reference

Human setup and launch on a desktop workstation:

```bash
ovld setup all
ovld doctor
ovld attach
ovld create "Write a regression test for invite emails" --agent codex
ovld prompt "Fix the invite email regression" --agent codex
ovld tickets list --status next-up
ovld ticket context <ticket_id>
ovld launch codex
ovld restart codex
```

Standalone CLI setup on another machine:

```bash
npm install -g overlord-cli
ovld auth login
ovld setup <agent>
ovld doctor
```

Agent lifecycle:

```bash
ovld protocol auth-status
ovld protocol discover-project
ovld protocol attach --ticket-id <ticket_id>
ovld protocol update --session-key <session-key> --ticket-id <ticket_id> --phase execute --summary "Working on it."
ovld protocol ask --session-key <session-key> --ticket-id <ticket_id> --question "Blocking question?"
ovld protocol deliver --session-key <session-key> --ticket-id <ticket_id> --summary "Done."
```

Agent context and attachments:

```bash
ovld protocol read-context --session-key <session-key> --ticket-id <ticket_id>
ovld protocol write-context --session-key <session-key> --ticket-id <ticket_id> --key "key" --value '"value"'
ovld protocol attachment-list --session-key <session-key> --ticket-id <ticket_id>
ovld protocol attachment-upload-file --session-key <session-key> --ticket-id <ticket_id> --objective-id <objective-id> --file ./spec.pdf
```

## Summary

Overlord turns agent work into an operational workflow:

- Create a ticket with a clear objective.
- Assign it to a project.
- Launch it through the desktop app, or use the standalone CLI on another machine when Desktop is not available.
- Let the agent attach, update, ask, and deliver through `ovld protocol`.
- Review the delivery, artifacts, local changes, and change rationales in Overlord.

The result is a durable record of what was requested, what the agent did, why files changed, and what remains for humans to review.
