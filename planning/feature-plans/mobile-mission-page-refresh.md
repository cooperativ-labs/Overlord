# Mobile mission page refresh churn (coo:1147)

## Symptom
On iOS, the Missions screen's project filter popover reorders roughly every 500 ms.

## Cause
1. **Reload trigger.** Every runner heartbeat (`registerExecutionTargetRunner` in
   `packages/core/service/execution-target-runners.ts`) calls `recordChange` for
   `execution_target_runner_registration`, whether or not anything changed. Several runners each
   beating every few seconds produce a steady stream of these notices. The committed iOS
   `MissionReloadMapping` has no case for that kind. Unknown kinds fall back to a full reload, so
   every mounted screen reloads, using the batch's freshness floor, which bypasses the cache.
2. **Reorder.** `WorkspaceData.allProjects` (and the statuses/members fan-outs) collected their
   per-workspace results from a `TaskGroup` in completion order. Each reload therefore produced a
   different project order, and the filter popover rendered `projects` exactly as fetched.

## Fixes
- OverlordMobile (this objective): `orderedFanOut` returns fan-out results in input order;
  the filter popover sorts by the board's `orderedProjectIds` (workspace order, then `position`).
  Covered by `WorkspaceFanOutOrderTests`.
- OverlordMobile (separate in-flight work, still uncommitted): route
  `execution_target_runner_registration` to `.launchSettings` only and `agent_session_event` to its
  mission, so neither reloads Home or mission lists. See `docs/mobile-data-loading.md`.

## Recommended next step (server)
Have heartbeats record a change only when a client-visible field changes (health, relation,
target, label, version, capabilities, or a reconnect), not on every `last_heartbeat_at` bump.
Liveness can then be derived from `last_heartbeat_at` and the TTL at read time. This removes the
notice storm for every client, including older app builds and the webapp, instead of each client
filtering it out. Doing this changes when the realtime change feed is notified, so update
CONTRACT.md as well.
