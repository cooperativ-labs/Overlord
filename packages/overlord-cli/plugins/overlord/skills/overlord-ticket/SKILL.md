---
name: overlord-ticket
description: Overlord local workflow protocol for Codex, covering both Overlord-launched tickets and chat-invoked Overlord work.
---

# Overlord Ticket

Use this skill whenever Codex needs to work with Overlord, whether the session was launched by Overlord Desktop/CLI or the user asks from chat to engage with Overlord.

## Mode 1: Launched From Overlord Desktop Or CLI

Use this mode when the prompt already contains a ticket ID or explicitly says the session was launched by Overlord.

1. Attach first with `ovld protocol attach --ticket-id <ticket_id>`.
2. Keep the returned `session.sessionKey` for all follow-up calls.
3. Treat the Overlord ticket prompt as authoritative for the objective, constraints, and delivery target.
4. Post updates while working with `ovld protocol update --phase execute`.
5. Follow-up messages after the initial ticket are captured automatically by the installed `UserPromptSubmit` hook. Do not post `user_follow_up` manually unless the hook is unavailable.
6. If blocked, call `ovld protocol ask` and stop.
7. Deliver last with `ovld protocol deliver`, including `changeRationales` for each meaningful behavioral file change.

For full command syntax, flags, phase values, and event types see [reference/cli.md](reference/cli.md).

## Objective Submission vs Execution

Discussing or otherwise opening a ticket from within a chat should cause the draft objective to be marked **submitted** — this signals the ticket is in active discussion with an agent, but not yet being executed. Only an explicit order to execute (e.g. "execute this", "do this", "start working on it") should cause you to **attach** to the ticket and trigger execution.

- **Discussing / opening a ticket** → `ovld protocol discuss-objective --ticket-id $TICKET_ID` (draft → submitted, no session).
- **Creating a ticket** via `ovld protocol create` keeps the objective in `draft` state.
- **Explicitly ordered to execute** → `ovld protocol attach --ticket-id $TICKET_ID` (draft/submitted → executing, session begins).

Do not attach to a ticket just because it was mentioned or opened in conversation. Only attach when the user clearly asks you to execute the work.

## Mode 2: Asked From Chat To Use Overlord

Use this mode when the conversation starts normally and the user asks Codex to create, inspect, connect to, or otherwise use Overlord.

1. If the user wants to create tickets (and does not ask to start execution), run `ovld protocol create --agent codex --objectives-json '[{"objective":"..."}]'`.
   - When `--session-key` and `--ticket-id` are provided, it creates a follow-up draft.
   - When session flags are omitted, it resolves the project by matching current working directory (or `--working-directory`) to Overlord `local_working_directory`, then creates a standalone draft.
   - Pass multiple items in `--objectives-json` when creating ordered steps for the same feature or goal.
2. Default to `create` for new tickets. Only use `ovld protocol prompt --agent codex --objectives-json '[{"objective":"..."}]'` when the user explicitly asks to create and execute immediately.
   `prompt` creates the ticket in `execute` status and attaches immediately.
3. If the user already has a ticket ID and only wants to inspect it, run `ovld protocol load-context --ticket-id <ticket_id>`.
   When you open or discuss an existing ticket that has a draft objective, submit it with `ovld protocol discuss-objective --ticket-id <ticket_id>`.
4. If the user wants to route the current session onto an existing ticket by ID, run `ovld protocol connect --ticket-id <ticket_id>`.
5. If the user wants to establish a persistent session with a ticket by ID, run `ovld protocol attach --ticket-id <ticket_id>`.
6. If the user wants to find a ticket but does not know the ID, run `ovld protocol search-tickets --query "..." --status next-up,execute` and ask the user to confirm. 
7. If you need to understand project routing before prompting, use `ovld protocol discover-project`.
8. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
9. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

For ticket creation examples, project discovery, and `--objectives-json` format see [reference/cli.md](reference/cli.md).

## Change Rationales

Always include `changeRationales` when delivering. Optionally include them on updates during long-running work.

Before delivering, make sure every meaningful git-tracked file change is represented in `changeRationales`; do not send `file_changes` as an artifact. Record only meaningful behavioral changes. Skip formatting-only noise.

Each rationale entry requires these fields: `file_path`, `label`, `summary`, `why`, `impact` — all strings. Do **not** use `filePath` or `rationale`; those are a different internal shape and will cause a validation error.

For more than a handful of entries, use `--change-rationales-file` with a temp file or stdin (`-`) instead of inline `--change-rationales-json` to avoid shell quoting failures with large arrays.

For the `record-change-rationales` command and full payload shape with optional `hunks` see [reference/cli.md](reference/cli.md).

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands and the plugin's MCP tools instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- Include at least one progress update before delivering.
- The `summary` in deliver is what the PM reads first, so write it as a narrative, not a command list.
- When a summary or question contains backticks, `$vars`, or other shell-special characters, always use `--summary-file -` (or `--question-file -`) with a single-quoted heredoc (`<<'EOF'`). Never retry by stripping or escaping content — pipe stdin instead. See [reference/shell-escaping.md](reference/shell-escaping.md).
- Use `write-context` for facts a future agent session should know.
- If a protocol or MCP call fails with auth/session errors, run `ovld auth repair` yourself before asking the user to log in again or proceed without Overlord updates.
- If you must run `ovld auth login`, always include `--organization-id <id>` — use the organization ID from the ticket prompt context to select the organization non-interactively and avoid a blocking TTY prompt.
- Do not add or commit changes unless the user explicitly asks you to commit.
- Do not create or rely on a local Codex `AGENTS.md` bundle for Overlord.
- Delivery is the concluding step. After delivering, stop unless the user follows up or the ticket is reopened.

## Reference

- [reference/cli.md](reference/cli.md) — Full protocol command syntax, flags, phases, ticket creation, and project discovery
- [reference/mcp.md](reference/mcp.md) — MCP tool naming, key casing, hosted vs local shim defaults
- [reference/devices.md](reference/devices.md) — Device fingerprints, project resources, and `--execution-target`
- [reference/context.md](reference/context.md) — Shared state, attachments, and large artifact policy
- [reference/shell-escaping.md](reference/shell-escaping.md) — Heredoc stdin piping for special characters in summaries and payloads

<!-- version: 0.5.3 -->

