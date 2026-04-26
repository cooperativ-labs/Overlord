---
name: overlord-ticket
description: Overlord local workflow protocol for Cursor, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill whenever Cursor needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

1. Attach first with `ovld protocol attach --ticket-id <ticket-id>`.
2. Keep the returned `session.sessionKey` for all follow-up calls.
3. Treat the Overlord ticket prompt as authoritative for the objective, constraints, and delivery target.
4. Post updates while working with `ovld protocol update --phase execute`.
5. If the user sends a follow-up message after the initial ticket, publish it immediately with `--event-type user_follow_up`.
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

Supported `--phase` values:
- `draft`
- `execute`
- `review`
- `deliver`
- `complete`
- `blocked`
- `cancelled`

Event types:
- `update` for standard progress updates
- `user_follow_up` for human follow-up messages after the initial ticket
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

For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed.

## Mode 2: Asked From Chat To Use Overlord

1. If the user wants to create tickets (and does not ask to start execution), use `/create` or run `ovld protocol create --agent cursor --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
2. Default to `create` for new tickets. Only use `/spawn` or `ovld protocol spawn --agent cursor --objective "..."` when the user explicitly asks to create and execute immediately.
3. If the user already has a ticket ID and only wants to inspect it, use `/load` or run `ovld protocol load-context --ticket-id <ticket-id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/connect` or run `ovld protocol connect --ticket-id <ticket-id>`.
5. If the user wants to find a ticket by keyword/status/project/creator/date, run `ovld protocol search-tickets --query "..." --status next-up,execute`.
6. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
7. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

## Change Rationales

Always include `changeRationales` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in `changeRationales`; do not send `file_changes` as an artifact.

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
- Use `spawn` only when the user explicitly asks to start execution immediately.
- Both commands resolve the project from the current working directory; use `--working-directory` to override or `--project-id` to be explicit.

```bash
ovld protocol create --agent cursor --objective "Capture follow-up work from this repository"
ovld protocol spawn --agent cursor --objective "Implement feature X" --priority medium
ovld protocol discover-project
```

## Context And Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
ovld protocol artifact-download-url --session-key <sessionKey> --ticket-id $TICKET_ID --artifact-id <artifact-id>
```

The CLI also exposes the two-step variants `artifact-prepare-upload` and `artifact-finalize-upload` for callers that need a signed URL directly. Prefer `artifact-upload-file` for one-shot uploads.

## Defaults And Notes

- The Overlord API requires `agentIdentifier` and `connectionMethod` on attach/connect/spawn, but the CLI defaults them to `cursor`/`cli` (override with `--agent` / `--method`). The MCP tools default to `mcp`.
- `permission-request` is invoked by the installed permission hook; agents normally do not call it directly.
- The `record_change_rationales` MCP tool and `ovld protocol record-change-rationales` CLI both write to the same `file_changes` table; pick whichever fits your runtime.

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands, the plugin commands, and the MCP tool instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- Include at least one progress update before delivering.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- Delivery is the concluding step. After delivering, stop unless the user follows up or the ticket is reopened.

<!-- version: 0.1.0 -->
