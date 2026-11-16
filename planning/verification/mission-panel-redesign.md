# Mission panel redesign verification

Objective: `coo:1281.8xx9`, 2026-11-16. Scope: [implementation plan §14](../feature-plans/mission-panel-redesign.md#14-tests-and-verification).

Contract impact: none. These fixes enforce the existing paging, editing, evidence and responsive-layout requirements. The opaque request cursor now preserves PostgreSQL timestamp precision; its public response shape, authorization, scope and legacy unpaged behavior are unchanged. No schema, contract version or generated API changes are needed.

## Result

The integrated implementation was exercised with the full web/backend suites, SQLite/PostgreSQL conformance, Chrome and the actual Electron shell. The pass found and fixed the defects below. This is local verification with synthetic UI transport, not deployment evidence. Physical touch, software-keyboard/safe-area behavior and real Latch/agent operations remain unverified. Those limits must not be read as passed acceptance cases.

## Defects fixed

1. **Typing during a save could escape the navigation/Run flush.** A finishing edit now saves text entered while its own request was pending before reporting success. The new asynchronous regression failed before the fix and passes after it.
2. **A partial request refresh could erase known blocking questions.** The shared mission/detail query conservatively retains previously known requests through partial/legacy/bounded reads. A complete read remains authoritative and can clear them. A regression exercises two simultaneous consumers, a complete read, a partial refresh and a subsequent complete empty read; it failed before the fix.
3. **Unknown attachments/history could authorize empty-draft deletion.** Pruning now requires successful settled attachment and delivery reads, no attachment upload, no truncated delivery history, and settled file-history reads when the objective has started. A failed attachment read retains the draft and its edit instead of sending DELETE.
4. **Seen tracking initially treated unobserved or barely intersecting content as visible.** With IntersectionObserver available, acknowledgement waits for its first observation and requires at least 25% intersection. The new regression covers no observation, 1%, 25% and 10% visibility.
5. **Markdown summaries did not reliably clamp in Chromium.** Nested Markdown blocks bypassed the three-line clamp. A three-line-height maximum bounds the collapsed content, and ResizeObserver remeasures overflow as its size changes. Chrome showed the bounded paragraph and Show more control at narrow width after the fix.
6. **Secondary mobile detail buttons were smaller than the required touch target.** The mobile detail enforces a minimum 44px width and height for its descendant buttons, including edit, summary and attachment controls. The 767px screenshot shows the enlarged controls; desktop layout retains its compact controls.
7. **PostgreSQL microseconds could prevent paging from advancing.** A new database-backed regression reproduced a page returning `precision-a` again instead of `precision-b`. PostgreSQL now selects a UTC text cursor key at native microsecond precision, avoiding JavaScript Date truncation. Millisecond cursors remain accepted. SQLite retains its contract-required millisecond timestamps. The complete paging battery passes in both editions.
8. **Parallel backend tests could race while opening the ambient SQLite schema.** The catalog test now isolates its module-import database before dynamically importing both catalog and chat engine. The pagination battery also isolates its ambient import database. The full backend rerun passed after the original `table "user" already exists` failure.

## Automated evidence

Runtime: repository-pinned Node 26 (`v26.13.1`), installed better-sqlite3 13.0.3, Yarn 4.18.1. Older Node 24 guidance did not match this checkout. Commands requiring listeners or Docker ran with permitted local access and `TMPDIR=/private/tmp`.

| Check                                                   | Observed result                                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn test:webapp`                                      | 527 passed, zero failed, zero skipped; includes four new UI/data regressions.                                                                                                                        |
| `yarn test:backend`                                     | Final integrated run: 919 passed, three skipped, zero failed across 922 tests; response conformance checked 460 responses across 144 of 271 operations and observed eight invalid requests.          |
| `OVERLORD_TEST_DB_BACKEND=docker yarn test:conformance` | 471 passed, three skipped, zero failed across 474 tests. Both database editions ran. This complete run preceded the final cursor-precision regression/fix; the affected battery was rerun afterward. |
| Final paging battery through `scripts/with-test-db.mjs` | 24 passed, zero skipped, zero failed: 12 each for SQLite and PostgreSQL, including native timestamp precision.                                                                                       |
| `yarn contract:parity`                                  | Five passed.                                                                                                                                                                                         |
| `yarn webapp:build:prod`                                | Passed after the UI fixes, including mobile target sizing.                                                                                                                                           |
| `yarn check`                                            | Passed (exit 0). Backend 919 passed / 3 skipped; web 527 passed; desktop 35 passed. No failed tests in any stage.                                                                                    |

`yarn check` includes lint, contract validation/tests, generated API freshness, workspace scoping, conformance versions, connector validation, all workspace typechecks, and database/core/auth/automations/CLI/backend/web/desktop tests. The completed run also passed 150 contract tests, 81 database tests, 671 core tests, 32 auth tests, 110 automation tests and 478 CLI tests. The full lint stage reported zero errors and 232 warnings. The one new import-order warning in the moved pagination test was corrected, and focused lint on every changed TypeScript file then passed without output. Remaining warnings are outside these changes.

The complete conformance run's three skips were the two opt-in chat coalescing benchmark cases (`CHAT_COALESCING_EVAL`) and the concurrent-writer case intentionally omitted for SQLite because SQLite serializes writes. Default `yarn check` also omits PostgreSQL-only cases without `TEST_DATABASE_URL` and nine credentialed CLI integration cases. The separate Docker conformance run supplies database-edition evidence; it does not turn credentialed CLI skips into passes.

Relevant coverage owners retained and run:

| Behavior                                                                                                                                                        | Coverage                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Old open question behind 205 closed requests; multi-page/tied ordering; arrival/resolution; pending-delivery choice; scope/authorization; unchanged legacy read | `backend/agent-request-paging.postgres-conformance.test.ts` (replaces the SQLite-only filename) |
| Complete/partial/error/retry, answer invalidation, shared cache consistency                                                                                     | `webapp/web/lib/open-agent-requests.test.tsx`                                                   |
| Mission/account dismissal persistence, authoritative-only pruning, storage failure, new request IDs                                                             | `dismissed-agent-requests.test.ts`, `MissionBlockingQuestions.test.tsx`                         |
| Foreground delay, snapshot changes, hidden/occluded/uncovered evidence, unopened tabs                                                                           | `use-mission-summary-seen.test.tsx`, `MissionOverviewCard.test.tsx`                             |
| Save buffers, failed save, summary revision conflicts/realtime updates, attachment-aware pruning                                                                | `objective-edit-buffers.test.ts`, `ObjectiveDetail.test.tsx`, `objective-summary.test.tsx`      |
| Display IDs/UUIDs, direct/local close, replacement navigation, desktop query preservation, feed links                                                           | `ObjectiveDetail.test.tsx`, `mission-panel-search.test.ts`, `MissionRunCard.test.tsx`           |
| Row states/controls, complete reorder sets, rollback, drag settings and click suppression                                                                       | `objectives/objective-rows.test.tsx`                                                            |
| Composer create/upload/failure behavior and Latch popover/confirmation state                                                                                    | `GhostObjective.test.tsx`, `MissionLatchChip.test.tsx`                                          |

These owners do not imply that every permutation in plan §14 has an independent test. In particular, DOM tests of drag sensors do not demonstrate actual touch gestures, and mocked launch/terminal mutations do not demonstrate execution-provider integration.

## Browser evidence

Used native computer control of Chrome, with the real MissionPanel, objective detail, router, query hooks and mutations. A temporary synthetic transport provided 19 objectives spanning draft/submitted, launching, executing/blocked, pending-delivery and complete states, plus summary evidence and a read-only question. No real mission, terminal or agent launch was mutated.

- Inspected the mission panel at 375px and 420px, in light and dark themes. At 375px the header's due-date, branch and close controls fit; this fixture had no Latch session.
- Confirmed full-screen detail at 375px and 640px and, after the touch-target fix, at 767px. At 768px it switches to the centered desktop dialog and metadata sidebar. The mobile header and bottom navigation remain visible without inherited translation/max-width clipping.
- Dismissed the top question notification and confirmed it remained in For you and the objective's blocking-question section. Dismissal survived reload; direct entry with dismissed notifications expanded the blocking question.
- Opened objective rows, summary/question links and a copied display-ID detail URL. Checked previous/next URL replacement and explicit direct-entry close. Rejected title writes preserved the text and error, and blocked Close and browser Back. Editor Escape cancelled the edit before dialog Escape closed it.
- Nested-menu Escape closed only the menu and returned focus to its trigger. Closing the detail returned focus to the objective row in the observed row-entry flow.
- Visited Objectives, For you, Risks, Suggested, Resolved and Files; arrow keys moved between linked tabs. The composer remained mounted through those views. Text entry and a tab switch were exercised, but the fixture did not implement a complete create-objective response, so this is not evidence of successful end-to-end composer creation.
- Scrolled to the last of 19 objective rows at 375px and observed the last row above the settled composer. A long-press/drag attempt did not produce a verified reorder; no touch-drag pass is claimed.

The first development fixture became unreliable after repeated hot reloads. The remaining checks used a fresh tab and a built static fixture. The isolated fixture sources were moved out of the application/lint tree into `.overlord/tmp/sessions/objective-coo-1281-8xx9-2a156f09-f6f9-426e-a71e-2b0320d4a112/browser-fixture/`. They are scratch verification material, not a new shipped route or maintained test suite.

## Native desktop evidence

Built `desktop/esbuild.mjs` and launched the actual Electron main process with isolated `userData` and `OVLD_HOME`, loading the built synthetic fixture. Its normal content security policy remained enabled. The development fixture initially failed because Vite's inline preamble did not match that policy; the production fixture resolved this without changing product security settings.

Observed mission rendering, draft-row entry, initial heading focus, nested objective menu, first Escape closing the menu, second Escape returning to the mission, and focus returning to the invoking row. This validates those interactions in the native window. It does not validate a packaged release, external desktop deep-link dispatch, authenticated backend connectivity, real Latch operations or real agent launch.

## Visual source and remaining acceptance limits

The linked Claude design canvas was accessible as a rendered canvas. Its three artboards (mission panel, desktop objective detail and mobile detail) were compared at overview scale with the implemented hierarchy, compact rows, tabbed overview and detail layouts. This was not a pixel-by-pixel comparison or inspection of the canvas's underlying design data.

The following plan §14 cases remain without a complete manual pass:

- Physical touch hold/drag, swipe-versus-drag, drop-click suppression and popup placement near screen edges. The available gesture attempt did not demonstrate a successful reorder.
- Physical mobile software keyboard and nonzero safe-area insets. Responsive device emulation is not evidence for those OS behaviors.
- Live/stopped Latch chip header sizing and real open/end/reconnect actions; real Run delivering the flushed instructions to an agent. Automated component/flush tests cover local behavior, not the provider round trip.
- Every row control in every state, expanded delivery content, a live feed route, all empty/ineligible summary states, and every short/long overview-content × tall-composer combination in a browser. Existing automated coverage was run, but the synthetic manual fixture did not exercise the full matrix.
- An independent screen-reader pass and packaged native release entry/return.

No new PM decision was needed. The isolated fixture server and Electron process were stopped after verification. Nothing was committed, published or deployed. The remaining interaction limits are recorded for review rather than silently marked complete.

## Reproduction evidence

Session logs are under `/tmp/coo1281-*.log`: `web-final`, `backend-final`, `pg-final`, `precision-before`, `precision-after`, `parity`, `build-final`, and `check-verified`. Earlier logs retain the deliberately failing regressions and resolved environment/test-fixture failures. These `/tmp` logs are session-local; the results and limitations above are the durable record.

Final targeted database command:

```sh
TMPDIR=/private/tmp OVERLORD_TEST_DB_BACKEND=docker \
  node scripts/with-test-db.mjs node scripts/with-ovld-home.mjs \
  node --import tsx --test backend/agent-request-paging.postgres-conformance.test.ts
```

Initial sandbox listener failures (`EPERM`), long TMPDIR Unix-socket failures (`EINVAL`), obsolete runtime selection and development-fixture CSP failures were environment/setup failures. They were resolved locally and are not counted as passing tests or product defects.

Native file capture reported shell activity and synchronization gaps. The known unsynchronized paths and both endpoints of the test-file move were reconciled with explicit objective-scoped path declarations; unrelated worktree files were not used as ownership evidence.
