# Agent-authored mission summary release verification

Mission `coo:1260`, objective `coo:1260.630c`. Verification started 2026-11-15.
Contract impact: major, within the existing `172.3.0` → `173.0.0` mission change.
No additional contract increment, commit, production migration or deployment.

## Release verdict

Not yet cleared for production release. Automated verification and the real CLI/API
flow are recorded below, but the requested live web-panel check could not be completed:
the computer-use browser host was unavailable and native Vivaldi access failed with
`cgWindowNotFound`. Component tests are not a substitute for that visual check.
Migration timing is from copied synthetic realistic fixtures, not a production snapshot.
The release gate must still be run against the committed release candidate on release day.

## Code review

Reviewed the mission's storage/backfill, item lifecycle, summary baseline and writes,
worker publication guards, resolution permissions, CLI/MCP forwarding, web item controls,
contract changes, and the mobile consumer's source/manifest. This follows the code-review
skill's correctness, concurrency, security, efficiency, duplication, types, error handling,
maintenance, testing and consistency categories.

### High priority — fixed

`packages/core/service/protocol.ts`, `backend/mission-item-resolutions.ts` and
`packages/core/service/delivery-presentation.ts`: agent narrative delivery acquired the
summary row before item rows, while a person closing an item acquired the item before
requesting a summary compose. A controlled interleaving on real Postgres produced
`40P01: deadlock detected`, aborting one legitimate writer. Presentation reconciliation
used the same inverse order. The affected entry points now take the existing mission
row lock first, matching objective reopen. This also serializes the no-summary payload
and first-summary case, where there is no summary row to lock yet.

`backend/mission-summary-locking.postgres-conformance.test.ts` preserves the deterministic
interleaving: pause the operator before its mission/summary lock, let the agent take its
locks, and finish both writes. The test failed with a deadlock before the correction and
passes afterward. It runs against real Postgres, not SQLite's serialized transaction model.

### Medium priority — fixed

`contract/components.yaml` still said Protocol, CLI and MCP never expose the mission
summary, contradicting ADR 0060 and the shipped attach payload. It now describes the
attach/resume baseline, delivery write, operator-only seen marker and the enqueue guard.
The 173.0.0 changelog is completed with iOS and final verification corrections.

### Test reliability — fixed

`cli/test/pi-extension.test.ts` removed its temporary home while the extension's
fire-and-forget native-session cache was still creating directories/writing files. This
produced `ENOTEMPTY` in the full suite. The test now tracks and awaits those filesystem
promises before restoring the environment and removing its home; no delay or longer
timeout was added and the connector's behavior is unchanged.

### Other categories

No additional confirmed security or data-loss defect was found in the reviewed scope.
Item mutations retain mission authorization; agent close entries cannot change another
mission's rows; validation precedes delivery writes; conflicts roll back the whole delivery;
worker publication checks agent ownership under the summary lock. Reconciliation preserves
closed decisions and stable references. These findings are supported by focused and full
suite coverage, not a claim of exhaustive proof.

The summary read still loads current-run delivery evidence and pages all open items before
display caps. This preserves totals and display dedupe; production-scale performance was
not measured. No feature or unrelated refactor was added.

## Migration rehearsal

Seeded a pre-migration database with 50 independent copies of the shared lifecycle fixture,
then migrated a copy: SQLite backup API and Postgres `CREATE DATABASE ... TEMPLATE ...`.
The fixtures cover re-delivery, reopen, deleted deliveries, deleted objectives, composed and
malformed reports, deterministic-rule actions, promoted/dismissed suggestions and orphan
legacy resolutions. Expected open/resolved lists were captured from the old delivery JSON,
run boundaries and resolution rows before migration, independently of the item backfill.

| Edition | Missions | Deliveries | Item rows | Open/resolved rows | First migration | Second migration |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SQLite | 100 | 350 | 800 | 600 | 60.59 ms | 5.22 ms |
| Postgres | 100 | 350 | 800 | 600 | 149.80 ms | 39.77 ms |

Both editions: **no differing missions**; open risks, human actions, suggestions and matching
resolutions preserved; `human_action_resolutions`, `risks_json` and `suggestions_json` absent;
a second migration left every item row, id, timestamp and revision unchanged. Orphan legacy
resolution rows have no item and are intentionally not copied. Postgres ran in a disposable
local Docker server. Timings measure this fixture upgrade only, not production downtime.
The permanent migration regression coverage is in `database/src/mission-items-migration.test.ts`
and `database/src/mission-items.postgres-conformance.test.ts`.

## Real CLI and local stack

Built `cli/bin/ovld.mjs` → `cli/dist/index.js`, started the real Express app against an isolated
SQLite database and used a fresh test-only user token. CLI calls ran from an isolated checkout
with the parent launch's mission/objective/execution-request identifiers removed.

Verified: attach baseline at revision 0; an older delivery payload creates a risk; two parallel
objectives attach to the same baseline; one delivers agent prose and closes the risk with a
reason; authenticated `GET /api/missions/:id/summary` immediately returns composed agent prose,
provenance and the closed item; the stale parallel delivery prints `mission_summary_conflict`
and revision 1; SQL confirms it wrote no delivery; retrying that session without `missionSummary`
succeeds. The dedicated backend suite also verifies fallback prose after an older payload and
that late workers cannot overwrite the newest agent narrative.

