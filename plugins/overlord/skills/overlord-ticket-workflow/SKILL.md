---
name: overlord-ticket-workflow
description: Durable local workflow for working Overlord tickets from Codex through the installed plugin.
---

# Overlord Ticket Workflow

Use this skill when the user wants to work on an Overlord ticket from Codex through the local
Overlord plugin.

## Workflow

1. Attach first with `ovld protocol attach --ticket-id <ticket-id>`.
2. Store the returned `SESSION_KEY` or `session.sessionKey`.
3. While working, publish meaningful progress with:
   `ovld protocol update --session-key <sessionKey> --ticket-id <ticket-id> --phase execute --summary "..."`
4. If a later user message arrives during the ticket session, publish it immediately with
   `--event-type user_follow_up` before doing anything else.
5. If blocked on a human-only action, ask a precise blocking question with `ovld protocol ask`
   and stop.
6. Deliver last with `ovld protocol deliver`, including meaningful `changeRationales` for every
   behavioral git-tracked change.
   If you need `--payload-file`, `--artifacts-file`, or `--change-rationales-file`, treat that JSON as ephemeral scratch data, not as a repository file. Remove it after delivery and never commit it.

## Rules

- The authoritative lifecycle is the `ovld protocol` CLI.
- Always attach first and always deliver last.
- Do not create or rely on a local Codex `AGENTS.md` bundle for Overlord.
- Prefer the installed `ovld` CLI and the plugin's MCP tools instead of ad hoc repo scripts.
- When the ticket was launched by Overlord, the ticket prompt remains authoritative for the
  specific task objective and any ticket-level constraints.
