---
description: Create a new Overlord ticket and attach to it immediately
argument-hint: <objective or raw flags>
---

Create a new Overlord ticket from the user's request and attach immediately.

Use `$ARGUMENTS` as the input.
If it already contains flags such as `--title`, `--priority`, `--project-id`, or `--for-human`, pass those flags through after `ovld protocol prompt --agent antigravity`.
Otherwise, treat `$ARGUMENTS` as the objective text and run:
`ovld protocol prompt --agent antigravity --objective "<objective>"`

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new `TICKET_ID` and `SESSION_KEY`.
