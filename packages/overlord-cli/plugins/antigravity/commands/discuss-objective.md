---
description: Mark a draft objective as submitted for discussion without executing it
argument-hint: <ticket_id>
---

Mark a draft objective as submitted — signals the ticket is in active discussion, not yet executing.

Treat `$ARGUMENTS` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
`ovld protocol discuss-objective --ticket-id <ticketId>`

Rules:
- Use this when opening or discussing a ticket, not when executing it.
- Do not create a session — `discuss-objective` transitions the objective to `submitted` with no session.
- To actually execute the ticket, use `/overlord:attach` instead.
