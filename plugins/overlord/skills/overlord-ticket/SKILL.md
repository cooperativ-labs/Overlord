---
name: overlord-ticket
description: Durable local workflow for working Overlord tickets from Codex, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill when Codex needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

1. Attach first with `ovld protocol attach --ticket-id <ticket-id>`.
2. Store the returned `SESSION_KEY` or `session.sessionKey`.
3. Treat the Overlord ticket prompt as authoritative for the specific objective and ticket-level constraints.
4. While working, publish meaningful progress with `ovld protocol update --session-key <sessionKey> --ticket-id <ticket-id> --phase execute --summary "..."`.
5. If a later user message arrives during the ticket session, publish it immediately with `--event-type user_follow_up` before doing anything else.
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

For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery.

## Mode 2: Asked From Chat To Use Overlord

1. If the user wants a new ticket, use `ovld protocol spawn --objective "..."`. It creates the ticket and attaches immediately.
2. If the user wants to inspect an existing ticket without starting work, use `ovld protocol load-context --ticket-id <ticket-id>`.
3. If the user wants to work an existing ticket, attach with `ovld protocol attach --ticket-id <ticket-id>` and then switch to Mode 1.
4. If the user wants to find existing tickets by keyword or workflow state, use the `search_tickets` tool.
5. If you need to understand project routing before spawning, use `ovld protocol discover-project`.
6. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.

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

Record only meaningful behavioral changes. Skip formatting-only noise. Prefer 1-5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Context And Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
ovld protocol artifact-download-url --session-key <sessionKey> --ticket-id $TICKET_ID --artifact-id <artifact-id>
```

## Rules

- The authoritative lifecycle is the `ovld protocol` CLI once you are on a ticket.
- Always attach first and always deliver last once you are working a ticket.
- Prefer the installed `ovld protocol` CLI and the plugin's MCP tools instead of ad hoc repo scripts.
- Do not create or rely on a local Codex `AGENTS.md` bundle for Overlord.
- When the ticket was launched by Overlord, the ticket prompt remains authoritative for the specific task objective and ticket-level constraints.
