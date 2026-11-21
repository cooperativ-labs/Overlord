# ADR 0100: Index populated project and mission references in the change feed

Date: 2026-11-21  
Status: accepted  
Contract version: [182.0.1](../CHANGELOG.md#18201---2026-11-21)  
Contract impact: patch

## Decision

Both adapters index `(project_id, seq)` for rows with a project and `(mission_id)`
for rows with a mission. Migration `20261121150000_partial_change_feed_indexes`
builds both replacements before removing either original.

The tenant-only REST/SSE catch-up and global realtime poll use the workspace and
sequence access paths. Project-scoped tokens add a project equality or
`IN` predicate, so the project index retains sequence ordering within one
project. Everhour attribution reads by entity type and ID. The runtime and
historical migration readers have no mission-ordered cursor. The project and
mission foreign keys both use `ON DELETE SET NULL`. Application deletion
normally soft-deletes those records. Physical maintenance deletes still need
efficient lookups, including when a parent has no matching feed rows.

## Production baseline

Read-only samples on 2026-11-21, between 14:09 and 14:13 UTC, used
Overlord Cloud PostgreSQL 18.6. At the initial sample both indexes reported
zero scans with tracking enabled. The database reset timestamp was null and the
postmaster had been up since October 25 at 10:56 UTC, approximately 27 days. The
start of the per-index observation period is unknown because individual counters
can be reset independently.

The project index occupied 160,071,680 bytes and the mission index occupied
155,901,952 bytes, or 301.3 MiB combined. Production retention was actively
catching up. The retained cursor advanced from 388,154 to 427,161 during the
inspection. The 21-day window contained 953,269 rows, of which 257,686 had a
project and 257,674 had a mission. The old index files still occupied their
initial size while pruning progressed.

Read-only `EXPLAIN ANALYZE` used the live catch-up projection, sequence bounds,
and 501-row limit. A round through the busiest and least active recent tenants
took 0.75 and 0.37 ms from the retained boundary and used the sequence primary
key. The busiest recent project used the sequence primary key and took
28.69 ms from the retained boundary or 0.48 ms over the latest 50,000 sequence
positions. The least active recent project used the project index and took
6.26 and 0.11 ms for those same bounds. A read-only lookup for rows referencing
the sampled busy mission used the mission index. The busiest project
foreign-key lookup chose a parallel heap scan for 193,614 matching rows.
The probes themselves recorded two project index scans and one mission index
scan. These are single production samples, not latency percentiles.

## Retained-window comparison

An isolated PostgreSQL 18 run used 950,000 synthetic rows, four tenants, 15
projects, 869 missions and about 27% populated references. It included a
recent hot-project burst. Catch-up figures are medians of 11 SQL executions,
including heap fetches, with a 501-row page limit. The append median is per
10,000-row batch over five batches with foreign keys enabled. WAL is the total
reported by the five INSERT plans after a checkpoint. The foreign-key figures
are single physical deletes of parents with no referencing rows.

| Measurement | Full indexes | Both removed | Partial indexes |
| --- | ---: | ---: | ---: |
| Project and mission indexes | 75.05 MiB | 0 MiB | 18.59 MiB |
| All feed indexes | 309.04 MiB | 233.99 MiB | 252.59 MiB |
| Busy / sparse tenant catch-up | 0.101 / 0.143 ms | 0.098 / 0.132 ms | 0.097 / 0.129 ms |
| Busy project catch-up from window start | 208.727 ms | 197.238 ms | 196.843 ms |
| Busy project catch-up near head | 0.135 ms | 0.140 ms | 0.136 ms |
| Sparse project catch-up from window start | 0.160 ms | 4.165 ms | 0.150 ms |
| Sparse project with no newer changes | 0.009 ms | 9.944 ms | 0.008 ms |
| Two-project catch-up | 6.293 ms | 4.768 ms | 4.943 ms |
| Append batch median | 597.724 ms | 473.100 ms | 426.573 ms |
| Append WAL over 50,000 rows | 199,408,886 bytes | 170,991,795 bytes | 180,781,257 bytes |
| Mission / project foreign-key delete, zero matches | 1.078 / 0.113 ms | 118.085 / 93.474 ms | 0.157 / 0.107 ms |

The partial indexes saved 56.45 MiB against freshly built full indexes at the
same row count and generated about 9% less statement WAL. A second workload
with fewer scoped rows also reduced storage and WAL. Append latency is
directional because the run used one host and sequential variants. A busy
project's older cursor can still scan a wide sequence gap when the optimizer
chooses the primary key. Synthetic timings and sizes describe the tested data,
not production savings. The Cloud rollout remains pending.

## Cloud rollout and reversal

1. Let the retention backlog drain, then record the age range, row count,
   relation and index sizes, free disk, and a fresh catch-up baseline. Choose a
   low-traffic maintenance window and verify headroom for both old and new
   indexes plus temporary build data.
2. In an autocommit PostgreSQL session, build the indexes one at a time. Set a
   session `lock_timeout` and a `statement_timeout` approved for the window.
   Concurrent builds allow ordinary inserts but conflict with the feed's
   explicit `SHARE` reader locks and `SHARE ROW EXCLUSIVE` pruning lock. The
   readers can hit their two-second lock timeout. Monitor sync latency,
   `pg_stat_progress_create_index`, and locks. If a build is interrupted,
   inspect its catalog state and drop an invalid replacement with
   `DROP INDEX CONCURRENTLY` before retrying.

   ```sql
   CREATE INDEX CONCURRENTLY idx_entity_changes_project_nonnull_seq
     ON public.entity_changes (project_id, seq) WHERE project_id IS NOT NULL;
   CREATE INDEX CONCURRENTLY idx_entity_changes_mission_nonnull
     ON public.entity_changes (mission_id) WHERE mission_id IS NOT NULL;
   ```

3. Verify both replacements on `public.entity_changes` with
   `pg_get_indexdef` and `pg_index.indisvalid`. Run the normal gated release.
   The migration reuses and validates the replacements and limits lock waits to
   two seconds during the transactional swap. If it times out, the originals
   survive and the release can retry. Fresh databases build both indexes in
   the migration itself.
4. Verify the migration ledger and index definitions. Repeat equivalent tenant
   and project catch-up plans and compare sync latency, lock failures, observed
   WAL where attributable, and relation sizes in matching traffic windows.
   Monitor feed writes and pruning through the rollout. Use relation bytes
   and provider billing as separate measurements.
5. To reverse a committed swap, rebuild the original indexes one at a time
   with `CREATE INDEX CONCURRENTLY` using `(project_id, seq)` and
   `(mission_id, seq)` and the original names. Validate both before removing
   the partial replacements. Ship a forward corrective migration and
   contract update to restore the prior schema across both adapters.

[PostgreSQL statistics](https://www.postgresql.org/docs/18/monitoring-stats.html),
[concurrent index builds](https://www.postgresql.org/docs/18/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY),
and [lock modes](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-TABLES)
describe the operational constraints.
