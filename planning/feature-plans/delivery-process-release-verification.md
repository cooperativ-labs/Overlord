# Delivery process — release verification (phase 5)

coo:1297.c47x, 2026-11-18. Verifies phases 1–4 of [delivery-process-research.md](delivery-process-research.md) (incorporating review R1–R4 of [delivery-process-review.md](delivery-process-review.md)) and prepares the gated rollout.

**Contract impact: none.** This objective added only release evidence, a cutover rehearsal harness and three re-baselined database test fixtures. No interface, invariant, data meaning or runtime behavior changed. The release range itself is **major** (contract `174.2.0` at the `production` tag → `176.1.0` in the working tree).

## 1. Verdict: release BLOCKED

Verification found no product defect in the implemented delivery workflow. The release is still blocked on release-process work that only a human can do:

| # | Blocker | Why it blocks | Clears when |
| --- | --- | --- | --- |
| B1 | **No immutable candidate SHA.** All phase 1–4 work is uncommitted on `main` (`HEAD` = `production` = `70ad1a06`, 149 dirty paths). The tree also contains unrelated work, e.g. ADR 0077 (newest mission terminal) and other missions' changes. | The release gate (CONTRACT.md §5) releases only a committed SHA with a clean tree. Nothing verified here is bound to a SHA. | A reviewed commit (or merge) contains exactly the intended scope. Re-run section 3 on that SHA and record it in section 7. |
| B2 | **Major contract increment needs owner approval.** The range adds three major/minor steps (175.0.0, 176.0.0, …). | CONTRACT.md §7: each later major increment is an explicit product and compatibility decision requiring the owner's approval. | The owner approves 176.x, and `yarn release:preflight major` passes on the candidate. |
| B3 | **No restored-production rehearsal.** The cutover was rehearsed on production-schema databases with synthetic pre-cutover data (section 4), not on a restored production copy. | Required by ADR 0076 ("against a restored copy first, then production") and the plan §6.1. | Section 4 has been run against a restore of the production Postgres, with the step 1/3/4 outputs recorded. |
| B4 | **Rendered-surface smoke not performed.** No live browser, Electron window or physical iOS device was exercised (see section 5). | Plan §9.1 requires browser/Electron rendering and the checklist must distinguish device evidence. | Section 8 step 9 has been performed on the candidate build. |

No code fix is outstanding. When B1–B4 are cleared and nothing regresses on the candidate SHA, the release may proceed through section 8.

## 2. What was verified, and how

Evidence classes: **A** = automated test/check on this working tree (macOS, Node 24.13.0); **R** = rehearsal on a disposable database; **D** = device or rendered UI; **P** = production. Nothing in this report is class D or P.

### 2.1 Checks and suites (class A)

| Check | Result |
| --- | --- |
| `yarn contract:check`, `contract:test`, `api:generate:check`, `check:conformance-versions`, `check:workspace-scoping`, `connectors:check`, `contract:parity` | All pass. `contract:test` now passes the three version-contract cases recorded earlier as failing. |
| Typecheck: core, CLI, backend, webapp, automations, desktop | All pass |
| `yarn lint` | 0 errors (235 pre-existing warnings) |
| `test:database` | 83 tests; 3 stale fixtures fixed here (section 6), now 0 failures |
| `test:core` (SQLite) | 728/729; the one failure (`repository-read-git: is not a repository for a plain directory`) passes 21/21 with `TMPDIR` outside the checkout. It is an artifact of this agent session's `TMPDIR`, which sits inside the git repo. |
| `test:automations` | 107/107 |
| `test:cli` | 489 pass, 9 skipped, 2 failures that pass 15/15 when rerun with a short `TMPDIR` outside the checkout (same session artifact; the cross-process barrier timed out under parallel load) |
| `test:backend` (SQLite; validates every response against OpenAPI) | 964 pass, 7 skipped, 0 fail. The earlier "preserves agent prose through triggers and queued worker publication" failure no longer occurs. |
| `test:webapp` | 625/625 |
| `test:desktop` | 35/35 |
| Real Postgres 17 conformance (`test:conformance` set, serial) | 514 pass, 0 fail, 4 skipped (two benchmarks, plus two SQLite-only skips of Postgres-only race tests, which ran and passed on Postgres). This also re-verifies the chat/connection files that previously hung under a concurrent run. |
| iOS: `check-contract-conformance.mjs`, `node --test scripts/*.test.mjs` | Pass |
| iOS: `xcodebuild test` (Overlord scheme, simulator) | 996/997. `MissionComposerDockPresentationTests.testDockAndUndockKeepTextCaretAndFocus` failed under full parallel load and passed 3/3 twice in isolation (timing-sensitive, unrelated to delivery). |

