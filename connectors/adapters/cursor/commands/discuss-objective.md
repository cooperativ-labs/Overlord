Submit a draft objective for discussion without starting execution.

Use the text after `/discuss-objective` as the mission ID when provided.
If no mission ID was provided, ask the user for one and stop.

Run:
`ovld protocol discuss-objective --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol discuss-objective --objective-id <objectiveId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
- Use this when the user wants to open or discuss a mission, not execute it.
- Do not attach after this command unless the user explicitly asks to execute.
