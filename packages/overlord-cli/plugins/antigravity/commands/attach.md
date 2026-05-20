---
description: Attach this session to an Overlord ticket and begin execution
argument-hint: <ticket_id>
---

Attach to an Overlord ticket and begin executing it.

Treat `$ARGUMENTS` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.

Run:
`ovld protocol attach --ticket-id <ticketId>`

Rules:
- Only attach when the user clearly asks to execute the work — not just because a ticket was mentioned.
- Keep the returned `sessionKey` for all follow-up `update`, `ask`, and `deliver` calls.
- After attaching, follow the full Overlord ticket lifecycle: update while working, deliver when done.