### 2.2 Section 9.1 journeys → evidence (class A unless noted)

| Journey | Evidence (passing) |
| --- | --- |
| Same operation before/after session end, lost response, differing body, revoked access, old receipt-less delivered session, concurrent deliver/deliver and deliver/update; one delivery/report/transition/seal/side-effect identity | core `protocol.finalization` and backend `protocol-finalization` / `delivery-finalization` (both adapters): "replays lost responses, refuses changed bodies and finalizes a session once", "replays the same operation after the session ended without writing anything again", "refuses the same operation id with a different request body", "rechecks current access on replay and on receipt reads", "a historical delivered session without a receipt still counts as accepted", "concurrent retries of the same operation return one delivery", "serializes concurrent deliveries of one session under the mission lock", "never finalizes one session twice", "a rejected request creates no receipt and leaves the session deliverable", "receipts are immutable after insertion" |
| Record-work retry/legacy behavior, no fabricated session, no foreign closes | "a retried operation returns the same mission and delivery", "concurrent same-operation record-work creates one mission" / "serializes … on the receipt" (Postgres), "a failed record-work rolls back its mission creation entirely", "intentionally identical work under distinct ids, or legacy calls without ids, stays separate", "a record-work opportunity is bound to its member without a session" |
| **R1** parallel A/B, A prose-free | "a prose-free parallel delivery makes the other agent prose stale by evidence, not content", "record-work keeps its new-mission exception and needs no base"; the legacy missing-base case is covered by the withheld-reason `missing_evidence_base` paths |
| Elapsed time, supersession, replay, changed second text, publication vs delivery race | "publishes after an arbitrary elapsed time, replays its receipt, and refuses a second text", "a newer delivery, a follow-up or a reopen supersedes the opportunity", "a stale base consumes nothing and returns the current baseline", "a publication racing a newer delivery serializes on the mission lock" (Postgres) |
| Absent/legacy/pending/ineligible prose, no generator | "an ineligible mission gets no publication opportunity", web fixture narratives (absent, current, legacy agent, legacy model, outdated, deleted source, older server), iOS `MissionNarrativeFreshnessTests` (12), plus the cutover rehearsal (section 4, class R) |
| No trigger enqueues narrative; cancellation and drain; unrelated workers continue | "questions, item decisions and presentation never touch the narrative; a reopen advances it", "fences out automatic jobs and non-agent narrative writes from older replicas" (both adapters), `delivery-compose-worker` tests, and section 4 (production-SHA worker code replayed, class R) |
| **R3** draft A/B/A replay incl. after seal, CAS, withdrawal, merge/limits, import, deliver race, sealed immutability, item identities | "A commits with a lost response, B edits, replaying A returns A without overwriting B", "A/B/A replay, concurrent batches, seal, revocation and immutability" (`report-draft` Postgres conformance), "records, replays, inspects, seals and projects draft evidence", "only the owning member writes the draft; record-work stays sessionless" |
| **R2** watermark / seen coverage | Shared vectors `contract/mission-summary-derive-fixtures.json` `seenCoverage` (12 cases, including "a newer visible narrative does not clear older hidden actions", "newer visible actions do not clear an older hidden narrative", "a remount or cold read starts with no coverage", same-millisecond change) executed by web and iOS; "narrative changes strictly advance the watermark and bound the seen marker" (both adapters); iOS `testHiddenEvidenceStaysUnreadAcrossRemountUntilEveryTabIsDisplayed`. Rendered browser/Electron behavior is **not** verified (B4). |
| RBAC, credentials, isolation, sessionless publication | backend finalization/report-draft HTTP suites (token scopes, cross-workspace ids, revocation) and Postgres conformance. Membership revocation still relies on backend authentication (open risk, unchanged). |
| **R4** CLI envelopes and persisted retry id; local/hosted MCP accepted-with-unpublished-prose; catalogs/help/versions | CLI `operation-attempts` ("an unavailable attempt store requires an explicit id for record-work only", "accepted identical record-work needs an explicit retry or new operation") and `protocol-report-draft`; backend `mcp.test.ts` ("MCP finalization tools carry only a caller-retained operationId (ADR 0075)", "… narrow narrative tools … (ADR 0076)", "… draft evidence tools … never mint one (ADR 0078)"); `connectors:check` |
| Retained report formatting, item identities, unrelated workers | `delivery-presentation` conformance (both adapters), `delivery-compose-worker` tests, section 4 step 5 |

