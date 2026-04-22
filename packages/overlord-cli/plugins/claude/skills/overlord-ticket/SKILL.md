---
name: overlord-ticket
description: Overlord local workflow protocol for Claude Code, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill whenever Claude Code needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

Use this mode when the prompt already contains a ticket ID or explicitly says the session was launched by Overlord.

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

Use this mode when the conversation starts normally and the user asks Claude to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create tickets (and does not ask to start execution), run `ovld protocol create --agent claude-code --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to the caller's configured Overlord `project_user.local_working_directory`, then creates a standalone draft.
2. Default to `create` for new tickets. Only use `/overlord:spawn` or `ovld protocol spawn --agent claude-code --objective "..."` when the user explicitly asks to create and execute immediately.
   `spawn` creates the ticket in `execute` status and attaches immediately.
3. If the user already has a ticket ID and only wants to inspect it, use `/overlord:load` or run `ovld protocol load-context --ticket-id <ticket-id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/overlord:connect` or run `ovld protocol connect --ticket-id <ticket-id>`.
5. If the user wants to find a ticket but does not know the ID, use `ovld attach` for interactive ticket search and agent launch, or ask the user for the ticket ID if staying strictly inside chat is the better fit.
6. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
7. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

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
- Use `spawn` only when the user explicitly asks to start execution immediately.
- Both commands can resolve the project from the current working directory; use `--working-directory` to override.

```bash
ovld protocol create --agent claude-code --objective "Capture follow-up work from this repository"
```

```bash
ovld protocol spawn --agent claude-code --objective "Implement feature X" --priority medium
```

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
```

You can override with `--project-id` or `--working-directory` if needed.

## Context And Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
ovld protocol artifact-download-url --session-key <sessionKey> --ticket-id $TICKET_ID --artifact-id <artifact-id>
```

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands and the plugin's slash commands instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- Use `write-context` for facts a future agent session should know.
- Do not add or commit changes unless the user explicitly asks you to commit.
- Delivery is the concluding step. After delivering, stop unless the user follows up or the ticket is reopened.
