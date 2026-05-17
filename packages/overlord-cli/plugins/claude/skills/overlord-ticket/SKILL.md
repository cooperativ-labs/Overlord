---
name: overlord-ticket
description: Overlord local workflow protocol for Claude Code, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill whenever Claude Code needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

Use this mode when the prompt already contains a ticket ID or explicitly says the session was launched by Overlord.

1. Attach first with `ovld protocol attach --ticket-id <ticket_id>`.
2. Keep the returned `session.sessionKey` for all follow-up calls.
3. Treat the Overlord ticket prompt as authoritative for the objective, constraints, and delivery target.
4. Post updates while working with `ovld protocol update --phase execute`.
5. Follow-up messages after the initial ticket are captured automatically by the installed `UserPromptSubmit` hook. Do not post `user_follow_up` manually unless the hook is unavailable.
6. If blocked, call `ovld protocol ask` and stop.
7. Deliver last with `ovld protocol deliver`, including `changeRationales` for each meaningful behavioral file change.

### Mode 1 Reference

Attach:

```bash
ovld protocol attach --ticket-id $TICKET_ID
```

In a git workspace, `attach` automatically creates a local git checkpoint for each executing objective before work begins, stored under `refs/overlord/checkpoints/<objectiveId>`. Pass `--skip-checkpoint` only when intentionally bypassing local provenance.

Update:

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
```

When the summary contains backticks, quotes, or other special shell characters, pipe it via stdin to prevent shell interpretation:

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary-file - --phase execute <<'EOF'
What you did and why — including `backticks`, "quotes", and $variables are all safe here.
EOF
```

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
- `user_follow_up` for human follow-up messages after the initial ticket when the automatic hook is unavailable
- `alert` for warnings or non-blocking issues

Ask when blocked:

```bash
ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
```

Deliver:

```bash
ovld protocol deliver --session-key <sessionKey> \
  --ticket-id $TICKET_ID \
  --summary "Narrative: what you did, next steps." \
  --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \
  --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
```

Use `--payload-json` when the full delivery object fits comfortably inline. For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed. If the summary contains special characters, use `--summary-file -` and pipe via a single-quoted heredoc (`<<'EOF'`) to prevent shell expansion. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery.

Revert an objective:

```bash
ovld protocol revert --objective-id <objective-id>
```

`revert` restores the local working tree to the recorded objective checkpoint and saves a safety ref under `refs/overlord/safety/` first.

## Mode 2: Asked From Chat To Use Overlord

Use this mode when the conversation starts normally and the user asks Claude to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create tickets (and does not ask to start execution), run `ovld protocol create --agent claude-code --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
2. Default to `create` for new draft tickets. Only use `/overlord:prompt` or `ovld protocol prompt --agent claude-code --objective "..."` when the user explicitly asks to create and execute immediately. If the work is already complete in chat and just needs to be recorded, use `ovld protocol record-work` instead.`prompt` creates the ticket in `execute` status and attaches immediately.
3. If the user already has a ticket ID and only wants to inspect it, use `/overlord:load` or run `ovld protocol load-context --ticket-id <ticket_id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/overlord:connect` or run `ovld protocol connect --ticket-id <ticket_id>`.
5. If the user wants to establish a persistent session with a ticket by ID, use `/overlord:attach` or run `ovld protocol attach --ticket-id <ticket_id>`.
6. If the user wants to find a ticket but does not know the ID, use `ovld attach` for interactive ticket search and agent launch, or run `ovld protocol search-tickets --query "..." --status next-up,execute` and ask the user to confirm.
7. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
8. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

## Recording Completed Work From Chat

Use this when the user has had a working conversation with the agent (no Overlord ticket attached) and now wants to record the outcome as a ticket — both for review and to publish a feed post about it. This is **distinct from `create` and from `deliver`**:

- `create` makes a draft ticket for *future* work; nothing happens yet.
- `prompt` creates a ticket and starts an execution session.
- `deliver` concludes an *attached* session; the ticket already exists.
- `record-work` creates the ticket *and* completes the objective *and* triggers the feed-post generator in a single call, with no session left open.

Do NOT use `record-work` for in-progress work. Use it only when the work is already done in the chat.

```bash
ovld protocol record-work \
  --objective "User asked me to X; I did Y by..." \
  --summary  "Narrative for the feed post and reviewer." \
  --change-rationales-file -
```

Or stream the full payload via stdin to avoid quote escaping:

```bash
ovld protocol record-work --payload-file - <<'EOF'
{
  "objective": "...",
  "summary": "...",
  "artifacts": [{"type": "next_steps", "label": "...", "content": "..."}],
  "changeRationales": [{"label": "...", "file_path": "...", "summary": "...", "why": "...", "impact": "...", "hunks": [{"header": "@@ ..."}]}]
}
EOF
```

Project resolution mirrors `prompt`/`create`: cwd is matched against the caller's `project_user.local_working_directory`. If no match:

1. **Ask the user for a `--project-id`** if the work is project-related. Show them a brief description of what you're about to record so they can pick the right project.
2. If the user confirms the work is not tied to any project, pass `--personal` to create a private ticket.

Validation: in a git workspace, `record-work` checks that uncommitted changes are represented by `changeRationales` and rejects if they aren't (same check as `deliver`). Pass `--skip-file-change-check` only when intentionally bypassing.

The hosted MCP tool name is `record_work` (snake_case). It accepts the same fields as the CLI but in camelCase JSON. Use `record_work` over the `create_ticket` + `attach` + `deliver` sequence whenever the work is already done.

## Change Rationales

Always include `changeRationales` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in `changeRationales`; do not send `file_changes` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the `file_changes` table. Prefer inline JSON or the dedicated command below. Use `--payload-json` for compact full delivery payloads, or `--payload-file -` when the JSON is larger or quote-sensitive so summary, artifacts, and change rationales stay in one JSON document without creating a temporary file. Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

```bash
ovld protocol record-change-rationales --session-key <sessionKey> --ticket-id $TICKET_ID \
  --summary "Recorded rationale details for the latest code changes." --phase execute \
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
```

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID \
  --summary "Added retry logic." --phase execute \
  --change-rationales-json '[{"label":"Add backoff","file_path":"lib/api.ts","summary":"Added retry.","why":"Transient failures.","impact":"Retries 3x.","hunks":[{"header":"@@ -22,4 +22,18 @@"}]}]'
```

