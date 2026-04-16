---
name: overlord-ticket-workflow
description: Overlord local workflow protocol — attach, update, deliver lifecycle for ticket-driven work from Claude Code.
---

# Overlord Local Workflow

If you receive a prompt with a specified ticket ID, adhere to the following. If the prompt does not have a ticket ID, the user may choose to add one later, but otherwise, proceed without it.

## Lifecycle

1. **Attach first** — If there is a TICKET_ID, always call attach before doing any work:
   ```bash
   ovld protocol attach --ticket-id $TICKET_ID
   ```
   Store `session.sessionKey` from the response — it is required for all subsequent calls.

2. **Update during work** — Post at least one progress update before delivering:
   ```bash
   ovld protocol update --session-key <sessionKey> --ticket-id $TICKET_ID --summary "What you did and why." --phase execute
   ```
   Phases: `draft`, `execute`, `review`, `deliver`, `complete`, `blocked`, `cancelled`.
   Use `execute` while working.

   Pass `--event-type <type>` to publish a specific activity event (default: `update`):
   - `update` — standard progress update (default)
   - `user_follow_up` — a message or question from the human user (EXCLUDING THE INITIAL TICKET)
   - `alert` — surface a warning or non-blocking alert

3. **Ask when blocked** — Stop working after calling:
   ```bash
   ovld protocol ask --session-key <sessionKey> --ticket-id $TICKET_ID --question "Specific question for the PM."
   ```

4. **Deliver last** — Always deliver when done:
   ```bash
   ovld protocol deliver --session-key <sessionKey> \
     --ticket-id $TICKET_ID \
     --summary "Narrative: what you did, next steps." \
     --artifacts-json '[{"type":"next_steps","label":"Next steps","content":"..."}]' \
     --change-rationales-json '[{"label":"Short reviewer title","file_path":"path/to/file.ts","summary":"What changed.","why":"Why it changed.","impact":"Behavioral impact.","hunks":[{"header":"@@ -10,6 +10,14 @@"}]}]'
   ```
   For larger delivery JSON, prefer `--payload-file -` and stream the full payload on stdin so no scratch file needs to be created or removed. If you use `--payload-file`, `--artifacts-file`, or `--change-rationales-file` with a real path, treat that file as ephemeral scratch data outside the repository and remove it after delivery. Do not leave delivery JSON checked into the worktree.

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

Record only meaningful behavioral changes — skip formatting-only noise. Prefer 1–5 concise rationales per ticket, each tied to a specific file and diff hunk.

## Project Discovery & Ticket Spawning

When creating tickets from within a repository, `spawn` automatically resolves the
correct project by matching your current working directory against each project's
configured "Local working directory". No `--project-id` flag is needed:

```bash
ovld protocol spawn --objective "Implement feature X" --priority medium
```

To discover which project maps to the current directory:

```bash
ovld protocol discover-project
```

You can override with `--project-id` or `--working-directory` if needed.

## Context & Artifacts

```bash
ovld protocol read-context --session-key <sessionKey> --ticket-id $TICKET_ID
ovld protocol write-context --session-key <sessionKey> --ticket-id $TICKET_ID --key "key" --value '"json-value"'
ovld protocol artifact-upload-file --session-key <sessionKey> --ticket-id $TICKET_ID --file ./spec.pdf --content-type application/pdf
ovld protocol artifact-download-url --session-key <sessionKey> --ticket-id $TICKET_ID --artifact-id <artifact-id>
```

## Rules

- Always attach first; always deliver when done.
- Always communicate with Overlord using the ovld protocol cli commands.
- Post any substantial updates about your decisions or progress.
- If blocked on human-only work, call `ask` and request a follow-up human ticket.
- The `summary` in deliver is what the PM reads first — write it as a narrative, not a command list.
- Use `write-context` for facts a future agent session should know.
- **If the user sends you a message during your session, immediately publish a `user_follow_up` activity event with the user's message recorded verbatim in the summary before doing anything else. This DOES NOT apply to the initial ticket.**
- **Do not add or commit changes (git commit) unless the user explicitly asks you to commit.**
- **Delivery is the concluding step.** After delivering, stop working. Do not continue unless the user follows up or the ticket is reopened.
