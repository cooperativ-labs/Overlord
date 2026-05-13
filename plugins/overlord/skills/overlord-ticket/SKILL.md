---
name: overlord-ticket
description: Durable local workflow for working Overlord tickets from Codex, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill when Codex needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

1. Attach first with `ovld protocol attach --ticket-id <ticket_id>`.
2. Store the returned `SESSION_KEY` or `session.sessionKey`.
3. Treat the Overlord ticket prompt as authoritative for the specific objective and ticket-level constraints.
4. While working, publish meaningful progress with `ovld protocol update --session-key <sessionKey> --ticket-id <ticket_id> --phase execute --summary "..."`.
5. Follow-up messages after the initial ticket are captured automatically by the installed `UserPromptSubmit` hook. Do not post `user_follow_up` manually unless the hook is unavailable.
6. If blocked on a human-only action, ask a precise blocking question with `ovld protocol ask` and stop.
7. Deliver last with `ovld protocol deliver`, including meaningful `changeRationales` for every behavioral git-tracked change.

### Mode 1 Reference

Attach:

```bash
ovld protocol attach --ticket-id $TICKET_ID
```

Update:

```bash
ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
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

`ovld protocol deliver` automatically creates a local checkpoint before the API request when the workspace is JJ- or Git-managed; use `--skip-checkpoint` only when intentionally bypassing local provenance. Use `--payload-json` when the full delivery object fits comfortably inline. For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery.

## Mode 2: Asked From Chat To Use Overlord

1. If the user wants to create tickets (and does not ask to start execution), run `ovld protocol create --agent codex --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
2. Default to `create` for new tickets. Only use `ovld protocol prompt --agent codex --objective "..."` when the user explicitly asks to create and execute immediately.
   `prompt` creates the ticket in `execute` status and attaches immediately.
3. If the user wants to inspect an existing ticket without starting work, use `ovld protocol load-context --ticket-id <ticket_id>`.
4. If the user wants to work an existing ticket, attach with `ovld protocol attach --ticket-id <ticket_id>` and then switch to Mode 1. Use `ovld protocol connect --ticket-id <ticket_id>` instead when you only need a session key without the full ticket payload.
5. If the user wants to find existing tickets by keyword, status, project, creator, or update window, run `ovld protocol search-tickets --query "..." --status next-up,execute --limit 10`. The MCP `search_tickets` tool exposes the same filters.
6. If you need to understand project routing before prompting, use `ovld protocol discover-project`.
7. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.

## Project Discovery And Ticket Creation

When creating tickets from within a repository:

- Prefer `create` by default for draft ticket creation.
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override.

```bash
ovld protocol create --agent codex --objective "Capture follow-up work from this repository"
```

```bash
ovld protocol prompt --agent codex --objective "Implement feature X" --priority medium
```

### Choosing `--execution-target`

Pass `--execution-target agent` or `--execution-target human` (default: `human`) when creating tickets.

- **`agent`** — any task an AI agent can complete in a computer environment: coding, internet research, document editing, data analysis, automated testing, etc.
- **`human`** — any task requiring human presence or judgment: setting credentials or tokens in a third-party UI (e.g. Vercel, AWS), sending physical mail, making a product or business decision, physical-world actions.

When in doubt, ask yourself: _can this be done entirely inside a terminal or browser by an AI without human intervention?_ If yes → `agent`. If it requires a human to log in, decide, or act in the real world → `human`.

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

Record only meaningful behavioral changes. Skip formatting-only noise. Prefer 1-5 concise rationales per ticket, each tied to a specific file and diff hunk.

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

- API requires `agentIdentifier` and `connectionMethod` on attach/connect/prompt. The CLI defaults them to `codex`/`cli`; the hosted MCP defaults to `mcp`. Override with `--agent` / `--method` when calling from a different runtime.
- Hosted MCP and the local `overlord-mcp.mjs` shim use the same **tool names** (\`attach\`, \`update\`, \`deliver\`, …). The shim uses **snake_case** JSON keys (\`ticket_id\`, \`session_key\`) that map to CLI flags; hosted MCP uses **camelCase** (\`ticketId\`, \`sessionKey\`) matching REST bodies.
- `permission-request` is invoked by the local Codex plugin's permission rules; agents do not normally call it directly.
- `record_change_rationales` (MCP) and `ovld protocol record-change-rationales` (CLI) both write to the `file_changes` table; the dedicated route is `POST /api/protocol/record-change-rationales`.
- Objective attachment MCP tools use `<verb>_<noun>` names — `list_attachments`, `prepare_attachment_upload`, `finalize_attachment_upload`, `get_attachment_download_url`, `upload_attachment_file`. CLI commands use `attachment-*` and require `--objective-id` for upload/finalize.
- "Artifacts" in `deliver` are the structured records an agent submits at delivery time (next_steps, test_results, migration, decision, note, url) — not user-uploaded files.

## Rules

- The authoritative lifecycle is the `ovld protocol` CLI once you are on a ticket.
- Always attach first and always deliver last once you are working a ticket.
- Prefer the installed `ovld protocol` CLI and the plugin's MCP tools instead of ad hoc repo scripts.
- Do not create or rely on a local Codex `AGENTS.md` bundle for Overlord.
- When the ticket was launched by Overlord, the ticket prompt remains authoritative for the specific task objective and ticket-level constraints.
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` yourself before asking the user to log in again or proceed without Overlord updates.
- If you must run `ovld auth login`, always include `--organization-id <id>` — use the organization ID from the ticket prompt context to select the organization non-interactively and avoid a blocking TTY prompt.

<!-- version: 0.4.9 -->
