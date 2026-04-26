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

## Mode 2: Asked From Chat To Use Overlord

1. If the user wants to create tickets (and does not ask to start execution), use `/create` or run `ovld protocol create --agent cursor --objective "..."`.
2. Default to `create` for new tickets. Only use `/spawn` or `ovld protocol spawn --agent cursor --objective "..."` when the user explicitly asks to create and execute immediately.
3. If the user already has a ticket ID and only wants to inspect it, use `/load` or run `ovld protocol load-context --ticket-id <ticket-id>`.
4. If the user wants to route the current session onto an existing ticket by ID, use `/connect` or run `ovld protocol connect --ticket-id <ticket-id>`.
5. If the user wants to search for tickets by keyword or status, use the `search_tickets` MCP tool.
6. If you need other lifecycle commands or flags, run `ovld protocol help` and use the real subcommand list instead of guessing.
7. Once you attach to a ticket, switch back to Mode 1 and follow the full ticket lifecycle.

## Rules

- Always attach first and always deliver last once you are on a ticket.
- Use `ovld protocol` commands, the plugin commands, and the MCP tool instead of ad hoc scripts.
- Do not invent protocol subcommands. Use `ovld protocol help` when unsure.
- Include at least one progress update before delivering.

<!-- version: 0.1.0 -->
