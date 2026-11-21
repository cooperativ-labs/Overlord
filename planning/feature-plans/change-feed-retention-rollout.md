# Change-feed retention: audit and rollout gates

Contract impact: major. Contract 180.0.0 specifies the local implementation;
deployment and mobile recovery are not established by this document.

## Reader audit

- `backend/realtime.ts` reads the feed for REST catch-up, SSE replay and live
  broadcasting. `backend/db.ts` now synchronizes PostgreSQL feed reads with
  writers before obtaining `MAX(seq)`; the raw maximum alone is not commit-safe.
- `webapp/web/lib/realtime.tsx` recovers from an expired cursor using the safe
  cursor, clears inactive cache, refreshes active queries, and catches up from
  that cursor. Desktop hosts this same SPA; both deployment modes require
  verification.
- The separate OverlordMobile project uses `/sync/changes?after=0` as its
  initial snapshot and drains pages before streaming
  (`OverlordCore/MissionEventStream.swift`). Its snapshot invalidates subscribers,
  but the existing protocol does not establish expired-cursor recovery. Its
  client and tests must be updated and verified alongside the server.
- `backend/ext/everhour/service.ts` uses all insert/update change actors for a
  legacy workspace connection to decide whether its credential can be adopted
  by a profile. Removing older evidence can change an ambiguous history into a
  falsely unambiguous one. Preserve complete attribution, including ambiguity
  and missing membership evidence, before deleting any relevant feed row. The
  local migration and pruning primitive preserve those actors in an extension
  table, and adoption checks the union with surviving feed rows.
- The production source search also found historical one-time migration
  backfills reading this table. Confirm their migration state and any supported
  upgrade paths before deleting their evidence; do not rerun them after pruning
  under the assumption that the remaining feed is complete.
  Production's migration ledger confirms `20260810074111` and `20261114180000`
  have run. This does not prove every other installation has run them; all
  required migrations must precede retention on each database.

## Rollout and compaction gates

1. Verify the commit-safe cursor and retained boundary, and exercise delayed
   concurrent commits, pruning races, authorization, pagination, and writes
   during refresh on PostgreSQL and SQLite. Never infer a retained boundary from
   the oldest surviving row alone.
2. Preserve and validate Everhour attribution and the migration evidence above.
   Apply both migrations and deploy the synchronized reader to every backend
   instance before enabling deletion; verify all instances run the intended
   release. Verify expired-cursor recovery, including offline deletions, in web,
   desktop, and mobile before enabling deletion. Keep pruning disabled until
   all gates pass and deployed clients can recover safely.
3. Take and verify a restorable backup; record its recovery point. Measure free
   disk and provision headroom for backup, index maintenance and any table
   rewrite before choosing compaction. Record initial volume, table and index
   sizes, row counts, age distribution, and feed write rate.
4. Enable bounded, retry-safe deletion in small transactions, advancing the
   boundary atomically with deletion and monitoring replication, lock waits,
   latency, disk use, and recovery errors. Pause on degradation. Recheck the
   boundary and client recovery after restarts and retries.
5. Measure rows and table/index/volume sizes after pruning. Ordinary vacuum
   permits internal space reuse but may not shrink the volume; choose a
   separately scheduled compaction method only after checking its locking,
   temporary-space and backup requirements. Record before/after measurements
   and verify application health and backup recoverability.

The worker is disabled by default; only after the gates above pass, set
`OVERLORD_CHANGE_FEED_PRUNING_ENABLED=true` on the Cloud backend. Each worker
pass removes at most 1,000 rows every five seconds while catching up; after a
partial or empty batch it waits an hour before the next scan. Multiple backend instances
may each run a pass, serialized by the feed lock. Disable the flag to pause;
restart the affected processes and confirm deletion has stopped. The retained
boundary never moves backward. Do not enable it merely because migrations or
the server have deployed: old mobile clients must also be able to recover.

Use the same database and measurement method before and after, and record the
timestamp, deployed revision, database/volume capacity, free space and worker
configuration alongside the results. The following read-only query records the
database and relation sizes, row count, age range and retained boundary (the
count scans the feed, so schedule it with regard to production load):

```sql
SELECT now() AS measured_at,
       pg_database_size(current_database()) AS database_bytes,
       pg_relation_size('entity_changes') AS heap_bytes,
       pg_indexes_size('entity_changes') AS index_bytes,
       pg_total_relation_size('entity_changes') AS total_bytes,
       (SELECT count(*) FROM entity_changes) AS feed_rows,
       (SELECT min(occurred_at) FROM entity_changes) AS oldest_change,
       (SELECT max(occurred_at) FROM entity_changes) AS newest_change,
       (SELECT retained_through FROM entity_change_retention WHERE id = 1) AS retained_through;
```

Record a tested restore point and actual free volume space before enabling.
Monitor request latency and database lock waits while pruning: PostgreSQL feed
reads use a `SHARE` lock and each pruning batch takes `SHARE ROW EXCLUSIVE`.
Pause on sustained contention, replication lag, unexpected recovery failures,
or insufficient space. Compare the measurements after pruning and after normal
vacuum. Normal `VACUUM` generally makes space reusable within PostgreSQL; it
does not promise to return it to the volume. A rewrite such as `VACUUM FULL`
requires an exclusive lock and additional disk space, so schedule it separately
only after checking current provider guidance, maintenance capacity, a tested
restore, and the application's tolerance for downtime.

Read-only Railway preflight on 2026-11-21: the `overlord-cloud` production
Postgres volume is provisioned at 10,000 MB; its most recent reported disk
sample was 4.521 GB. PITR status reported disabled. A volume backup named
`Online resize to 10000MB` exists from 09:56 UTC, expiring 2026-12-12; its
restore has not been tested here and it predates the intended rollout. Refresh
these measurements and establish a current, tested restore before enabling.
The backend service's variable inventory did not include
`OVERLORD_CHANGE_FEED_PRUNING_ENABLED` at the preflight check; verify again at
release time rather than relying on this snapshot.

An on-demand snapshot `pre-change-feed-retention-20261121` was created and
listed at 11:36:45 UTC (backup ID `61e68b01-3748-42c3-afec-df2518b85a30`,
10,000 MB source volume, 4,530 MB referenced). Railway listed no expiry for
this snapshot. Its restore has not been tested; the snapshot is not a substitute
for a verified restore or a fresh recovery point immediately before pruning.

Separately, at approximately 11:49 UTC a consistent logical dump was streamed
into the objective's owner-only temporary directory and restored successfully
into an isolated PostgreSQL 18 container. The restored database contained
3,764,305 feed rows through 11:49:02 UTC and both historical migration markers;
the temporary restore container was removed. The local dump is a separate backup
from the Railway volume snapshot, whose own restore remains untested. The dump
was created with `--no-owner --no-acl`, so this check does not prove that a
production restore would recover roles, ownership, or grants. Refresh the
recovery point and verify the complete recovery procedure immediately before
production pruning, and protect or remove the local dump when it is no longer
needed.

Read-only database baseline at 11:05:45 UTC on the same date: database
4,133,754,559 bytes; `entity_changes` heap 1,462,394,880 bytes; its indexes
1,838,825,472 bytes; total relation 3,301,646,336 bytes; 3,759,900 rows, from
2026-06-27 12:17:49 UTC through 2026-11-21 11:05:34 UTC. These are pre-change
measurements, not evidence of pruning or compaction.
