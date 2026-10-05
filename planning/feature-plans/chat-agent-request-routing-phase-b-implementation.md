# Durable conversations and authorized replay — coo:1108.a1ac

Implements the Phase B core/backend slice against contract v152 and the predecessor's
SQLite/Postgres migrations and DTOs. No stable interface, schema, contract version,
mission notification behavior, or project metadata was changed by this objective.

## Implementation

- `packages/core/service/chat/conversations.ts`: profile/organization-private thread
  create/list/rename/archive, atomic message/run submission, request deduplication,
  message-as-answer, question revision checks, cancellation, Continue, bounded
  atomic snapshots, replay pages, and source/dependency registration.
- `packages/core/service/chat/store.ts`: live organization membership checks,
  thread-row serialization, explicit DTO mapping, durable gap-free event allocation,
  retention, immutable dependency unions, current source checks, whole-block
  invalidation, run termination and atomic conversation-notification candidates.
- `packages/core/service/chat/runs.ts`: renewable leases and monotonic fences,
  claims/recovery, private checkpoints and read receipts, call-order joins,
  bounded parallel reads, coalesced text publication, questions and typed terminal
  transitions. Provider input is bounded to the latest 100 messages plus the latest
  authorized summary and recorded observations.
- `backend/chat.ts`: authenticated JSON routes, bounded polling fallback and SSE.
  `backend/index.ts` mounts it after session authentication and the existing
  project-automation route guard. Local requests receive `chat_unavailable`.
- `backend/chat-worker.ts`: bounded scheduling, lease renewal, cancellation/abort,
  typed runtime failures and a periodic retention sweep for idle threads.

Thread operations serialize through an owner-filtered row lock; this includes
Postgres snapshots at its default READ COMMITTED isolation. Event sequence allocation
and insertion happen in the same transaction. SSE uses the same authorized storage
projection for replay and subsequent polling, with a default 500 ms live poll interval,
ordered pages, disconnect cleanup, backpressure, heartbeat frames, and
`snapshot_required` on expired cursors. There is no in-memory publication bus or
subscription handoff race. Events never enter `entity_changes`, webhooks or search.

The owner allowance is serialized on the profile row across threads. One unfinished
run per thread is additionally enforced by the predecessor's partial unique index.
Run/message creation timestamps preserve insertion order even within one millisecond,
so transcript order and the latest-run Continue check are deterministic.

Each worker mutation checks the current run fence, active attempt, cancellation and
unexpired lease; a matching fence alone cannot authorize an expired worker. On recovery,
a compatible checkpoint retains opaque provider parts and signatures. Its pending
reads reuse the original operation IDs; completed receipts are never re-executed.
Results are joined in stored turn/call order with exact provider-call ID matching.
Incompatible checkpoints are deleted, the attempt explicitly records
`fresh_generation`, unfinished old calls are cancelled, partial messages are marked
interrupted, and authorized messages/recorded observations remain available.

A provider request must use `providerInput()`. Recovery inspection uses `input()`.
`providerInput()` rejects an unjoined tool-request checkpoint or outstanding receipts;
normal completion and starting the next tool turn also reject incomplete exchanges.
`requestTools()` commits its checkpoint and receipts before `executeTool()` invokes an
injected read, and `toolResult()` commits the result before `joinTools()` persists the
joined checkpoint. Text supplied to `text()` is already coalesced by the runtime.

The stored per-run allowance defaults to 60 calls and ten active minutes; waiting for
an answer releases the lease and does not consume active time. A run admits four
simultaneous target reads. Exhaustion completes with `allowance_exhausted`; a
transactional latest-run check and unique continuation index create one fresh run,
returning that same run on retries.

## Source authorization seam

Inject `ChatOptions.checkSource(owner, locator, abortSignal)` into the conversation
and worker services. It returns `authorized`, `revoked`, or `unknown`; absence,
exceptions and a three-second timeout fail closed. This is an injection boundary,
not a claim that Knowledgebase authorization is integrated.

Generated content conservatively inherits authorized dependency sets across the
thread, including summary/message history. Snapshots, replay/live pages, worker
publication, runtime input and checkpoint recovery recheck sources. Revocation marks
dependency sets, messages, summaries, checkpoints and proposal revisions invalidated,
supersedes affected questions, increments the authorization revision and fences active
or waiting generations with `source_access_lost`. Replay replaces old content-bearing
events with `content.invalidated`; snapshots replace whole affected message blocks
with `unavailable`. Authorization observations and invalidation commit even when a
subsequent requested action conflicts or a stale worker is rejected.

Reauthorization does not resurrect old content. New dependency digests include the
thread authorization revision, allowing a fresh generation with a new immutable set
while historical sets remain invalidated. Future proposal/provider services must use
this shared projection rather than return stored payloads directly.

## Runtime and production availability

The runtime is injected as `ChatRuntime` (identity plus `execute(attempt, runs, signal)`).
Tests supply a fake runtime. The production bootstrap intentionally uses an unavailable
runtime that terminates with the typed `provider_unavailable` failure. It never
returns mock answers. The real Gemini runtime, Knowledgebase checker, repository
read gateway, proposals/Create, client journeys and notification dispatch remain
in the mission's already-defined later objectives. Snapshots currently return no
open proposals because proposal preparation is not installed in this slice.

Notification candidates are written atomically for each question and completed/failed
transition, deduplicated by question ordinal or terminal state. Dispatch, presence,
render acknowledgements and history endpoints belong to the later notification
objective. No arbitrary workspace, mission or worker job is invented for a chat.

## Verification

Final result: **64 passed, zero failures or skips** (46 new core scenarios across
the two databases, two HTTP/worker tests, and 16 predecessor schema checks).

Focused conformance suites cover both SQLite and real pooled Postgres, with separate
connections for races: atomic submission and rollback, duplicates, cross-owner and
organization denial, rename/archive CAS, snapshot/publication races, reconnect and
retention gaps, competing question answers, message-as-answer, cancellation during a
read, expired/stale leases and competing claims, restart at tool-request/result
boundaries, sequential/parallel call order, explicit fresh recovery, active and tool
allowances, waiting-time exclusion, parallel-read bounds, concurrent Continue,
same-millisecond run ordering, source revocation/reauthorization, notification
transition candidates, private-state exclusion and idle-thread retention.

HTTP tests exercise authenticated-context routing, JSON conflicts, polling, real
SSE replay/live publication, disconnect and Local gating. Worker tests execute a fake
runtime and typed failure. The predecessor's dual-database schema invariant suite is
run alongside these tests. The root `test:conformance` command includes the new core
suite.

Run with Node 24 (the installed SQLite native module targets that ABI):

```sh
node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 \
  packages/core/service/chat/chat.postgres-conformance.test.ts \
  backend/chat.test.ts database/src/chat-schema.postgres-conformance.test.ts
```

Core typecheck, focused lint, workspace-scoping, conformance-version and whitespace
checks pass. The broader backend typecheck reports two existing Response test-double
errors in `backend/execution/runner-claim-http.test.ts:39` and `:40`; that file is
unchanged by this objective. The root strict typecheck also reports existing errors
outside the changed chat files; no errors remain in the new chat files. No deployment,
live provider/Knowledgebase success,
commit, or change to other agents' work is claimed.