Record only meaningful behavioral changes. Skip formatting-only noise.

## Project Discovery And Ticket Creation

When creating tickets from within a repository:

- Prefer `create` by default for draft ticket creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override.

```bash
ovld protocol create --agent claude-code --objective "Capture follow-up work from this repository"
ovld protocol prompt --agent claude-code --objective "Implement feature X" --priority medium
```

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
```

You can override with `--project-id` or `--working-directory` if needed.

### Resolving the project ID when you don't have one

When you need a project ID for a protocol command and the ticket prompt did not supply one, resolve it in this order.

**Locally (CLI inside a shell on the user's machine):**

1. `--project-id` if explicitly provided.
2. Otherwise, let the CLI match the current working directory (the default behavior of `create`, `prompt`, `discover-project`).
3. If working-directory resolution returns nothing, read `overlord.json` from the cwd (or any ancestor you have access to) and pass its project id via `--project-id`.

**Over MCP (web agents and hosted tools, where the server cannot see the agent's cwd):**

1. `--project-id` / `projectId` if explicitly provided.
2. Read `overlord.json` from the directory the user is accessing and pass its project id as `projectId`.
3. As a last resort, try `workingDirectory` resolution.

If `overlord.json` contains more than one project, show the user the project **names** from that file and ask which one to use before calling any protocol command — never silently pick one.

### Choosing `--execution-target`

Pass `--execution-target agent` or `--execution-target human` (default: `human`) when creating tickets.

- **`agent`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **`human`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: _can this be done entirely inside a terminal or browser by an AI without human intervention?_ If yes → `agent`. If it requires a human to log in, decide, or act in the real world → `human`.

## Context And Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol attachment-list --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol attachment-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --objective-id <objective-id> --file ./spec.pdf --content-type application/pdf
ovld protocol attachment-download-url --session-key <sessionKey> --ticket-id $TICKET_ID --attachment-id <attachment-id>
```

The `attach` and `load-context` responses already include `attachments` and `objectives` arrays — use those for `<attachment-id>` and `<objective-id>` values. Run `attachment-list` mid-session if new files have been uploaded since attach.

Objective attachment uploads also expose two-step variants — `attachment-prepare-upload` and `attachment-finalize-upload` — for callers that need a signed URL directly. Prefer `attachment-upload-file` for one-shot uploads.

"Artifacts" in `deliver` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files.

## Large Artifacts

For large artifacts such as planning documents, architecture decisions, research summaries, or design documents: **save the full content as a markdown file in the linked repository, then summarize it in the artifact returned to the ticket.**

- Save to a meaningful path in the repository (e.g., `ai/feature-plans/my-feature.md` for feature plans, `docs/decisions/my-decision.md` for architecture decision records).
- Commit the file as part of the ticket's work so it appears in `changeRationales`.
- In the delivery, include a `note` or `decision` artifact with a concise summary and the repository file path — not the full document content.

This keeps the ticket feed readable while preserving the full document in version control where it can be reviewed, diffed, and referenced later.

## Defaults And Notes

- API requires `agentIdentifier` and `connectionMethod` on attach/connect/prompt. The CLI defaults them to `claude-code`/`cli`; the MCP tool defaults to `mcp`. Override with `--agent` / `--method` when calling from a different runtime.
- Hosted Overlord MCP (`/functions/v1/mcp`) uses the same canonical tool names as any local MCP shim that shells into `ovld protocol` (`attach`, `update`, `deliver`, `record_work`, …). Hosted calls use camelCase JSON keys (`ticketId`, `sessionKey`) matching `POST /api/protocol/*` bodies; the local shim uses snake_case keys mapped to CLI flags (`ticket_id`, `session_key`).
- `permission-request` is invoked by the Claude Code permission hook installed by the bundle. Agents do not normally call it directly.
- `record_change_rationales` (MCP) and `ovld protocol record-change-rationales` (CLI) both write to the same `file_changes` table. The dedicated CLI route is `POST /api/protocol/record-change-rationales`.

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands and the plugin's slash commands instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- When a summary or question contains backticks, `$vars`, or other shell-special characters, always use `--summary-file -` (or `--question-file -`) with a single-quoted heredoc (`<<'EOF'`). Never retry by stripping or escaping content — pipe stdin instead.
- Use `write-context` for facts a future agent session should know.
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` yourself before asking the user to log in again or proceed without Overlord updates.
- If you must run `ovld auth login`, always include `--organization-id <id>` — use the organization ID from the ticket prompt context to select the organization non-interactively and avoid a blocking TTY prompt.
- Do not add or commit changes unless the user explicitly asks you to commit.
- Delivery is the concluding step. After delivering, stop unless the user follows up or the ticket is reopened.

<!-- version: 0.4.11 -->
