Append ordered objectives to an existing mission.

Use this when the prompts are sequential steps toward the same feature or goal. Create separate missions when prompts represent different features or goals.

Run:
`ovld protocol add-objectives --mission-id <mission_id> --objectives-json '[{"objective":"Step one"},{"objective":"Step two"}]'`

To assign an agent to the appended objectives, add `"agent":"<id>"` (and optional `"model"`) to each item, or pass `--objective-agent <id>` / `--objective-model <id>` as the default.

Index 0 is the first newly added objective to execute; later indexes queue after it.
