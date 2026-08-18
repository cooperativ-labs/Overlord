---
description: Load Overlord mission context without creating a new session
argument-hint: <mission_id>
disable-model-invocation: true
---

Load Overlord mission context without attaching to the mission.


Treat `$ARGUMENTS` as the target mission ID.
If no mission ID was provided, ask the user for one and stop.


Run:
`ovld protocol load-context --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol load-context --objective-id <objectiveId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
- Use `load-context`, not `attach`.
- Do not create or switch sessions.
- Summarize the returned mission details, history, artifacts, and shared context for the user.


