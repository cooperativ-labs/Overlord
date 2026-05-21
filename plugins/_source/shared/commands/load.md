{{#if isClaude}}---
description: Load Overlord ticket context without creating a new session
argument-hint: <ticket_id>
disable-model-invocation: true
---

{{/if}}{{#if isClaude}}Load Overlord ticket context without attaching to the ticket.
{{/if}}{{#if isCursor}}Load Overlord ticket context without attaching.
{{/if}}

{{#if isClaude}}Treat `$ARGUMENTS` as the target ticket ID.
If no ticket ID was provided, ask the user for one and stop.
{{/if}}{{#if isCursor}}Use the text after `/load` as the ticket ID.
{{/if}}

Run:
`ovld protocol load-context --ticket-id <ticketId>`

{{#if isClaude}}Rules:
- Use `load-context`, not `attach`.
- Do not create or switch sessions.
- Summarize the returned ticket details, history, artifacts, and shared context for the user.
{{/if}}
