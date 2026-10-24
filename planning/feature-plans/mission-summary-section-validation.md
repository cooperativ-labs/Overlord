# Mission summary validation — coo:1202.dj3d

Validated on 2026-10-24 against the implementation plan, including its overriding §11, in Overlord and OverlordMobile. The automated checks below pass after three runtime fixes. Visual acceptance is **incomplete**: browser control and Device Hub capture failed, so this report does not sign off the canvas comparison, 375 px layout, or iPhone/iPad interaction walks. Nothing was committed or deployed.

## Fixes made during validation

1. **A late worker attempt could overwrite an already published generation.** `publishMissionSummary` now rejects a generation already completed, in addition to rejecting a superseded requested generation. The dual-adapter tests exercise both fences and the publication/completion windows.
2. **A newer question could be acknowledged before it appeared.** The summary envelope and agent requests load separately. Web and mobile now wait until the envelope watermark is represented by displayed delivery or question evidence before starting the two-second acknowledgement period. Regression tests cover the missing/newly loaded question.
3. **Older suggestions and risks could lose their new-item dots.** Both clients previously dated these rows from the latest-per-objective evidence plus the capped delivery feed. An older current-run delivery could be absent from both. Contract **167** adds required `deliveredAt` to risks and both suggestion states. The backend projects the original timestamp; both clients use it directly. Tests include a suggestion whose source is superseded in evidence and older than 205 other deliveries. Shared client fixtures and the mobile manifest are updated.

The contract change affects the DTO package, backend read projection, web/mobile derivations, and shared fixtures. It adds no storage, worker payload, auth, automation, webhook, CLI, MCP, or agent-packet interface. Promoted suggestions remain compact and never show a dot. Connector conformance metadata was regenerated; plugin version remains **0.3.57**.

The CLI protocol guide now specifies the four required deferred-work fields and their bounds. `contract/protocol-commands.yaml` now records the deferred-work exception to advisory-field salvage; its previous wording incorrectly implied malformed deferred work could never reject delivery.

## Automated matrix

Counts overlap between the broad and focused runs; do not add them together.

| Check | Result | Evidence / limits |
|---|---|---|
| All TypeScript package typechecks, backend, CLI, webapp | PASS | `yarn typecheck`, rerun after contract 167 and the final test correction |
| Desktop typecheck | PASS | Separate Desktop check |
| Repository ESLint | PASS with warnings | Zero errors; final whole-tree run reports 270 warnings. Focused formatting/import warnings introduced here were corrected; unrelated warnings remain |
| Database suite | PASS, 2 skipped | 66 passed; the two PostgreSQL cases were subsequently covered in the full PostgreSQL conformance run |
| Core suite | PASS | 617 passed |
| Auth suite | PASS | 32 passed |
| Automations suite | PASS | Final run: 57 passed, including the new prompt fixtures |
| CLI suite | PASS, 9 skipped | 465 passed; nine environment-gated organization/protocol E2E cases skipped |
| Backend suite | PASS, 1 skipped | 721 passed; optional coalescing benchmark skipped |
| Webapp suite | PASS | Final contract-167 run: 388 passed |
| Desktop suite | PASS | 35 passed |
| Full SQLite + PostgreSQL conformance | PASS, 2 skipped | `yarn test:conformance`: 399 passed, two optional coalescing benchmarks skipped. Ran on disposable PostgreSQL 17 and SQLite |
| Final affected backend/core checks on contract 167 | PASS | 24 passed, zero skipped; includes both adapters, summary routes/projection, migrations, triggers, worker races/retries, delivery worker, reconciliation, and webhook envelope |
| Connector checks | PASS | Synchronized 0.3.57 versions, regenerated capability manifests, tool catalog, and Claude plugin validation; icon recommendation remains a warning |
| Conformance versions | PASS with stale-version notices | Main contract 167; connector manifests generated for 167; untouched extension/MCP/Desktop manifests may declare older validated versions |
| Mobile contract check | PASS | Manifest matches 167; 161 exported Swift contract types found |
| iPhone/iPad simulator build | PASS | Final generic iOS Simulator build, including app/extensions and previews, with `CODE_SIGNING_ALLOWED=NO` |
| Swift contract + derivation tests | PASS, host harness | 35 XCTest cases passed using copied production sources and shared fixtures in an isolated macOS Swift package. Only fixture bundle lookup was adapted in the temporary harness; this is **not** a simulator test pass |
| Full/focused Xcode simulator test runs | INCOMPLETE | Test app launch initially failed with `FBSOpenApplicationServiceErrorDomain` / `ProcessExited` / `RBSRequestErrorDomain`; serial retries stalled after build and were stopped |
| Whitespace checks | PASS | `git diff --check` in both checkouts |

