Connect this session to another Overlord mission.

Use the text after `/connect` as the mission ID.

Run:
`ovld protocol connect --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol connect --objective-id <objectiveId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
