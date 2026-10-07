# Lossless diagnostic batching: measured no-go — 2026-10-07

Mission `coo:1127.0bj3`. This objective follows the transaction tuning in [the persistence report](chat-diagnostics-persistence-optimization-2026-10-07.md) and uses [the audit](chat-diagnostics-audit-2026-10-07.md), [the proposals](chat-optimization-proposals-2026-10-07.md) and [the performance baseline](chat-performance-baseline-2026-10-07.md) as inputs. Companion aggregates: [chat-diagnostic-batching-2026-10-07.metrics.json](chat-diagnostic-batching-2026-10-07.metrics.json).

## Decision

**No-go. No journal, schema, contract or runtime change.** After tuning, diagnostic persistence is not a material bottleneck. On a workload shaped like the live 269-second research run, the only contract-safe journal design would save 0.55 s at 1 ms database round-trip time. That is 0.2% of the run. At a pessimistic 5 ms RTT it would save 2.6 s (0.95%). It would also add a second write of every raw payload. Each text-delta and tool-transition transaction would get heavier, and the design would bring new ordering, visibility and recovery machinery. Contract v159 stays as it is.

## What was compared

`packages/core/bench/diagnostic-batching.ts` replays an ordered workload derived from audit thread A. It uses the exact per-exchange chunk counts and all 28 measured `provider.request` sizes. Rows of other kinds use the audit's per-kind row counts and mean sizes. The workload has 372 rows and about 4.03 MB of payload, against 377 rows and 4.05 MB live. 256 rows are standalone observations (requests, chunks, completions, tool responses, HTTP exchanges). 116 are domain-event diagnostics (`tool.updated`, `message.delta`) that already commit inside their event transaction. Payloads are random base64, so compression cannot flatter large rows. Every run asserts all rows are present with contiguous `seq`. The order-preserving strategies also assert that stored order exactly matches observation order.

| Strategy          | Standalone observation                                                          | Domain event                                           | Materialization                                        |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| `current`         | Real `ChatStore.diagnostic`: BEGIN, thread-lock UPDATE, INSERT…MAX(seq), COMMIT | lock + in-transaction append                           | none                                                   |
| `journal-ordered` | One autocommit durable INSERT into a keyed journal (`ON CONFLICT DO NOTHING`)   | lock, **materialize all pending journal rows**, append | inside the next domain transaction, plus a final flush |
| `journal-bulk32`  | same autocommit journal INSERT                                                  | domain diagnostic also journaled                       | separate transaction every 32 rows, plus a final flush |

`journal-ordered` is the cheapest design that keeps per-thread `seq` equal to observation order. A domain event's diagnostic row is allocated inside its own transaction, so any journaled observation admitted before it must be materialized first. `journal-bulk32` is an **optimistic upper bound only**. It is not a valid design: on Postgres, `bigserial` ids are allocated at insert time, not commit time. Concurrent writers (the runtime worker and REST `http.exchange` capture) can therefore commit out of id order. A materializer that ignores this can assign `seq` out of causal order, or skip a row and later have to insert behind it.

Each strategy ran 7 measured repetitions after a discarded warm-up, with order rotated each repetition. SQLite used an on-disk WAL database opened through `openDatabase` (the production path). Postgres used a disposable local instance with fresh schemas from `migratePostgres`. Network RTT was injected with a TCP delay relay. Statement counts come from instrumenting `pg.Client.query`.

## Results (medians of 7 runs, whole 372-row workload)

