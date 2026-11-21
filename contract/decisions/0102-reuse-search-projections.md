# ADR 0102: Reuse unchanged search projections

Date: 2026-11-21  
Status: accepted  
Contract version: 182.0.3  
Supersedes: none  
Contract impact: patch

## Context

Production `search_documents` was reported at about 266 MB. Mission board
moves and objective lifecycle transitions commonly advance a revision with the
same search text. Delivery presentation updates also advance a revision, while
answering a mission event changes only its payload. The earlier PostgreSQL
triggers upserted text on all four paths. SQLite also ran FTS5 delete/insert
pairs on metadata-only document updates. SQLite only indexed event inserts and
deletes, so an existing event document could retain its old project after a
mission move.

Search uses source rows for recency and authorization. The repository's search
readers do not consume `indexed_at` or `source_revision`.

## Decision

Migration `20261121170000_search_projection_updates` compares the projected
title, body, scope, and revision with the stored document. Identical projections
keep their timestamp. Revision and scope changes still update the document and
its timestamp. PostgreSQL omits title and body from metadata-only updates so
the stored generated vector can be reused. SQLite updates FTS5 only when title,
body, or row identity changes. The SQLite event trigger handles projected field
changes and the migration reconciles old event project IDs in place.

Both adapters keep the existing text builders, tokenizers, ranking functions,
and transactional writes. A missing document on the upsert path is inserted,
including on restore. Tombstones still remove their corresponding documents.
The migration changes no row shape or search API.

## Consequences

The final local PostgreSQL 18.7 replay starts from two clones of a 263 MB
search relation with 208,000 documents, four workspaces, 16 projects, and
950,000 synthetic feed changes over 21 days. About 27% of the feed rows have
project and mission references. The workload uses application write shapes.
The operation counts reflect the fixture mix. Each row below is one batch
in the replay, alternating which variant ran first. Document writes come from
`pg_stat_user_tables` and trigger times from `EXPLAIN ANALYZE`.

| Source operation | Input rows | Document writes before → after | Trigger ms before → after |
| --- | ---: | ---: | ---: |
| Mission board position and revision | 5,000 | 5,000 → 5,000 | 1,140 → 345 |
| Mission text edit | 500 | 500 → 500 | 106 → 118 |
| Objective workflow metadata and revision | 12,000 | 12,000 → 12,000 | 3,198 → 886 |
| Objective text edit | 600 | 600 → 600 | 169 → 161 |
| Delivery presentation and revision | 2,000 | 2,000 → 2,000 | 535 → 203 |
| Delivery searchable report edit | 150 | 150 → 150 | 33 → 39 |
| Event payload update | 3,000 | 3,000 → 0 | 286 → 68 |
| Event insert | 8,000 | 8,000 → 8,000 | 443 → 510 |

The four metadata batches took 5.97 seconds before and 2.29 seconds after,
equivalent to 3,687 versus 9,593 source updates per second. They wrote 202.3 MB
versus 190.3 MB of WAL in the final replay, including source writes and
first-touch page images. WAL varied between runs. The event insert batch
was slower in this replay despite retaining direct insertion with the
previous document projection. The combined replay took 7.23 seconds before
and 3.67 seconds after for this mix of inserts and updates.

Eight project-filtered v3 queries, including exact-ID, mixed title/body, and
delivery-content queries, returned identical result envelopes. Across 64 warm
queries per variant in the final replay, p50 was 42.4 versus 45.8 ms and p95
was 163.5 versus 151.5 ms. Earlier PostgreSQL 17 runs also returned identical
envelopes and showed similar before-and-after read latency. Upgrade conformance
on both adapters covers migration retry, timestamps, revisions, SQLite FTS
write counts, search freshness, scope moves, soft deletion, restoration, and
event hard deletion.

Roll out the forward migration through the normal Cloud release gate. Compare
search-document updates per source write, search trigger time if collected, and
v3 latency over equivalent traffic windows after rollout. The PostgreSQL
migration replaces functions without rewriting documents. A forward rollback
can restore the prior trigger definitions while retaining existing documents.
Cloud deployment and production follow-up measurements are pending.

## Alternatives considered

An upsert predicate alone would suppress identical row writes, but PostgreSQL
would still compute a candidate vector to check the conflict and SQLite would
still retokenize on revision-only writes. Advancing revisions only for text
changes would save additional row writes at the cost of source revision
fidelity. The adopted path keeps revisions current and avoids repeating
full-text work when text is identical.
