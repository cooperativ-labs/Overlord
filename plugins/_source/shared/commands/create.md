{{#if isClaude}}---
description: Create a draft Overlord ticket from the current conversation
argument-hint: <objective or raw flags>
disable-model-invocation: true
---

{{/if}}{{#if isClaude}}Create a draft Overlord ticket from the user's request.
{{/if}}{{#if isCursor}}Create a draft Overlord ticket.
{{/if}}

{{#if isClaude}}Use `$ARGUMENTS` as the input.
If it already contains flags such as `--title`, `--priority`, `--project-id`, or `--for-human`, pass those flags through after `ovld protocol create --agent {{agent.protocolAgent}}`.
Otherwise, treat `$ARGUMENTS` as the objective text and run:
{{/if}}{{#if isCursor}}Use the text after `/create` as the objective unless raw flags are present.

Run:
{{/if}}`ovld protocol create --agent {{agent.protocolAgent}} --objective "<objective>"`

{{#if isClaude}}If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new `TICKET_ID`.
{{/if}}{{#if isCursor}}If raw flags are present, pass them through after:
`ovld protocol create --agent {{agent.protocolAgent}}`
{{/if}}
