---
name: overlord-ticket-workflow
description: Durable local workflow for Overlord tickets from Cursor.
---

# Overlord Ticket Workflow

1. Attach first with `ovld protocol attach --ticket-id <ticket-id>`.
2. Keep the returned `session.sessionKey` for all follow-up calls.
3. Post updates while working with `ovld protocol update --phase execute`.
4. If the user sends a follow-up message after the initial ticket, publish it immediately with `--event-type user_follow_up`.
5. If blocked, call `ovld protocol ask` and stop.
6. Deliver last with `ovld protocol deliver`, including `changeRationales` for each meaningful behavioral file change.

Rules:
- Always attach first and deliver last.
- Use `ovld protocol` commands, not ad hoc scripts, for ticket lifecycle operations.
- Include at least one progress update before delivering.