Live browser check: unavailable as described above. The web component and derive tests cover
provenance, resolved items, close/restore and refresh behavior. Prior iOS objective evidence
records native builds, focused tests and simulator screenshots; this objective inspected the
current mobile source/manifest and does not claim a fresh native build or physical-device test.

## Contract and module audit

The scoped contract diff contains one major increment (`172.3.0` to `173.0.0`), one current
changelog entry, ADR 0060 and an explicit amendment link on ADR 0046. The historical ADR's
original text remains historical; the current component registry contradiction was corrected.
OpenAPI's final version is 4.4.0. Generated schemas and manifest versions are checked below.
The mobile consumer manifest explicitly targets 173.0.0.

Every module in the plan's impact table is represented: contract, database, core, backend,
automations, CLI, MCP, connectors, web/desktop, mobile and docs. Desktop uses the same React
components. No new auth grant, runner feature or webhook envelope was required. Additional
implementation details beyond the table are the shared strict report reader in
`@overlord/contract/delivery-report`, project-move repointing, and the mission-first lock correction.
The shipped contract makes **every narrative publication**, including fallback, advance the
content revision; the plan's section 3.4 says only agent writes do. The implementation follows
the shipped contract and avoids accepting an attach baseline older than a fallback rewrite.
The shipped DTO also includes resolved promotion outcomes, and human-action identity includes
preserved provenance so rewording by the delivery composer does not lose a closure.

## Validation commands and results

All commands ran at the repository root. Full MCP tests live in `backend/mcp.test.ts`
and ran with the full backend suite; there is no separate MCP package test command.
Socket-using commands needed execution outside the filesystem sandbox. For final core/CLI
runs, `TMPDIR`, `TMP` and `TEMP` were `/private/tmp` so fixtures that must be outside Git
were actually outside the checkout.

| Command | Result |
| --- | --- |
| `yarn contract:check` | Pass |
| `yarn contract:test` | 150 passed |
| `yarn api:generate:check` | Pass |
| `yarn check:conformance-versions` | Pass |
| `yarn contract:parity` | Pass |
| `yarn typecheck` | Pass after the concurrency fix |
| `yarn typecheck:cli` | Pass after the PI test correction |
| `yarn lint` | Pass, zero errors; existing warnings remain |
| `yarn test:database` | 81 passed, 2 Postgres-only suites skipped here and covered by conformance |
| `yarn test:core` | 671 passed |
| `yarn test:backend` | 885 passed, 3 skipped: opt-in coalescing eval, PG-only new regression, SQLite concurrency variant |
| `yarn test:cli` | 473 passed, 9 opt-in onboarding/protocol e2e tests skipped; separate real CLI flow above |
| `yarn test:automations` | 110 passed |
| `yarn test:webapp` | 441 passed |
| `yarn connectors:check` | Pass: versions, generated capabilities/catalog, Claude plugin |
| `yarn test:conformance` | 471 passed, 3 intentional skips (two opt-in coalescing evaluations and the SQLite-only concurrency skip); real Docker Postgres, 362.25 seconds |
| `node scripts/with-test-db.mjs node scripts/with-ovld-home.mjs node --import tsx --test backend/mission-summary-locking.postgres-conformance.test.ts` | 1 passed on real Postgres after correction; failed with 40P01 before |
| `node --import tsx --test cli/test/pi-extension.test.ts` | 1 passed after deterministic teardown |
| `node scripts/with-ovld-home.mjs node --import tsx --test cli/test/change-ledger-cross-process.test.ts` | 4 passed on isolated recheck |
| scoped `eslint --fix` and `git diff --check` | Pass on files edited by this objective |

Earlier attempts are not hidden: sandbox socket/tsx IPC failures were environmental; tests
assuming a non-Git temp directory failed under the launch's in-repo TMPDIR and passed with
`/private/tmp`. One earlier full CLI run missed a seed synchronization mark in the unrelated
cross-process ledger test; its isolated recheck and the final full CLI suite passed without a
ledger change. The underlying cause of that intermittent assertion was not established.
A later full CLI attempt exposed the separate PI cache teardown race fixed above. Initial
real-CLI setup also needed rebuilding after the concurrent CLI test build and removal of
inherited execution-request identity; the completed flow used the isolated backend only.

The first complete real-Postgres conformance run passed 470 tests with 3 intentional skips.
The final run passed 471 tests and includes the new locking regression. No Postgres battery was silently substituted with SQLite.

No new PM decision is required for this objective. The live browser gap is verification work,
not an unresolved product choice. The previously reported iOS native evidence is retained
as prior-objective evidence only.

## Release-day actions

1. Back up the production database before deploying. Verify the backup is restorable; the
   backfill/drop sequence is one-way and an application rollback alone cannot recover the
   retired storage. Repeat the rehearsal on that production-data copy if production-volume
   timing/data-shape evidence is required.
2. Once the release candidate is committed and the tree is clean, run
   `yarn release:preflight major`. Do not bypass the gate. This verification session intentionally
   did not commit, so it did not produce a release stamp.
3. Follow the mission rollout order: backend deployment (migrations and backfill), then CLI and
   connector publication, then web, then iOS. Use the supported gated release commands in
   `contract/releases/README.md`; verify summary reads and an agent delivery after deployment.
   Production state has not been inspected or changed by this objective.
