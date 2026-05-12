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

`ovld protocol deliver` automatically creates a local checkpoint before the API request when the workspace is JJ- or Git-managed; use `--skip-checkpoint` only when intentionally bypassing local provenance. For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed. If the summary contains special characters, use `--summary-file -` and pipe via a single-quoted heredoc (`<<'EOF'`) to prevent shell expansion. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery.

## Mode 2: Asked From Chat To Use Overlord

Use this mode when the conversation starts normally and the user asks Claude to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create tickets (and does not ask to start execution), run `ovld protocol create --agent claude-code --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
2. Default to `create` for new tickets. Only use `/overlord:prompt` or `ovld protocol prompt --agent claude-code --objective "..."` when the user explicitly asks to create and execute immediately.
   `prompt` creates the ticket in `execute` status and attaches immediately.
3. If the user already has a ticket ID and only wants to inspect it, use `/overlord:load` or run `ovld protocol load-context --ticket-id <ticket_id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/overlord:connect` or run `ovld protocol connect --ticket-id <ticket_id>`.
5. If the user wants to establish a persistent session with a ticket by ID, use `/overlord:attach` or run `ovld protocol attach --ticket-id <ticket_id>`.
6. If the user wants to find a ticket but does not know the ID, use `ovld attach` for interactive ticket search and agent launch, or run `ovld protocol search-tickets --query "..." --status next-up,execute` and ask the user to confirm.
7. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
8. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

## Change Rationales

Always include `changeRationales` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in `changeRationales`; do not send `file_changes` as an artifact.

These are structured protocol payloads that Overlord stores as first-class rows in the `file_changes` table. Prefer inline JSON or the dedicated command below. For larger full delivery payloads, prefer `--payload-file -` so summary, artifacts, and change rationales stay in one JSON document without creating a temporary file. Ordinary deliver artifacts should use `next_steps`, `test_results`, `migration`, `note`, `url`, or `decision`.

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
```

```bash
ovld protocol prompt --agent claude-code --objective "Implement feature X" --priority medium
```

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
```

You can override with `--project-id` or `--working-directory` if needed.

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

## Defaults And Notes

- API requires `agentIdentifier` and `connectionMethod` on attach/connect/prompt. The CLI defaults them to `claude-code`/`cli`; the MCP tool defaults to `mcp`. Override with `--agent` / `--method` when calling from a different runtime.
- Hosted Overlord MCP (`/functions/v1/mcp`) uses the same canonical tool names as any local MCP shim that shells into `ovld protocol` (`attach`, `update`, `deliver`, …). Hosted calls use camelCase JSON keys (`ticketId`, `sessionKey`) matching `POST /api/protocol/*` bodies; the local shim uses snake_case keys mapped to CLI flags (`ticket_id`, `session_key`).
- `permission-request` is invoked by the Claude Code permission hook installed by the bundle. Agents do not normally call it directly.
- `record_change_rationales` (MCP) and `ovld protocol record-change-rationales` (CLI) both write to the same `file_changes` table. The dedicated CLI route is `POST /api/protocol/record-change-rationales`.
- Objective attachment tools follow the `<verb>_<noun>` MCP naming: `list_attachments`, `prepare_attachment_upload`, `finalize_attachment_upload`, `get_attachment_download_url`, `upload_attachment_file`. CLI commands use `attachment-*` and require `--objective-id` for upload/finalize.
- "Artifacts" in `deliver` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files. Files attached by users live on objectives via the attachment tools above.

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

<!-- version: 0.4.8 -->
