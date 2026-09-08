Create a draft Overlord mission.

Use the text after `/create` as the objective unless raw flags are present.

If it already contains flags such as `--title`, `--priority`, `--project-id`, `--assigned-to`, or `--for-human`, pass those flags through after:
`ovld protocol create --agent cursor`

Otherwise, treat the input as the objective text and run:
`ovld protocol create --agent cursor --objectives-json '[{"objective":"<objective>"}]'`

When the user names an agent for the work, assign it on the objective itself — add `"agent":"<id>"` (and optional `"model"`) to the objectives item, or pass `--objective-agent <id>` / `--objective-model <id>`. Never create the mission and then append a second objective just to name an agent.

If no objective was provided, ask the user for one and stop.

After the command succeeds, report the new `MISSION_ID`.
