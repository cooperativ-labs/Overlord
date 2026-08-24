# Week 29, 2026 (13–19 Jul)

Consolidated from per-objective reports created this week.

## Runner status always unavailable (coo:334, 2026-07-18)

`GET /api/runner/status` was healthy; the UI stayed on “Could not load the runner queue” because `hasRunnerQueueError` treated any prior data-less failure (including refetch resets) as a full outage, hid the real error text, and the modal overwrote the shared React Query options to `enabled: false` when closed.

Fix: treat as error only when there is no usable data and (`isLoadingError` or in-flight fetch after a prior failure); surface `runner.error` / `failureReason`; keep the shared always-on query and only tighten `refetchInterval` while the modal is open.
