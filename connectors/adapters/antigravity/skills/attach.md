---
description: Attach this Antigravity session to an Overlord mission
---

Attach this session to an Overlord mission for execution.

Treat the command argument as the target mission ID.
If no mission ID was provided, ask the user for one and stop.

Run:
`ovld protocol attach --mission-id <missionId>`

or, when the argument is an objective display id:

`ovld protocol attach --objective-id <objectiveId>`

Rules:
- The argument may be a mission display id (`coo:756`) or an objective display id (`coo:756.k7xm`). An objective display id already names its mission, so pass it as `--objective-id` on its own — do not split it or pass it as `--mission-id`.
- Use `attach` only when the user explicitly wants this Antigravity session to execute mission work.
- After the command succeeds, report the returned `SESSION_KEY`.
- Follow the `overlord-mission` skill workflow after attaching: update while working, ask exactly one blocking question if blocked, and deliver last.
