# ADR 0101: Wake PostgreSQL realtime readers on feed commits

Date: 2026-11-21  
Status: accepted  
Contract impact: patch

## Decision

Migration `20261121160000_entity_change_wakeups` adds a PostgreSQL statement
trigger on feed inserts. It emits a constant empty notification after commit.
PostgreSQL folds identical notifications within a transaction. Each backend
listens on one dedicated session and treats a notification as a request to read
the durable feed. This covers inserts from any backend or service-layer writer.
There is no notification payload to authorize or use as a cursor.

Zero-subscriber hubs issue one startup baseline read, then skip feed polls
until the first subscriber arrives. Active hubs reconcile every five seconds
on the existing 500 ms timer and use the 500 ms cadence when listener failure is
detected. A successful LISTEN after startup or reconnect immediately requests a
feed pass. Full pages and wakeups received during a pass can schedule a follow-up
pass. Each stream tracks its own replay progress while an idle hub catches up.
All cursor decisions still use the synchronized feed read and retention boundary.
SQLite keeps its existing 500 ms loop and external-write detection.

The old timer provided an approximately 500 ms cross-process detection budget
at the cost of regular lock-taking reads on every backend. Simply lengthening
the timer would also lengthen normal cross-process delivery. Sending wakeups
from backend request handlers would miss external writers. The trigger and a
dedicated session avoid both tradeoffs at the cost of one PostgreSQL session per
backend and up to about one reconciliation interval during silent hint loss.

## Local PostgreSQL evidence

PostgreSQL 18 held 950,000 synthetic feed rows across four workspaces over a
21-day span with the partial indexes from ADR 0100 applied. A single hub was
measured at a time. Idle figures use ten-second samples from
`pg_stat_statements` and count transaction control and lock statements. Latency
is from immediately before sending COMMIT on a separate writer to the SSE
frame, with 100 commits per case and four workspace-scoped inserts per commit.
The healthy, baseline and failed connection cases used 15–214 ms between
commits. The silent failure case used 15–364 ms to sample the longer poll cycle.

| Measurement | Fixed polling | Commit wakeups |
| --- | ---: | ---: |
| Feed SQL statements/sec, no subscribers | 9.96 | 0 |
| Feed SQL statements/sec, one subscriber, no writes | 11.97 | 1.20 |
| Commit-to-SSE p95, healthy path | 487 ms | 15 ms |
| Commit-to-SSE p95, LISTEN unavailable | | 480 ms |
| Commit-to-SSE p95, trigger disabled with LISTEN armed | | 4,912 ms |

The focused suites exercise two hubs on one PostgreSQL database, startup
replay, backend connection termination and re-arm, a silent notification gap,
cross-workspace isolation, auth-triggered reconnect, expired-cursor recovery,
and the existing commit-order and SQLite behavior.

## Cloud rollout and reversal

Deploy the migration and backend through the normal release gate alongside the
prerequisites in ADR 0100. The listener needs session affinity, as provided by a
direct PostgreSQL connection. After rollout, check one armed
`overlord_entity_changes` session per backend in `pg_stat_activity`, compare
feed statement rates in `pg_stat_statements`, and measure delivery on a stream
served by a different backend from the writer. The figures above are from the
local benchmark and Cloud measurements are pending.

For reversal, roll the backend back to fixed polling first. The trigger is
compatible with the older backend. Remove the trigger and function in a
forward migration if reverting the database optimization.