### 2.3 coo:1278 actual state

Live read: `coo:1278.rbag` complete; `pyw6`, `9zqn`, `agbz`, `kst1` and `g0h3` are all **draft**. In source, no backend/contract surface has `itemsWatermark`, cross-mission closes or `project-items`. Web `mission-summary-derive.ts` and iOS `MissionSummaryDerive.swift` accept an optional `itemsWatermark` that counts only when its group is rendered (fixture cases "an items watermark counts only with its rendered group" / "a covered items group joins the combined maximum"). These hooks are inert until a server sends it. Combined locking: every close is still own-mission, so no multi-mission lock order exists yet; that test obligation (plan §10) moves to pyw6. Closure and seen semantics in this release are therefore coo:1297's alone.

## 3. Reproducing section 2.1 on the candidate SHA

```sh
yarn contract:build:prod && yarn db:build:prod && yarn auth:build:prod && yarn automations:build:prod && yarn core:build:prod
yarn contract:check && yarn contract:test && yarn api:generate:check && yarn check:conformance-versions \
  && yarn check:workspace-scoping && yarn connectors:check && yarn contract:parity && yarn lint
yarn typecheck:core && yarn typecheck:cli && yarn typecheck:backend && yarn typecheck:webapp \
  && yarn typecheck:automations && yarn desktop:typecheck
# Use a TMPDIR outside the checkout, and run the Postgres set serially and alone.
yarn test:database && yarn test:core && yarn test:automations && yarn test:cli && yarn test:backend \
  && yarn test:webapp && yarn test:desktop
yarn test:conformance
# OverlordMobile (OVERLORD_ROOT=<this repo>):
node scripts/check-contract-conformance.mjs && node --test scripts/*.test.mjs
xcodebuild test -project Overlord.xcodeproj -scheme Overlord -destination '<simulator>'
```

## 4. Cutover rehearsal (class R)

The cutover mechanism is the database-enforced fence from migration `20261118140000_agent_only_mission_narrative` (ADR 0076), combined with a conservative stop/drain. The harness [`delivery-process-release/cutover-rehearsal.ts.txt`](delivery-process-release/cutover-rehearsal.ts.txt) does the following:

1. Builds a database at the **production schema** (all migrations before `20261118120000`) through the production migrator (`stopBeforeVersion`).
2. Seeds pre-cutover state: an empty `pending` shell, Gemini, agent and deterministic-fallback prose, queued, running (live lease) and running (stale lease) compose jobs, failed/succeeded history, plus queued delivery-presentation and objective-brief jobs.
3. Applies the three new migrations the way a Local upgrade or Cloud deploy does, then re-runs the migrator.
4. Loads `packages/core/service/worker-jobs.ts` **verbatim from the `production` tag** and replays it as an old replica would: an in-flight pass finishing (publish → complete → retry/finish), the production publication `UPDATE` with its generation guard satisfied, delivery triggers, direct successor enqueue, and the stale-lease poller.