| Adapter / injected RTT | Strategy        | Postgres statements | Awaited critical path ms | Background materialize ms | End-to-end ms | Standalone row p50 / p95 ms | Domain event p50 / p95 ms |
| ---------------------- | --------------- | ------------------: | -----------------------: | ------------------------: | ------------: | --------------------------: | ------------------------: |
| SQLite (local disk)    | current         |                   — |                     66.0 |                         0 |          66.1 |               0.107 / 0.534 |             0.110 / 0.166 |
| SQLite                 | journal-ordered |                   — |                     70.1 |                       0.2 |          70.4 |               0.043 / 0.469 |             0.183 / 0.595 |
| SQLite                 | journal-bulk32  |                   — |                     45.9 |                      18.9 |          66.3 |               0.051 / 0.466 |             0.108 / 0.166 |
| Postgres / 0 ms        | current         |               1,488 |                    504.5 |                         0 |         505.1 |               1.271 / 2.361 |             1.253 / 1.862 |
| Postgres / 0 ms        | journal-ordered |                 990 |                    446.9 |                       2.7 |         450.1 |               0.392 / 1.101 |             2.916 / 4.513 |
| Postgres / 0 ms        | journal-bulk32  |                 792 |                    280.9 |                      55.6 |         336.0 |               0.394 / 1.329 |             1.226 / 3.210 |
| Postgres / 2 ms        | current         |               1,488 |                    7,917 |                         0 |         7,920 |                 20.8 / 32.4 |               20.7 / 32.8 |
| Postgres / 2 ms        | journal-ordered |                 990 |                    5,296 |                        32 |         5,321 |                   4.9 / 9.6 |               33.3 / 51.6 |
| Postgres / 5 ms        | current         |               1,488 |                   12,439 |                         0 |        12,444 |                 32.6 / 47.0 |               32.3 / 45.1 |
| Postgres / 5 ms        | journal-ordered |                 990 |                    8,813 |                        57 |         8,872 |                  8.2 / 14.4 |               54.0 / 76.0 |

Full distributions (min/p50/p95/max/mean/SD) for every cell, including the `journal-bulk32` RTT runs, are in the JSON. Run-to-run SD was 3–18 ms on SQLite, and 46–175 ms on local Postgres (`journal-bulk32` had the widest spread).

**Reading the RTT rows.** The relay adds a constant ~3 ms per statement on top of the injected delay, from timer granularity and multi-packet payloads. Per-statement cost was 4.8–5.0 ms at 2 ms injected and 8.0–8.5 ms at 5 ms, the same for all three strategies. So the RTT rows confirm that cost scales with statement count, but their absolute values overstate hosted latency. The table below therefore models hosted cost as the measured 0 ms local end-to-end time plus `statements × RTT`.

| Modeled hosted RTT | current        | journal-ordered (safe) | journal-bulk32 (unsafe bound) | Safe saving vs current |
| -----------------: | -------------- | ---------------------- | ----------------------------- | ---------------------: |
|             0.5 ms | 1.25 s (0.46%) | 0.95 s (0.35%)         | 0.73 s (0.27%)                |  0.30 s (0.11% of run) |
|               1 ms | 1.99 s (0.74%) | 1.44 s (0.54%)         | 1.13 s (0.42%)                |  0.55 s (0.20% of run) |
|               2 ms | 3.48 s (1.29%) | 2.43 s (0.90%)         | 1.92 s (0.71%)                |  1.05 s (0.39% of run) |
|               5 ms | 7.95 s (2.95%) | 5.40 s (2.01%)         | 4.30 s (1.60%)                |  2.55 s (0.95% of run) |

Percentages are of audit thread A's 269,024 ms run. They treat every persistence millisecond as if it were on the critical path. In practice, chunk persistence overlaps network buffering and model generation, so these are upper bounds. On SQLite, all diagnostic persistence for the run took 66 ms (0.025%), and the journal gave no end-to-end gain.

## Why the journal does not pay

1. **Durability needs a commit per observation either way.** The criteria require every observation to be durably captured before dependent runtime work is released. So the journal still costs one durable commit per standalone row. It saves only the BEGIN, lock and COMMIT round trips (4 → 1 statements). It does not save the fsync, serialization or payload write.
2. **Ordering forces frequent flushes.** In the live shape, a domain event follows every ~2.2 standalone rows: chunk/delta alternation during final text, and three `tool.updated` transitions per tool. Ordered materialization therefore runs in nearly every domain transaction. Batch sizes stay tiny and the per-batch overhead (MAX id, INSERT…SELECT with window numbering, DELETE) is rarely amortized. Domain events get **slower**: p50 2.9 ms against 1.25 ms locally, and the gap widens with RTT. Those transactions include `message.delta` commits, so first durable text and every visible update would be delayed.
3. **Double writes.** Every raw payload (up to 217 KB per request row) is written twice and deleted once. That increases WAL volume and vacuum work roughly in proportion to the 4 MB/run diagnostic volume.
4. **Visibility and concurrency.** A diagnostic page must either union unmaterialized journal rows, which needs provisional ordering keys outside `seq`, or wait for materialization, which breaks individual page visibility. Safe ordering across concurrent worker and REST admissions needs a commit-order watermark or the thread lock at admission. Taking the lock at admission gives back the round trips the journal saved.

