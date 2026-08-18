Load Overlord mission context without attaching.

Use the text after `/load` as the mission ID.

Run:
`ovld protocol load-context --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol load-context --objective-id <objectiveId>`

When you open or discuss an existing mission that has a draft objective, submit it with:
`ovld protocol discuss-objective --mission-id <missionId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
