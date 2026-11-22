# ADR 0103: Coordinate the PostgreSQL change feed with an advisory gate

Date: 2026-11-21  
Status: accepted  
Contract version: [182.0.4](../CHANGELOG.md#18204---2026-11-21)  
Contract impact: patch

## Context

PostgreSQL feed readers took `LOCK TABLE entity_changes IN SHARE MODE` so that no
lower identity could commit behind a returned cursor. Retention pruning and
account erasure took `SHARE ROW EXCLUSIVE`. Both modes conflict with the
`SHARE UPDATE EXCLUSIVE` lock held by ordinary autovacuum. A session that waits
on autovacuum for `deadlock_timeout` (1 s) cancels it. On 2026-11-21, Cloud
PostgreSQL logged 280 cancellations on `public.entity_changes` between 15:32
and 20:12 CET, plus `skipping vacuum ... lock not available` entries. A
successful run at 20:16 CET reduced estimated dead rows from 2.83M to zero.
Production logs do not record lock waits (`log_lock_waits` is off), and no
canceling session was identified, so the production cancellations remain
unattributed. Each cancellation in the sampled window came about one second
after an autovacuum start, which is consistent with a waiter reaching
`deadlock_timeout`.

## Decision

Migration `20261121180000_entity_change_feed_gate` adds the feed gate: one
transaction-scoped advisory lock per `entity_changes` relation (key: `'ovld'` in
the high 32 bits, the table OID in the low 32 bits).

- A `BEFORE INSERT ... FOR EACH STATEMENT` trigger takes the gate in shared mode.
  PostgreSQL fires it before the statement's rows, and therefore their identity
  defaults, are produced. Every writer holds the gate from before allocation to
  commit or rollback: backend and service code, direct SQL, multi-row and
  `INSERT ... SELECT` statements, `COPY`, and backends of either release.
- The trigger records the sequence's last allocated value once the gate is held.
  An `AFTER INSERT` statement check rejects rows whose `seq` is at or below that
  floor or above the sequence's current value. It rejects explicit values,
  `OVERRIDING SYSTEM VALUE` and values from an earlier `nextval()`. A
  `nextval()` evaluated by the statement itself is allocated under the gate and
  accepted.
- `withCommittedFeed` (REST catch-up, `/sync/baseline`, SSE hub passes) and
  `pruneChangeFeedBatch` call `entity_changes_feed_read_gate()`: the exclusive
  gate under a 2 s `lock_timeout`. A transaction that has inserted feed rows
  gets SQLSTATE `55000` instead of upgrading its shared hold. An upgrade can
  deadlock against another upgrader and would wait on its own rows. Nested reads
  inside a read re-enter the exclusive hold.
- Account erasure takes the shared gate before domain locks with
  `entity_changes_feed_write_gate()`. Pruning still excludes it, so Everhour
  redaction and evidence preservation stay serialized. Other writers are no
  longer blocked.
- LISTEN/NOTIFY (ADR 0101) remains a wake hint only. SQLite is unchanged.

No recurring feed path takes an `entity_changes` table lock above `ROW
EXCLUSIVE`, so none waits for or cancels ordinary autovacuum. Migrations that
alter the table still take strong locks, as any DDL does.

Readers now serialize with one another, where `SHARE` let them overlap. The
benchmark below measured that cost.

## Evidence (local PostgreSQL 18.7)

Attribution (one workload per 40 s run; 4 writers; a 200,000-row table with
dead-tuple churn and throttled autovacuum; default `deadlock_timeout`):

| Workload | Lock held | Waits blocked by autovacuum | Autovacuum cancelled | Completed | Dead tuples at end |
| --- | --- | ---: | ---: | ---: | ---: |
| Feed reader, 100 ms cadence | `SHARE` | 529 samples | 16 (+5 skipped) | 3 | 178,336 |
| Pruning, 500 ms cadence | `SHARE ROW EXCLUSIVE` | 539 samples | 8 | 15 | 0 |
| Account erasure, 500 ms cadence | `SHARE ROW EXCLUSIVE` | 574 samples | 12 (+1 skipped) | 10 | 0 |
| Gated reader / pruning / erasure | advisory gate | 0 | 0 | 21–22 | 0 |

Each legacy waiter logged `still waiting for ShareLock` at 1 s, followed by
`canceling autovacuum task` for `entity_changes`. With the old erasure lock, a
writer holding the membership row and a queued reader produced a deadlock
(`40P01`) for the erasure. With the gate, the same scenario completes: PostgreSQL
reorders the soft wait.

Benchmark (`old` = table locks, `new` = gate). Each run had 60 s of identical
load: 3 replicas, each with a LISTEN-woken hub and a REST catch-up loop; 8
writers; pruning of a 30-day-old prefix during traffic; and one hub
disconnected for 5 s, then catching up in 500-row pages. The acceptance limits
were fixed before the comparison: zero skipped events, no deadlocks, completed
autovacuum with no cancellations, and latency within 1.2×/1.25× of the baseline.

| Metric (ms) | Old p95 / p99 | New p95 / p99 |
| --- | ---: | ---: |
| Writer transaction | 29.6 / 49.9 | 19.9 / 31.4 |
| Hub pass | 15.0 / 35.0 | 15.6 / 24.7 |
| REST catch-up read | 34.4 / 983.6 | 21.1 / 36.6 |
| Reader lock wait | 13.0 / 33.9 | 13.8 / 22.5 |
| Commit-to-read lag | 10.7 / 32.1 | 10.2 / 17.5 |
| Max stall (any path) | ~1,064 | 165 |
| Skipped events / deadlocks / lock timeouts | 0 / 0 / 0 | 0 / 0 / 0 |
| Autovacuum completed / cancelled / skipped | 0 / 9 / 49 | 31 / 0 / 0 |
| Dead tuples at end | 460,352 | 0 |

Burst catch-up lag after the 5 s disconnect is dominated by the disconnect in
both designs (p95 ≈ 4.8 s). The candidate passed the acceptance gate, so the
transactional-outbox alternative was not pursued.

`backend/realtime-feed-gate.postgres-conformance.test.ts` covers the
following:

- Inserts are observed blocked on the gate in `pg_stat_activity` while the
  sequence stays unchanged, for single-row, multi-row and `INSERT ... SELECT`.
- Explicit, overriding and pre-allocated identities are rejected.
- Delayed lower-sequence commits and rollbacks are handled.
- Upgrades fail fast.
- `VACUUM` proceeds while each gate holder is open, and times out against the
  legacy `SHARE` lock.
- Erasure racing a writer on the same membership resolves behind a queued
  reader.
- Gap-free cursors under live writes for legacy-only, mixed, and gated-only
  readers.

## Deployment, rollback and retirement

1. Keep `OVERLORD_CHANGE_FEED_PRUNING_ENABLED` unset on every backend until
   step 3 completes. Gated pruning does not exclude a reader that uses the old
   lock, and old pruning does not exclude a gated reader.
2. Deploy normally. The backend applies the migration at startup, before it
   serves reads, so database enforcement covers every writer, including older
   replicas still running, before any reader uses the gate. The trigger is
   compatible with the older backend. While both releases run, every writer
   holds both its `ROW EXCLUSIVE` lock and the shared gate, so readers of either
   kind keep the cursor invariant.
3. When every backend runs this release, the compatibility period ends. No
   participant takes `SHARE` or `SHARE ROW EXCLUSIVE` any more, and pruning may
   be enabled under its existing conditions.

To roll back, deploy the previous backend and leave the migration in place.
Readers that use the old lock remain correct with gated writers, and mixed
rollback states keep a common mechanism: every writer holds both locks. Remove
the trigger and functions in a forward migration only after every backend has
returned to the old lock. Retire nothing else: the trigger is the permanent
writer side of the gate.

## Production verification

After rollout, check the following:

- `pg_stat_user_tables` for `entity_changes`: `autovacuum_count` rises and
  `last_autovacuum` is recent.
- `n_dead_tup` stays near the autovacuum threshold instead of growing.
- The PostgreSQL logs have no new `canceling autovacuum task` or
  `skipping vacuum of "entity_changes" --- lock not available` entries for
  `entity_changes`.
- `pg_locks` shows no `ShareLock` or `ShareRowExclusiveLock` on
  `entity_changes` from backend sessions.

Optionally, enable `log_lock_waits` to attribute any future conflict. RAM and
allocated disk are outside this check: the table does not shrink without a
rewrite.
