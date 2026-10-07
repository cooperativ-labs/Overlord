# Chat diagnostics persistence and text coalescing — 2026-10-07

Mission `coo:1127.dq4h`. This pass uses the v159 diagnostics and performance baseline in [the performance report](chat-performance-baseline-2026-10-07.md) and [the optimization proposals](chat-optimization-proposals-2026-10-07.md). It keeps diagnostics complete, ordered, owner-private and independent of text publication.

## Changes

- Standalone diagnostic appends still take the thread row lock and serialize/insert inside the same awaited transaction. They now acquire that lock with one `UPDATE` and do not issue a subsequent `SELECT` for a thread DTO the diagnostic append does not use.
- Authorized diagnostic paging still checks live organization membership and thread owner/organization. It no longer opens a transaction or updates/locks the thread row, so page reads do not contend with a response writer's per-thread lock. The read is intentionally a point-in-time authorized observation; concurrent deletion may cascade rows after the ownership check.
- Default text coalescing is now checked at 500 ms / 800 characters. The first streamed text still flushes immediately, a final flush remains awaited, and raw SDK chunks continue to be captured before publication logic, one complete row at a time. No flush timer or background queue was added.
- No sequence allocator, table, index, route, DTO or diagnostic vocabulary changed. Contract remains v159; no migration is needed.

## SQL plans and attribution

The SQLite sequence append plan reports `SEARCH chat_diagnostics USING COVERING INDEX sqlite_autoindex_chat_diagnostics_1 (thread_id=?)`. The page plan reports `SEARCH ... USING INDEX sqlite_autoindex_chat_diagnostics_1 (thread_id=? AND seq>?)`. The primary key is `(thread_id, seq)`, so both operations use the existing index.

On PostgreSQL with 10,000 rows and analyzed statistics, sequence allocation via `MAX(seq)` is planned as `Limit → Index Only Scan Backward` on `chat_diagnostics_pkey`. The proposed descending `ORDER BY seq DESC LIMIT 1` expression produces the same plan. Diagnostic paging uses an ordered `Index Scan` on that same key for both a 5,000-row backlog (101 rows returned, 0.062 ms execution in the local disposable instance) and the near-tail case (100 returned, 0.037 ms). No sequence change or additional index is justified. These are local synthetic-table plans and timings, not Cloud production estimates.

The prior baseline showed median `diagnostic.transaction` totals of 2.1–2.9 ms and `thread.lock` totals of 1.5–3.5 ms across representative SQLite scenarios. The standalone append's unused thread read is a redundant backend round trip; the owner paging write lock is avoidable serialization with writers. Diagnostic serialization and insert remain awaited and unchanged.

## Coalescing experiment

The gated conformance measurement `CHAT_COALESCING_EVAL=1` emits 40 provider chunks of 60 characters on a 20 ms cadence. Each setting ran three times, with setting order rotated between repetitions. Every run asserted ordered diagnostic sequences, all 40 raw chunk rows, and all 2,400 final text characters. The table gives three-run medians:

| Adapter  | Coalesce ms / chars | Runtime ms | First durable text ms | Text commits |
| -------- | ------------------: | ---------: | --------------------: | -----------: |
| SQLite   |           250 / 400 |        956 |                    28 |            7 |
| SQLite   |           250 / 800 |        982 |                    29 |            5 |
| SQLite   |          250 / 1600 |        966 |                    28 |            5 |
| SQLite   |           500 / 400 |       1001 |                    31 |            7 |
| SQLite   |       **500 / 800** |    **952** |                **30** |        **4** |
| SQLite   |          500 / 1600 |        951 |                    28 |            3 |
| SQLite   |           750 / 400 |       1010 |                    30 |            7 |
| SQLite   |           750 / 800 |        971 |                    30 |            4 |
| SQLite   |          750 / 1600 |        964 |                    30 |            3 |
| Postgres |           250 / 400 |       1697 |                    55 |            8 |
| Postgres |           250 / 800 |       1578 |                    84 |            7 |
| Postgres |          250 / 1600 |       1630 |                    58 |            7 |
| Postgres |           500 / 400 |       1655 |                    71 |            7 |
| Postgres |       **500 / 800** |   **1437** |                **77** |        **4** |
| Postgres |          500 / 1600 |       1644 |                    68 |            4 |
| Postgres |           750 / 400 |       1718 |                    77 |            7 |
| Postgres |           750 / 800 |       1617 |                    83 |            4 |
| Postgres |          750 / 1600 |       1364 |                    59 |            3 |

On this scripted stream, 500 / 800 reduces text commits by 43% on SQLite and 50% on Postgres versus 250 / 400. First durable text remains immediate after the first SDK text chunk (medians 30 ms and 77 ms respectively). SQLite total runtime differences are within run variation; the lower Postgres medians are not a causal speed claim with only three samples and ongoing local adapter/cache variation. Larger settings reduce commits further in some cases but also suppress intermediate visible updates longer. The moderate 500 / 800 choice keeps that trade-off bounded. This is a synthetic server-side stream measurement, not browser paint or real Gemini latency.

The time threshold is checked only when another SDK chunk arrives; it is not a timer and does not independently delay a flush. A timer-backed flush was not justified by these results, so no timer or queue was added.

## Verification

- Focused diagnostics paging and live owner-gate cases passed on SQLite and disposable Postgres, including a Postgres writer lock held while a diagnostics page completed, and no thread revision/timestamp change from reads.
- The threshold matrix passed on both adapters, retaining every raw chunk and the complete final text for all 18 settings/adapter combinations.
- The existing status-path conformance test passed on SQLite and Postgres, including SDK thought separation, immediate first durable text, complete diagnostics and usage observations.

The scripted Postgres instance is local and ephemeral. These measurements do not represent a hosted database, browser paint, provider latency, or billing.
