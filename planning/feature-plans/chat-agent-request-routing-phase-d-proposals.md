# Phase D — proposals and atomic draft creation (coo:1108.k0tc)

Implemented against contract 152 on 2026-10-04. No new public DTO, route, schema,
contract version, or migration was needed. Contract/component descriptions were
clarified before implementation; predecessor and unrelated edits were preserved.
No changes were staged or committed.

## Transaction proof

Before production implementation, a test opened one outer transaction, called
`createMissionWithObjectives` in two different workspaces, inserted a chat receipt,
and then failed a later project lookup. SQLite and pooled Postgres both rolled back
missions, objectives, sequence increments, change rows and receipt. The production
Create test additionally removes the later destination's Draft status after
preparation, proving rollback after the earlier draft and receipt have been written.

Create uses the existing mission service once per mission, with the acting user's
membership and workspace context. Its outer transaction contains all domain rows,
receipt links, proposal state and the private `proposal.created` event. Owner row
locking serializes request keys across threads; stable workspace lock ordering and
atomic shared mission-sequence allocation also cover concurrent ordinary creation.
A fresh service instance reads the original receipt after a committed response is
lost. Concurrent calls return identical ids. Reusing a key for another proposal is
`invalid_request` and creates nothing.

## Implementation

- Core: `packages/core/service/chat/proposals.ts` owns private preparation, immutable
  versioned specs, shared proposal projection, and the client Create command.
  `assignments.ts` projects catalogs to selection data only; commands, flags and
  target configuration never enter provider discovery. `store.ts` carries the
  injected instance-catalog resolver. Snapshots and provider input contain projected
  proposal cards; transcript messages contain typed proposal blocks.
- Shared mission service: accepts explicit reasoning effort and the source thread
  reference, stamping provenance before normal change handling. Its counter
  allocation is now one atomic update shared by chat and ordinary callers.
- Runtime: `prepare_proposal` is checkpointed through the existing receipt gateway.
  It prepares/revises a card, never creates domain work. A stable operation id prevents
  republishing after worker recovery. Tool evidence includes its stable evidence id.
  Missing/unsupported assignments return an actionable tool failure; the tested
  next action asks the user through `ask_user`. Follow-up turns can revise an existing
  card by id and expected revision.
- HTTP: existing contracted `POST /api/chat/proposals/:id/create` is wired through
  Conversations to the core service. Owner/organization checks, revision conflicts,
  request validation and the Local unavailable guard use the existing closed errors.
- Backend: resolves the destination workspace's stored catalog, or the same bundled
  plus instance-config catalog used by launch settings. This is injected into
  conversation services, workers and discovery without changing catalog ownership.

Preparation resolves the member's project launch preference when an assignment is
omitted. Otherwise it validates the explicit selection. Every card freezes the
supported agent, concrete model, reasoning value and selection source; null agents
cannot reach Create. Create revalidates support but never reapplies defaults, and
verifies saved assignment/resource values. Each objective has explicit acceptance
criteria, evidence ids, resource key and order; missions carry stable dependency
keys. The acting profile is the frozen responsible person, resolved to the correct
membership in every workspace at Create.

Create explicitly selects a Draft status even when the project's default is Next.
Only the first objective is Draft and the rest are Future, following existing
mission semantics. `autoAdvance` is false; no run queue entries or execution
requests are written. Mission and objective provenance is `agent` /
`overlord-assistant`; missions carry `created_from_chat_thread_id`.

Dependencies conservatively inherit the conversation's authorized sources and
include destination project metadata, even when project ids came directly from the
user. Revoked/unknown access hides the whole card and transcript block, projects old
replay events as `content.invalidated`, and prevents Create. Source rechecks run
before domain writes, and the transaction verifies the authorization revision and
immutable dependency set. Local destinations, memberships, roles, resources, catalog
and status are rechecked/locked for creation.

Cancel cannot publish a preparation that lost its lease. A revision already
published remains creatable after cancellation. Tests cover both outcomes.

## Verification

Node 24.13.0 was used to match the installed SQLite native addon. Test databases,
Postgres schemas, Overlord homes and HTTP listeners were isolated.

```sh
PATH=/Users/jake/.nvm/versions/node/v24.13.0/bin:$PATH TMPDIR=/tmp \
  node scripts/with-test-db.mjs node --import tsx --test --test-concurrency=1 \
  packages/core/service/chat/proposals.postgres-conformance.test.ts \
  packages/core/service/chat/chat.postgres-conformance.test.ts \
  backend/chat/gemini-runtime.postgres-conformance.test.ts backend/chat.test.ts \
  packages/core/service/missions.create.test.ts \
  packages/core/service/missions.launch-default.test.ts
```

- 117/117 focused tests, with proposal, runtime and durable-conversation cases on
  both SQLite and real pooled Postgres.
- Core regression suite: 598/598. Backend regression suite: 589/589.
- Core typecheck clean. Backend typecheck reports only the two existing
  `backend/execution/runner-claim-http.test.ts` ClaimResponse fixture errors.
- Changed implementation/test files lint clean. Backend index has its existing ten
  warnings, with no errors. Workspace scoping, conformance-version checks and
  `git diff --check` pass.
- The proposal suite is included in `yarn test:conformance`.

After the final catalog projection, the proposal and Gemini suites were rerun on
both databases, including a sentinel launch command excluded from discovery and
receipt replay through a fresh service instance. Final result: 46/46 tests passed across SQLite and Postgres.

## Limits

- Provider behavior in these tests is scripted Gemini; Phase D did not run a live
  inference or deploy the backend. Earlier live Knowledgebase OAuth and hosted
  runner limitations remain as recorded by Phase C.
- External source authorization is a checked-at observation; an upstream revocation
  immediately after that observation cannot be atomically locked with Overlord's
  database. Subsequent rechecks invalidate affected conversation content.
- Every proposal displays a conservative audience warning. Exact audience comparison
  is not inferred from Knowledgebase membership data that the integration does not
  expose. Draft briefs retain evidence ids and declared dependencies; they do not
  implement cross-project dependency scheduling.
- Proposal widgets and Create are ready in the API, events and transcript blocks.
  Web/mobile rendering and notification dispatch remain the mission's later slices.