The first aggregate `yarn test` stopped at a core test whose “plain temporary directory” was accidentally inside this Git checkout because the launch set `TMPDIR` under `.overlord/tmp`. A CLI test had the same cause. Both suites passed with `TMPDIR=/private/tmp`; no production change was made for that harness issue. Sandbox-only `tsx` socket failures were rerun with local IPC allowed. The full conformance run used Docker because the locally installed libpq tools did not include a usable PostgreSQL server.

## Acceptance coverage

| Plan requirement | Result | Coverage |
|---|---|---|
| Strict structured deferred-work cutover (§3.3) | PASS | Core delivery fixtures and deliver/record-work validation, stable IDs, field bounds, preserved eligible text; Swift rejects strings |
| Delivery compose trigger | PASS | Pending delivery presentation does not enqueue a summary; composed and deterministic fallback publication do |
| Question/choice trigger lifecycle | PASS | Open, resolve, cancel, release to terminal, timeout, and channel-close transitions on both adapters; replay is idempotent; permission/retry requests do not trigger. The existing expiry path releases to terminal rather than writing a separate expired state |
| Reopen and deferred-work decision triggers | PASS | Reopen excludes old-run evidence; promotion, reopen, and dismissal update projection/recompose |
| Generation races and crash/retry handling | PASS | Queued coalescing, superseded compose, duplicate publication rejection, trigger after publication/before completion, trigger after completion, rollback, retry exhaustion fallback, expired lease reclamation |
| Seen route | PASS | Monotonic writes, older displayed snapshot accepted without acknowledging newer evidence, future watermark rejected, per-user isolation, ineligible mission rejection |
| Evidence beyond 200 and truncation | PASS | Busy objective with 205 deliveries cannot hide quiet objective evidence; 203 source objectives produce bounded rows with pre-cap totals and explicit truncation |
| Suggestions and promoted rows | PASS | Current-run retention, compact promoted projection, no promoted dot, dismissal omission, and original timestamps independent of the feed cap |
| Historical migrations on both editions | PASS | Real migrations run against seeded historical delivery strings and resolutions. Old missions become ineligible; new missions eligible; other delivery facts preserved; search documents refreshed |
| Creation eligibility | PASS at service boundary | REST repository creation, Protocol create, prompt, record-work, inbox promotion, scheduled duplication. CLI/MCP dispatch delegates to those protocol operations; no separate live hosted MCP creation was performed |
| Prompt fixtures | PASS, injected model | Before/after operator-writing fixtures check both prompt rule sets, malformed-output fallback, and omission of deferred work from model input/output. No live-provider prose quality claim |
| Web states and interactions (§5.6) | PASS | Ineligible hidden, awaiting first delivery, first pending, updating with usable evidence, all-clear, expandable action, compact promoted suggestion, file expansion, frozen dots across an actual cache refetch |
| Web seen timing | PASS | Two-second delay, newer snapshot resets timer, unmount cancels timer, baseline persists and resets on next visit; question-load gate regression |
| Objective delivery trim (§3.3) | PARTIAL | Existing delivery-card tests verify objective/full variants, retained risks/tradeoffs/assumptions and full text, eligibility selection, and exact promotion text. A dedicated integrated ObjectiveEvidenceSections row-count walk was not completed |
| Swift derivations (§6.3) | PASS | Shared fixture outputs, section states, all preview states decode, route bodies, promotion text, reload mapping, watermark rules, and both new dot/acknowledgement regressions |
| Webhook payload and example | PASS | Full `mission.delivered` preserves normalized structured items and stable IDs; thin payload unchanged. Executed the actual example's `followUpTitles` function with a structured item and an empty envelope. No deployed webhook or live LLM call |
| Browser acceptance, including 375 px | SKIPPED / tooling blocked | Browser tab creation/navigation timed out. Native-browser fallback encountered concurrent user changes. No seeded-browser redelivery, promotion, realtime or width sign-off |
| iPhone simulator walk | PARTIAL / tooling blocked | Named iPhone 17 Pro booted; locally built preview installed and launched successfully. Device Hub was found (`com.apple.dt.Devices`), but its accessibility/screenshot calls returned empty state, `noWindowsAvailable`, or `timeoutReached`. No visual or round-trip sign-off |
| iPad and split-view walk | SKIPPED / tooling blocked | iPad Air simulator boot attempt timed out. Shared target compiles, but this does not verify regular-width/split-view behavior |
| Canvas comparison | SKIPPED | The artifact tool was unavailable and browser access to the specified Claude canvas did not succeed. Earlier-objective screenshots are not treated as a fresh acceptance walk |