Results (SQLite file DB = Local upgrade; Postgres 17 = Cloud): **15/15 checks pass on both.**

| Check | Result |
| --- | --- |
| Migrations applied; re-run is a no-op | ✔ |
| Queued and running (live and stale) compose jobs → `cancelled`, leases cleared, `last_error` "retired…" | ✔; backlog before `failed 1, queued 1, running 2, succeeded 1`, after `cancelled 3, failed 1, succeeded 1` |
| Audit rows kept; failed/succeeded history, delivery and brief jobs byte-identical | ✔ |
| No `pending` summaries; empty shell → non-pending absent row | ✔ |
| Source deliveries/reports byte-identical | ✔ |
| Historical Gemini/agent/fallback prose and provenance kept verbatim; no coverage basis (legacy) | ✔ |
| Old in-flight worker: publish → `stale`, complete → no successor, retry/finish cannot revive the cancelled job | ✔ |
| Production publication `UPDATE` (gemini and deterministic) dropped by the fence even when its guard passes | ✔ |
| Old replica's delivery trigger and direct successor enqueue leave no queued/running compose job and no pending shell | ✔ (`triggered: false`) |
| Old poller cannot reclaim or claim a compose job | ✔ |
| Delivery-presentation and objective-brief jobs still claim and finish through the old code | ✔ |
| New agent publication writes; an old replica's inline agent prose is kept but downgraded to legacy | ✔ |

So old queued and in-flight Cloud workers cannot publish or spawn successor narrative jobs once the migration commits, even if a replica overlaps. Local upgrades migrate at startup in one process and cancel the persisted backlog before any worker starts.

Run it (from the repository root, Node 24):

```sh
T=$(mktemp -d /tmp/ovld-cutover-XXXX); echo '{"type":"module"}' > $T/package.json
git show production:packages/core/service/worker-jobs.ts \
  | sed -E "s#from '\./(change-feed|context|util)\.js'#from '$PWD/packages/core/service/\1.ts'#" > $T/old-worker-jobs.ts
cp planning/feature-plans/delivery-process-release/cutover-rehearsal.ts.txt $T/cutover-rehearsal.ts
OLD_WORKER_JOBS=$T/old-worker-jobs.ts node --import tsx $T/cutover-rehearsal.ts sqlite
OLD_WORKER_JOBS=$T/old-worker-jobs.ts TEST_DATABASE_URL=<postgres url> node --import tsx $T/cutover-rehearsal.ts postgres
```

The operator check [`delivery-process-release/fence-check.sql`](delivery-process-release/fence-check.sql) (ADR 0076 steps 1, 3 and 4) was validated against a fully migrated Postgres schema. It reports the three migrations, 0 pending summaries, `fence_job_rows_expect_0 = 0` and `fence_headline_rows_expect_0 = 0`, and its transaction leaves no rows behind. Every write in it is rolled back.

Not rehearsed: a restore of real production data (B3). The local dev SQLite database was empty and already partly migrated, so it is not useful as restored-data evidence.

## 5. Not verified here

- Live browser and Electron rendering of narrative/draft states, and real-time refresh (B4). Desktop evidence is typecheck, shell tests and the shared web bundle tests only.
- A physical iOS device or TestFlight build; iOS evidence is simulator XCTest only.
- A live CLI → HTTP backend journey. Backend HTTP behavior is covered by the route suites; CLI behavior by its suite with a mocked transport. The CLI e2e harness was not run because it writes `overlord.toml` into the shared checkout.
- Production publication observability/metrics and any production rates (plan Appendix A.3 measurement design is still unexecuted).
- Anything deployed. No deploy, migration or publish was performed.

## 6. Changes made in this objective

- `database/src/mission-items-migration.test.ts`, `database/src/mission-summaries-migration.test.ts`: three fixtures that predated ADR 0076 now expect the narrative columns and the legacy backfill, and assert that the fence drops a `pending` shell. Test-only; closes the c6h4 risk.
- `planning/feature-plans/delivery-process-release/`: the rehearsal harness and operator SQL above.

