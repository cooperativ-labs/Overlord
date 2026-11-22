# ADR 0062: End a mission terminal through its execution request

- Date: 2026-11-16
- Status: accepted
- Supersedes: none
- Amended by: 0064, 0104

## Decision

`POST /api/missions/:id/terminal-sessions/end` addresses the execution request ID
returned by `terminalSessions`. The server derives the provider session, executable,
and target from that stored mapping; a caller cannot name an arbitrary Latch process.
The operation requires `mission:update` in the owning workspace, including token
scope restrictions and organization isolation.

Before contacting the runner, an unfinished current attempt in launching, executing,
or pending_delivery moves to submitted through the existing disconnect/dequeue
mechanism. Its Run Queue is paused and membership removed. Its logical agent session
ends blocked; that is not evidence of terminal exit. Completed work stays complete,
and ending an older terminal does not disconnect a newer execution request. Restart
is explicit. No closed objective state is added and no artifacts are deleted.

Reuse the existing inspectLatchSession and stopLatchSession capabilities, runner
queue and `latch inspect/stop --json`; no sibling Latch changes or client-side
gateway credentials are required. Each retry inspects again, while stop uses a
stable execution-request-derived queue idempotency key. Concurrent/repeated stops
therefore share a job. Only a confirmed `exited` observation means `state: ended`.
It stays in the mission's existing terminal list as `lastObservedState: exited`,
and another end request returns success without contacting the target.

The REST idempotency ledger uses scope `api.mission.terminal-session.end` and the
client-supplied execution request ID as key, with a normalized request hash and
one-day cleanup boundary. Only confirmed termination completes the record;
uncertain responses remain reconcilable by inspecting the same session again.

Offline targets return `unconfirmed/target_offline`; absent or lost sessions and
capability failures (including timeout) return `unconfirmed/session_unreachable`;
running/stopping stop results return `unconfirmed/stop_unconfirmed`. Missing Latch
metadata does not prove exit. A stop job may still run after the caller timed out;
retry reconciles by inspection rather than creating a second stop job. An expired
or failed stop job is retained as such; retry may confirm exit but does not blindly
resend an uncertain stop. A new execution attempt has a different request ID.

Persist observations on the existing provider mapping with revision checks and a
monotonic exited state. Append the existing mission `status_change` event and
execution_request change feed so open screens reload. No migration is required.
Full ended timestamp/reason and paged history belong to the later lifecycle objective.

## Impact

Contract impact: minor. REST clients gain one additive operation and reuse the
existing terminal DTO state. Backend, core and runner keep their current capability
interfaces. Older clients and runners continue to work. No deployment is implied.
