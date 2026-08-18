---
description: Connect this session to another Overlord mission by mission ID
---

Connect this session to another Overlord mission.

Treat the command argument as the target mission ID.
If no mission ID was provided, ask the user for one and stop.

Run:
`ovld protocol connect --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol connect --objective-id <objectiveId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
- Use `connect`, not `attach`.
- Do not load extra mission context unless the user explicitly asks for it.
- After the command succeeds, report the returned `SESSION_KEY` and confirm that future updates should use that mission.