## Surface drift review

Applied the repository drift-review skill to the changed mission-summary/deferred-work operations, using current source locations rather than the skill's retired `apps/web`/Supabase paths.

| Operation | REST / core | CLI | Hosted/local MCP | Connector / docs | Finding |
|---|---|---|---|---|---|
| Read operator summary | `GET /api/missions/:id/summary`; permission-scoped envelope | Absent | Absent | Operator-only exemption documented | Aligned |
| Acknowledge displayed evidence | `PUT /api/missions/:id/summary/seen`, required `{ watermark }` | Absent | Absent | Contract describes monotonic semantics | Aligned |
| Deliver structured work | Protocol deliver, strict deferred-work validation in core | `--payload-json` / `--payload-file` with `deliveryReport.agentReport` | `deferredWork` object array translated into the same payload | Four required fields/bounds and task wording | CLI guide and YAML exception fixed |
| Record completed work | Protocol record-work uses the same validation | Payload envelope | Delegates to record-work | Shared skill/reference carries structured objects | Aligned |
| Resolve/reopen suggestion | Existing delivery deferred-work resolution pair | No new summary command | No new summary tool | Web/mobile reuse existing operations | Aligned |
| Agent context | Existing shallow mission metadata and delivery context | load-context unchanged | Catalog exposes no generated mission summary | Agent docs explicitly exclude it | Aligned |

The existing core function named `getMissionSummary` returns shallow mission metadata and is unrelated to the generated operator summary. Its SQL and packet construction do not read `mission_summaries`. No new generated summary field was added to the agent packet, load-context, CLI, or MCP catalogs. The webhook full payload changes only through the previously specified structured deferred-work cutover, not through contract 167.

## Remaining release checks

Automated validation found and fixed the three regressions above. There is no remaining failing automated product test in the completed runs, but **visual acceptance remains open**. Before release, complete the specified eligible/ineligible browser walks (375 px, redelivery, promotion, updating/realtime) and the iPhone/iPad walks (split view, suggestion round-trip, unchanged delivery stack), comparing the three canvas boards. The direct ObjectiveEvidenceSections integration check and actual simulator test-suite completion also remain unverified.

Deploy backend/web and the mobile contract update together: mobile now requires the new timestamp fields. This work did not change live flags, secrets, migrations, deployment state, or project-link metadata.

Reproduction logs and the isolated Swift harness are under `/private/tmp/coo1202-validation/` on this machine. Key logs: `conformance-pg.log`, `focused-v167.log`, `webapp-v167.log`, `automations-final.log`, `core.log`, `cli-rerun.log`, `backend.log`, `typecheck-v167-final.log`, `lint-last.log`, `connectors-final.log`, `ios-build-v167.log`, and `swift-v167.log`.