## 7. Candidate record (to fill in on the candidate)

| Field | Value |
| --- | --- |
| Candidate SHA | _pending B1_ |
| `contract/VERSION` / OpenAPI `info.version` | 176.1.0 / _record_ |
| `yarn release:preflight major` output | _pending_ |
| Section 3 rerun on candidate | _pending_ |
| Restored-copy rehearsal (section 4 + `fence-check.sql`) | _pending B3_ |
| Owner approval of major range | _pending B2_ |

## 8. Gated rollout checklist (for the candidate SHA)

Order: backend/storage before CLI/MCP/connectors, then web/desktop/mobile (plan §10). Phases 2 and 3 ship together.

1. **Assemble the candidate.** Commit exactly the coo:1297 scope plus anything intentionally bundled, and separate unrelated work. Run `yarn desktop:package:prod`; it rebuilds the tracked `backend/dist-server/index.cjs`. Confirm `grep -c 'mission-summary-compose-worker' backend/dist-server/index.cjs` is `0` and the bundle contains `delivery_summary_publications`. Commit the bundle. The committed bundle is currently the production build, which still contains the composer.
2. **Re-run section 3** on the clean candidate; record results in section 7.
3. **Owner approval** of the major range (B2). Then `yarn release:preflight major`.
4. **Backups:** take and verify a production Postgres backup immediately before cutover.
5. **Restored-copy rehearsal (B3):** restore that backup to a disposable database; run `fence-check.sql` (step 1 backlog), apply migrations to the copy only with `yarn db:build:prod && DATABASE_URL=<copy url> node --import tsx scripts/migrate-postgres.ts` (not `yarn db:migrate:postgres`, which loads the production env), run from a directory whose `overlord.toml` sets no `database_url`, and confirm the printed `applying migrations to` target is the copy; then run `fence-check.sql` again. Expect no queued/running compose jobs, 0 pending, both fence counts 0. Spot-check that summary prose and deliveries row counts are unchanged.
6. **Cloud cutover:** record the compose backlog (`fence-check.sql` first query). Stop or drain all old `overlord-backend` replicas (no overlapping rolling deploy). Run `yarn server:deploy`; the new build applies `20261118120000`, `20261118140000` and `20261118160000` in order at startup. Then run `fence-check.sql` against production.
7. **Post-deploy smoke (production, class P):** one delivery without prose returns `missionSummary.publication.available: true` and enqueues no compose job; `delivery-summary-context` then `publish-delivery-summary` publishes once; replaying the same operation id returns `"replayed": true`.
8. **Publish clients:** `yarn cli:publish` (new CLI/MCP shim), connector packages per the connector-versions skill, then `yarn desktop:publish`. Local edition users migrate at the new server's startup (single process; the fence makes a stale Local process harmless).
9. **Rendered smoke (B4, class D):** on the web app (preview from `main`, then production), Electron and an iOS TestFlight build, check one mission per narrative state (absent, current, outdated, legacy) and draft evidence (recording/sealed). Confirm that the seen dot clears only after every tab group is displayed, and stays after a remount when a group was hidden.
10. **`yarn release:finish`** (moves `production`, fast-forwards `prod`, ships the web app). Record the SHA and outputs in section 7.

**Rollback.** Do not roll back the migrations: there is no down migration, and doing so without a reviewed compatible build is unsupported (ADR 0076). Rolling back application code to the previous build is safe for narrative integrity while the fence stays installed: old composer jobs and non-agent writes are dropped, and old deliveries still commit. However, a rolled-back backend serves clients without `publish-delivery-summary`/`report-draft`/receipts, so new CLIs get explicit capability errors. Restoring the pre-cutover backup loses every delivery accepted after cutover; use it only for data corruption, after exporting post-cutover `deliveries`, `delivery_finalizations` and `delivery_summary_publications`.

**Human-only release actions:** B1–B4; apply the three migrations to production (open blocking items); production backup/restore; Railway replica stop/drain; npm/desktop/TestFlight publishing; owner approval.
