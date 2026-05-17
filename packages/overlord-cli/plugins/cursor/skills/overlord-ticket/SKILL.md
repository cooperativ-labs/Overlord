---
name: overlord-ticket
description: Overlord local workflow protocol for Cursor, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill whenever Cursor needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

1. Attach first with `ovld protocol attach --ticket-id <ticket_id>`.
2. Keep the returned `session.sessionKey` for all follow-up calls.
3. Treat the Overlord ticket prompt as authoritative for the objective, constraints, and delivery target.
4. Post updates while working with `ovld protocol update --phase execute`.
5. Follow-up messages after the initial ticket are captured automatically by the installed Cursor `beforeSubmitPrompt` hook (see `~/.cursor/hooks.json`). Do not post `user_follow_up` manually unless the hook is unavailable.
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
- `user_follow_up` — only when the Cursor `beforeSubmitPrompt` hook is unavailable; the hook normally posts follow-ups to the activity feed
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

Use `--payload-json` when the full delivery object fits comfortably inline. For larger delivery payloads, prefer `--payload-file -` and stream the full JSON on stdin so no scratch file needs to be created or removed.

Revert an objective:

```bash
ovld protocol revert --objective-id <objective-id>
```

`revert` restores the local working tree to the recorded objective checkpoint and saves a safety ref under `refs/overlord/safety/` first.

## Mode 2: Asked From Chat To Use Overlord

1. If the user wants to create tickets (and does not ask to start execution), use `/create` or run `ovld protocol create --agent cursor --objective "..."`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
2. Default to `create` for new draft tickets. Only use `/prompt` or `ovld protocol prompt --agent cursor --objective "..."` when the user explicitly asks to create and execute immediately. If the work is already complete in chat and just needs to be recorded, use `ovld protocol record-work` instead.
3. If the user already has a ticket ID and only wants to inspect it, use `/load` or run `ovld protocol load-context --ticket-id <ticket_id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/connect` or run `ovld protocol connect --ticket-id <ticket_id>`.
5. If the user wants to establish a persistent session with a ticket by ID, use `/attach` or run `ovld protocol attach --ticket-id <ticket_id>`.
6. If the user wants to find a ticket by keyword/status/project/creator/date, run `ovld protocol search-tickets --query "..." --status next-up,execute`.
7. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
8. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

## Recording Completed Work From Chat

Use `ovld protocol record-work` when the user has done work directly in chat (no attached ticket) and wants to record it as a ticket plus publish a feed post. This is distinct from `create` (drafts future work), `prompt` (creates + executes), and `deliver` (concludes an attached session). `record-work` creates a ticket in `review` with a completed objective and triggers the feed-post generator atomically. Project resolution mirrors `prompt`: cwd is matched against `project_user.local_working_directory`; if no match, ask the user for `--project-id` or pass `--personal`. Do NOT use for in-progress work.

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
- Use `prompt` only when the user explicitly asks to start execution immediately.
- Both commands resolve the project from the current working directory; use `--working-directory` to override or `--project-id` to be explicit.

```bash
ovld protocol create --agent cursor --objective "Capture follow-up work from this repository"
ovld protocol prompt --agent cursor --objective "Implement feature X" --priority medium
```

To inspect project resolution explicitly:

```bash
ovld protocol discover-project
```

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

When in doubt, ask yourself: *can this be done entirely inside a terminal or browser by an AI without human intervention?* If yes → `agent`. If it requires a human to log in, decide, or act in the real world → `human`.

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

- The Overlord API requires `agentIdentifier` and `connectionMethod` on attach/connect/prompt, but the CLI defaults them to `cursor`/`cli` (override with `--agent` / `--method`). The MCP tools default to `mcp`.
- The Cursor plugin ships the shared local `overlord-mcp.mjs` shim. Treat its tool list as the source of truth; it includes `record_work` alongside the core lifecycle tools.
- `permission-request` is invoked by the installed permission hook; agents normally do not call it directly.
- The `record_change_rationales` MCP tool and `ovld protocol record-change-rationales` CLI both write to the same `file_changes` table; pick whichever fits your runtime.

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands, the plugin commands, and the MCP tool instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- Include at least one progress update before delivering.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` yourself before asking the user to log in again or proceed without Overlord updates.
- If you must run `ovld auth login`, always include `--organization-id <id>` — use the organization ID from the ticket prompt context to select the organization non-interactively and avoid a blocking TTY prompt.
- Do not add or commit changes unless the user explicitly asks you to commit.
- Delivery is the concluding step. After delivering, stop unless the user follows up or the ticket is reopened.

<!-- version: 0.4.11 -->
