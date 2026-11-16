# ADR 0066: Background inspection and absent terminal mappings

- Date: 2026-11-16
- Status: accepted
- Supersedes: none
- Amends: 0064

## Context

Session inspections use the runner capability queue. Counting them as launches
and treating missing Latch metadata as runner failure obscures actual activity.

## Decision

Keep the queue wire shape and statuses. Distinguish capability operations in the
Delegator presentation. Preserve the typed LATCH_SESSION_ABSENT result while
forgetting matching provider mappings scoped to the inspecting project and target,
even for mission-less probes. The backend observer also forgets absent mappings.
Absence does not imply confirmed process termination and does not fabricate exit
history, stop a process, or mark the runner unhealthy. Other failures remain visible.

## Impact

The web app changes presentation, the runner handles expected inspection absence,
and the service/observer remove stale mappings through existing persistence helpers.
Mobile and connectors retain compatible interfaces. No schema migration is needed.