## Required properties, had it been justified

Specified here so a future revisit starts from the same constraints:

- **Admission:** the INSERT is awaited and committed before dependent runtime work continues. Each row carries a unique admission key (attempt + local observation counter, or HTTP request id + phase); replays after an ambiguous crash are no-ops. In-memory queues and shutdown flushes are not acceptable.
- **Ordering:** `seq` is assigned only under the thread row lock, in commit order. Any domain-event transaction first materializes every journal row for the thread that committed before it. Postgres admission ids are not commit-ordered, so the materializer needs a watermark, for example a per-thread admission counter allocated under a short lock.
- **Visibility:** diagnostic pages read materialized rows plus admitted journal rows in a single stable ordering, or materialization is forced before a page read. Either way, owner-only gates and no-store stay unchanged.
- **Recovery:** on worker start or lease takeover, and before the next append, leftover journal rows for the thread are materialized idempotently. The prototype checked this. A crash after 40 admissions with 10 replayed duplicates recovered exactly 40 rows; a second recovery moved 0. This took 0.9 ms on SQLite, 6.3 ms on local Postgres and 35–62 ms through the delay relay.
- **Cascades:** journal rows reference `chat_threads ON DELETE CASCADE`, so deleting a thread or account removes unmaterialized rows too. The prototype verified that zero journal and diagnostic rows remained after thread deletion.
- **Atomicity:** checkpoint, receipt and domain-event diagnostics stay inside their existing transactions. Only standalone observations would move.

These would need a contract amendment (an additive journal table on both editions, plus recovery and page-visibility semantics) and implementations in both adapters. The measured gain does not justify that.

## Cheaper option if hosted RTT proves high

Two of the four round trips exist only to take the lock and allocate `seq` in separate statements. A single autocommit statement could do lock, allocation and insert together, with no journal and no second write. For example, `WITH s AS (UPDATE chat_threads SET last_diagnostic_seq = last_diagnostic_seq + 1 WHERE id = ? RETURNING id, last_diagnostic_seq) INSERT INTO chat_diagnostics … SELECT … FROM s`. In Postgres, the UPDATE re-reads the latest row version after a lock wait, so allocation stays correct under contention. This removes 3 statements from each of the 256 standalone rows (768 of 1,488), more than the safe journal's 498. Domain events would allocate from the same counter. It still needs an additive column, a backfill migration and a contract note. Given at most 0.77 s per run at 1 ms RTT, it was **not implemented**. Revisit it only after production measurements show high `diagnostic.transaction` / `thread.lock` spans; the w09e instrumentation already records both per attempt.

## Limitations

- Postgres was local and disposable. Hosted RTT is modeled from statement counts, not measured; the live audit predates span instrumentation. Before acting on the cheaper option, confirm the production database RTT and the live `diagnostic.transaction` spans from owner exports, using `scripts/analyze-chat-performance.mjs`.
- The workload reconstructs live ordering from content-free counts and mean sizes, not from the raw order of the live thread.
- Domain events are emulated as lock + append. Real event transactions do more work, which would make the journal's added materialization a smaller share. The direction of the result does not change.
- This is a server-side persistence measurement. It does not measure browser paint, provider latency or billing, and it implies zero model-token change.

## Reproduction

```sh
CHAT_BATCH_EVAL_REPEATS=7 CHAT_BATCH_EVAL_RTT_MS=0,2,5 \
  node scripts/with-test-db.mjs node --import tsx packages/core/bench/diagnostic-batching.ts out.json
```

Without `TEST_DATABASE_URL`, only the SQLite configuration runs. Node 24.13.0 on Darwin arm64 was used, which matches the installed `better-sqlite3` ABI. Journal tables are created only in the benchmark's disposable databases. Nothing is written to production schemas, and no owner content is read.
