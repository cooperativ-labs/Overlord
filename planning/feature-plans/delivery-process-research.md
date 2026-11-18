# Objective reporting and delivery — implementation plan

Review draft for coo:1297.1jfa, 2026-11-18. This document is the standalone implementation specification. No implementation, contract change, migration or deployment is authorized or performed by this document update.

**Contract impact: major** for the proposed implementation: delivery conflict semantics change, automatic mission narrative publication is retired, and narrative freshness/publication rules become contractual. This document-only revision has contract impact **none**. Current source baseline: contract 174.2.0. Choose the next actual version using `yarn version:contract`; do not reserve or handwrite a version or ADR number in advance.

## 1. Product result and scope

An agent can record discoveries while working, inspect and finalize its report, and deliver the completed objective once. Acceptance permanently records its evidence and ends execution. Network retries cannot duplicate delivery. A stale optional mission narrative cannot reject completed work or discard valid item decisions.

Mission headline and summary are authored by agents with execution context. There is no automatic model or deterministic mission narrative composer. When an agent cannot publish immediately, its delivery still succeeds and it can publish one reconciled narrative afterward, without a time limit, while that delivery's publication opportunity remains valid. A newer delivery or follow-up invalidates the older opportunity. If no agent publishes, the UI honestly shows missing or outdated prose alongside the accepted work and live item state.

Draft evidence and progress remain provisional. Delivery is a single final boundary. There is no partial-delivery state, incomplete outcome, automatic remainder objective, new queue hold, general summary editor, or editable accepted report in this scope. Blocked work continues through `ask`; new execution after acceptance requires `resume-follow-up`.

This is the general reporting workflow for all objectives, including missions without summary eligibility and retrospective `record-work`. Cross-mission item closing remains an independent consumer of the same finalization boundary.

### 1.1 Review baseline

The following user directions are settled and must not be reintroduced as optional phases:

- Reject partial delivery as a lifecycle feature.
- Remove the arbitrary five-minute publication expiry. Validity follows current evidence and authorization, not elapsed time.
- Remove all automatic **mission headline/summary** generation, including deterministic narrative fallback.

The implementation baseline also includes the recommended atomic boundary, durable receipts, opt-in draft evidence, read-only draft visibility and immutable accepted reports. These complete the plan for review; the user's discussion is not recorded as separate approval of every detail. Section 11 identifies the remaining product choices without blocking preparation of this plan.

## 2. Current behavior and affected ownership

Checked source on 2026-11-18:

| Current behavior | Source / implication |
| --- | --- |
| `deliverSession` validates and then writes delivery, items, artifacts, events, objective completion and session end in one transaction. | `packages/core/service/protocol.ts:2777`, transaction at 2866. Keep this permanent boundary. Recheck session state inside its mission lock. |
| A stale narrative base throws before delivery insertion, rejecting the whole transaction. | `packages/core/service/mission-summary-agent.ts:354`; wrapper in `protocol.ts:2763`. Replace only stale-prose rejection; keep authorization and required-content validation. |
| Closes can already be made during a live session, with null delivery attribution. | `protocol.ts:3570`, ADR 0073. Preserve per-entry warnings and the core item writer. |
| Any live agent narrative blocks fallback publication, even after newer prose-free deliveries. | `worker-jobs.ts:350,485,530`, normative `contract/data/README.md:1633`. Retire the entire automatic publication path, rather than weakening this guard. |
| Fallback publication also increments `content_revision`. | `worker-jobs.ts:542`. After cutover, only accepted agent narrative writes advance this revision. |
| Delivery report source is immutable; its derived presentation is replaceable. | `delivery-presentation.ts:114` and `packages/contract/src/delivery-report.ts`. Keep this distinction and existing item reconciliation. |
| Summary seen state is based on deliveries/questions. | `backend/mission-summary.ts:306,319`. Extend it for actual post-delivery agent publications. |
| Summary model helpers also contain shared run-selection logic and limits. | `mission-summary-compose.ts`, `mission-summary-evidence.ts`. Extract retained helpers before deleting composition code. |

Core owns finalization, draft and publication services; database owns storage/migrations; backend owns authenticated transport and durable worker integration. Automations may format accepted delivery evidence, but must not author a mission narrative. Web and iOS consume one server-defined freshness model and shared derive fixtures.

## 3. End-to-end workflow

1. **Attach.** Return the existing mission baseline, with evidence revision and narrative freshness, plus any compact draft baseline belonging to this same live execution. No new compulsory reporting call.
2. **Work.** `update` accepts progress, optional structured draft operations, or both. `heartbeat` remains liveness. `ask` remains a blocker. Batch discoveries instead of reporting after every tool call.
3. **Inspect.** Read `report-draft` once before finalization when a draft exists. Withdraw observations that were resolved, amend tentative wording and add missing evidence. Finish the authorized objective scope.
4. **Deliver.** The CLI/MCP supplies a stable operation id. Core validates the request, seals source evidence and commits lifecycle, accepted item decisions and durable side effects together. A fresh narrative publishes inline; stale or absent prose leaves a valid publication opportunity.
5. **Reconcile if needed.** The accepted response includes a fresh baseline and narrow publication instruction. The originating agent may read current summary context and publish one reconciled narrative. It cannot change the delivery record or continue implementation.
6. **Stop.** Give the user the accepted result. If superseded or unable to publish, state that the mission prose remains missing/outdated. No automatic composer repairs it and no new execution is silently started.

Malformed narrative shape, malformed strict deferred work, invalid scope/credentials and database failures still reject before finalization. Semantic item problems remain bounded warnings. “Reliable delivery” does not mean accepting an unauthorized or malformed record.

## 4. Durable, replay-safe finalization

### 4.1 Receipt storage and addressing

Add core tables in both SQLite and Postgres, using portable types, scoped FKs, timestamps, tombstone/revision conventions, and generated types:

| Table | Data and constraints |
| --- | --- |
| `delivery_finalizations` | Workspace/project/mission/objective/delivery ids; originating workspace user; nullable session id; operation kind (`deliver` or `record_work`); client operation id; canonical request digest; immutable accepted result JSON; accepted timestamp. Unique `(workspace_id, actor_workspace_user_id, operation_kind, operation_id)` and unique non-null `session_id` for new finalizations. Receipt/result are immutable after insertion. |
| `delivery_summary_publications` | Unique reporting delivery id; originating actor and nullable session; accepted evidence revision; original proposed headline/summary if supplied; published headline/summary, content revision and time if successful; superseded timestamp/reason; mutable row revision. No deadline or expiry column/job. Original proposal and successful publication text are immutable source/audit data. |
| `delivery_report_drafts` | Unique session id, scope ids, owning workspace user, revision, nullable sealed delivery id, timestamps. No mission-item status or lifecycle completion meaning. |
| `delivery_report_draft_batches` | Draft id + operation id unique; request digest; immutable accepted result revision/event id; scoped timestamps. Retained for draft/session lifetime with explicit write bounds. |
| `delivery_report_draft_entries` | Draft id + stable client entry id unique; supported kind; bounded content JSON; position; withdrawal time/reason; optional source event id; timestamps/revision. No cascade from live mission item decisions. |

Use the existing core idempotency primitives where suitable, but the durable receipt must be committed with the delivery and must not depend on a short-lived HTTP cache entry. Do not claim that generic REST idempotency by itself makes the current service transaction replay-safe. Keep receipts for the life of their delivery; ordinary request-cache cleanup must not reopen finalization authority.

Expose `operationId` on deliver/record-work payloads and `--operation-id` in CLI. Updated CLI clients persist an owner-only attempt record (id, semantic request digest and addressed scope) before transmission. `--retry-operation <id>` resumes that attempt after restart; `--new-operation` explicitly starts another, including intentionally identical record-work. Refuse a mismatching retry body. If persistence is unavailable, require an explicit caller-retained id for the strong guarantee and disclose the limit; never silently mint a new id on timeout. Local/hosted MCP exposes a caller-retained operation id in typed input: the caller chooses it before invocation and reuses it on retry. An id generated only inside a tool handler is not a retry guarantee. Apply the same attempt boundary to publication. Do not retain raw bodies or secrets in attempt metadata. Require it for record-work's new replay guarantee; omitted ids remain accepted for older clients, but the server cannot infer whether two identical sessionless requests were intentional separate work. Document that limit, do not dedupe unrelated retrospective work by text hash.

Hash canonical validated semantic input: scope, source summary, explicit artifacts/paths, evidence/draft revision and operations, optional narrative and closes, verification/follow-up prose. Exclude bearer/session secrets, capture diagnostics, timestamps and server-derived presentation. Preserve meaningful array order; normalize through the same parser as first acceptance. Save only digest plus accepted identifiers/result, not a raw transport envelope. Failed validations do not create an accepted receipt or consume a draft.

### 4.2 Transaction and replay behavior

Inside the canonical mission lock:

1. Resolve current membership/token/project scope. Look up an existing operation receipt before requiring a still-live execution session. Same operation and digest returns the accepted receipt without writes. Same operation with different semantic input returns `409 delivery_operation_conflict`.
2. For a new operation, revalidate the session's scope and that it has not delivered/ended. If it already delivered, return `409 delivery_already_accepted` with the authorized existing delivery id, never a second delivery. Preserve this guard for old clients with no operation id. Historical deliveries that lack receipt rows still count as accepted sessions; do not rely on a new index backfill to resolve old duplicate history.
3. Validate the draft revision and final evidence selection, lock the draft and snapshot accepted input. Lock summary state after the mission lock. Use the existing validated close service; retain its warning model and current authorization.
4. Insert delivery/source report, mission items and artifacts; apply closes; record source events/change feed; complete/dequeue the objective; end the protocol session. Preserve the current “other active objectives keep the mission executing” rule.
5. For eligible missions, advance narrative evidence revision, invalidate prior outstanding opportunities, and create this delivery's publication row. Mark it fulfilled when fresh prose publishes inline, otherwise leave it outstanding. Insert the final receipt referencing that row. Seal the draft. Never mark a fulfilled publication as superseded; later work only makes its narrative coverage outdated.
6. Insert transactional outbox/jobs for required queue dispatch, webhooks, notifications and delivery-presentation composition. Commit once.

Return success from the committed receipt. Do not let a post-commit notification or dispatch exception become an apparent delivery rejection. Reuse supported outbox/job mechanisms and dedupe each side effect by accepted delivery id. Existing `deliverSession` performs queue/notification work after its transaction; bring required scheduling into a durable handoff without changing queue selection policy.

Add `delivery-receipt` / `overlord_delivery_receipt`: scoped read by delivery id or caller's operation id, available after session end. A not-found receipt alone is not proof that a concurrent request cannot commit; clients retry the **same** operation id, and the transaction serializes it. No blind new id on timeout. Receipt reads and replay recheck current access; a stolen operation id is not a credential.

Keep acceptance facts immutable. The acceptance receipt reports the publication status at acceptance; a separate current publication/context read reports later fulfillment/supersession, so replay does not rewrite history.

### 4.3 Record-work

Reuse the finalization normalizer/receipt helper, but create mission + completed objective + source report atomically with its operation receipt. No phantom session or draft. Before a mission exists, concurrent record-work calls serialize through the receipt uniqueness constraint: a losing insert rolls back its whole creation transaction, then reads and compares the winning receipt. Do not acquire a lock on a nonexistent mission or persist an in-progress receipt in a separate commit. Fresh narrative can publish at creation without a caller base revision. When it is omitted, the created delivery can receive one sessionless publication opportunity bound to its authenticated originating user; it uses current user authorization, never an invented session key.

Record-work can close items submitted with its own new delivery subject to the applicable close service. It must not find or attach earlier session closes by actor/objective similarity. Ordinary delivery may link previously verified closes by **exact originating session** when coo:1278's provenance schema exists.

## 5. Agent-only narrative and publication without a timer

### 5.1 Evidence identity and freshness

Extend `mission_summaries` with `evidence_revision` (monotonic integer), nullable `published_evidence_revision`, nullable `narrative_published_at` and `narrative_changed_at`. Ensure an empty state row for every eligible mission on first delivery/follow-up mutation; an empty row is not authored text. `content_revision` moves only on accepted narrative text publication. Row `revision` also moves on evidence/freshness mutations, with scoped change notices.

Advance `evidence_revision` under the mission lock on each accepted delivery, explicit follow-up start, objective reopen, or source-delivery deletion that invalidates the published basis. Publication opportunities bind to this revision. Handle mission move/deletion through scope invalidation. A pure draft observation, liveness update, presentation rewrite, item close/restore or open-question transition does **not** claim new prose coverage or grant publication authority. Those facts stay independently visible through live lists/status. This revision measures the defined delivery/execution basis, not whether every sentence is semantically current.

A publication is valid only when its delivery is still the newest eligible current-run accepted delivery, its evidence revision is current, its source objective/session has not started follow-up/reopened, its bound scope still matches, and no successful publication exists for it. Use revisions, not wall-clock timestamps, to resolve ties/races. Initial parallel objectives already running do not gain the ability to amend each other's accepted reports; a later accepted delivery owns the next narrative opportunity.

Return a server-derived `narrative` envelope on summary reads, attach baseline and publication context:

```text
{ state: absent | current | outdated | legacy,
  evidenceRevision, publishedEvidenceRevision,
  deliveryId, objectiveId, publishedAt, changedAt,
  outstandingDeliveryId }
```

`absent` means no prose; `current` means agent prose explicitly published against the present basis; `outdated` means a later basis exists; `legacy` means retained prose lacks verifiable coverage metadata. These are new narrative descriptors, not objective statuses. All properties are documented nullable where absent. Lists/items/actions remain available even with no prose. Summary-ineligible missions keep their existing ineligible response and get no publication opportunity.

Keep the existing summary row's historical `generated_by` and status vocabulary for old records/consumers in this release. Newly published text always has `generated_by = agent`; empty shells have no exposed author. New clients use `narrative.state`, not a historical `pending/fallback` value, to decide whether prose exists or needs updating. Do not fake provenance by labeling old model-generated prose agent-authored.

### 5.2 Inline delivery and outstanding publication

For supplied well-formed prose, compare both `baseContentRevision` and `baseEvidenceRevision` against the pre-delivery state under the mission/summary lock before advancing delivery evidence. Only when both match may prose publish against the newly advanced evidence revision in the finalization transaction. Legacy input missing the evidence base is accepted for delivery but its prose is conservatively withheld. Record-work retains its new-mission exception. This prevents a prose-free concurrent delivery from advancing evidence unseen while leaving content revision unchanged. Stale prose does not throw: retain old text, accept all other work, and create an outstanding publication row. Absent prose also creates that opportunity for eligible missions; without a composer, omission must not require reopening execution solely to provide a summary.

Extend the accepted result, retaining existing fields:

```json
{
  "deliveryId": "...",
  "eventId": "...",
  "operationId": "...",
  "missionSummary": {
    "contentRevision": 8,
    "narrativeWritten": false,
    "closedItemIds": [],
    "warnings": [],
    "publication": { "id": "...", "available": true },
    "baseline": { "contentRevision": 8, "evidenceRevision": 15, "headline": "...", "summary": "..." }
  },
  "instruction": "Delivery accepted. Reconcile and publish the mission summary; do not deliver again or resume execution."
}
```

Real baseline carries the existing author/open-item pagination information as well; the example abbreviates it. Item warnings do not obscure narrative publication instructions. Disabled-summary responses carry no available publication. Updated CLI prints successful JSON and exits zero; MCP reports accepted delivery, not a tool error. Legacy clients that ignore the new fields still deliver successfully, but their omission can leave prose absent/outdated indefinitely.

### 5.3 Narrow read/write surfaces

Add these protocol commands and MCP counterparts, using shared core services:

| Surface | Inputs | Result |
| --- | --- | --- |
| `delivery-summary-context` / `overlord_delivery_summary_context` | Mission + delivery/publication id; originating session key for session-bound opportunities | Current publication availability/reason and fresh editable baseline with evidence/content revisions. No execution attach. |
| `publish-delivery-summary` / `overlord_publish_delivery_summary` | Same bound identity; operation id; base content and evidence revisions; headline + summary | Accepted publication receipt, or fresh context on CAS conflict/supersession. No closes, paths, artifacts, report fields or objective updates. |

Allow one **successful publication**, not one network attempt. Same publication operation id and content replays its receipt. Changed content after success is refused, even under a new operation id. CAS failures consume nothing and return `409 mission_summary_conflict` with current baseline; this code now applies to the narrow publication operation, not accepted delivery. Supersession returns `409 mission_summary_publication_superseded`, with no route to resurrect the old opportunity. Deleted/out-of-scope sources return not-found without leaking existence.

No deadline, waiting timer, expiry worker, expiry cleanup or automatic prose generation. If the opportunity remains valid for a month, the agent may publish after a month with freshly read revisions and current authority. The elapsed month itself grants or revokes nothing. The agent should attempt reconciliation immediately; allow one immediate CAS retry to avoid an unbounded autonomous loop, then report that the opportunity remains available. This retry instruction is not a server-side expiry or attempt limit.

Authorization requires live user/token authentication, current workspace membership, project scope, `event:create`, and the same originating workspace user. For session-bound opportunities, additionally verify the original session-key hash and exact mission/objective/session/delivery relation, while permitting its **delivered** ended state for this operation only. An ended non-delivered or deleted session is invalid. A record-work opportunity has no session key and is bound to the originating user/record-work receipt. Token rotation by that same user may work if current grants permit it; token revocation always removes the revoked token's access. Publication ids and operation ids are non-secret references. Other agents or people need new explicitly authorized work rather than borrowing this opportunity.

Keep `project_automation` denied, and test full, mission_lifecycle and hosted OAuth grants against the current owner role. No broadening of ended-session update/close/edit authority. Normal `resume-follow-up` is still required for actual work. A current read response is not proof that a later write will succeed; check revision, availability and permissions again in the publication transaction.

### 5.4 Visibility and seen state

Web/desktop/iOS show existing prose with “Summary not updated for the latest delivery” when outdated, or “Summary not yet provided” when absent. Legacy prose keeps its actual provenance and an “Earlier summary” label. Do not show an endless “generating/updating” spinner or promise an automatic repair. Link to latest accepted work where available. Live mission status, open questions, actions and item decisions remain independent of the narrative.

Add `narrativeWatermark` for actual publication/freshness evidence, based on `narrative_changed_at`; update it on a basis invalidation as well as text publication so disappearance/staleness is acknowledgeable. Include retained timestamps in the seen upper bound even if a publication's source is later deleted. No draft update changes the summary watermark. Preserve existing delivery/question `watermark` semantics and coo:1278's independent `itemsWatermark`.

Keep the existing scalar `seen_at` and whole-snapshot coverage gate. Acknowledge the combined maximum only after every relevant group in that response has been rendered, including narrative, risks/actions/suggestions and cross-mission item decisions where present. Preserve group signatures and invalidate coverage when the corresponding evidence changes. A newer visible narrative must not acknowledge older hidden risks, nor may newer visible risks acknowledge an older hidden narrative. Verify this after remount/cold reads on web and iOS. Do not implement independent section clearing without separately designed per-stream persisted positions. Opening an unrelated tab must not mark hidden evidence as read. Update shared derive fixtures and both client implementations. Server upper-bound acceptance stays monotonic; publication timestamps must be server-issued and strictly advance relative to prior narrative changes at millisecond precision to avoid equal-timestamp missing markers. This is a display timestamp rule, not the concurrency identity; revisions remain the latter.

## 6. Remove automatic mission narrative composition

Retire both Gemini and deterministic mission headline/summary writers. This is functional removal, not a disabled-by-default feature:

- Stop enqueueing from delivery presentation persistence, item resolution create/delete, question creation/transition and objective reopen. Replace any needed freshness/change-feed behavior with the explicit basis rules above.
- Remove `backend/mission-summary-compose-worker.ts` registration/startup from `backend/app.ts` and the worker publication/successor path in core. No future job may publish or enqueue a successor.
- Remove `automations/src/compose-mission-summary/` implementation and public exports/registry references. Retain shared Gemini configuration used by other automation features. Remove the obsolete mission-only disable env knob from active runtime/docs; preserve historical migration text.
- Extract `MISSION_SUMMARY_LIMITS` headline/summary bounds, current-run SQL predicate, deterministic delivery ordering and run-selection types/functions from `mission-summary-compose.ts` into retained narrative-state/evidence helpers. `readMissionSummaryRuns`, item reads, source selection and their tests still serve operator reads and must survive. Remove model input construction, sentence synthesis and fallback-specific limits/tests when no longer used.
- Retain existing historical generated text and provenance in place. Do not delete or regenerate it, backfill fabricated coverage, or modify issued source reports/items.

**Delivery-report composition is a separate path and stays supported in this scope.** Keep `overlord.delivery.compose.v1`, immediate deterministic presentation, optional asynchronous formatting, deterministic path-derived actions and `mission_items` reconciliation. Remove only its trigger into mission narrative composition. Existing delivery presentation remains provider-independent at acceptance; it never mutates authored evidence or gains permission to write mission prose. Retiring report formatting as well would be a separate product scope change.

### 6.1 Cutover and historical data

Add a migration that cancels queued/running `overlord.mission.summary.compose.v1` jobs without deleting their audit history, backfills new freshness fields conservatively, and leaves existing source/agent reports and item identities unchanged. Existing agent or model prose with no proven basis is `legacy`; the next accepted agent publication establishes coverage. Empty old `pending` shells become absent for new reads and must not imply a running job.

Prevent old in-flight writers across deployment, not just newly queued jobs. Release must drain/stop **all old backend/worker replicas before migration and new backend activation**; do not use an overlapping rolling deployment for this cutover. Verify no old composer process holds a lease, then cancel persisted jobs, migrate and start the new version. If the supported deploy wrapper cannot provide this sequence, implement a database-enforced agent-only narrative-write fence for both editions before allowing overlap; an application flag that old code does not read is insufficient. This is a release gate, not an assumption that the worker will finish quickly.

Document the brief cutover interruption and rollback restrictions. Rolling back old application code would reintroduce a forbidden writer; rollback requires keeping the old narrative worker and enqueue path disabled and verifying no auto writes, or restoring a reviewed compatible build. Database backup/restore rehearsal belongs to release readiness, not an agent draft human-action entry. No production migration or deploy is part of this planning objective.

## 7. Durable draft reporting

### 7.1 Operations and storage

Extend `update` with opt-in `reportDraft { operationId, expectedRevision, operations }`. The batch operation id is caller-retained and separate from stable entry ids. Add `report-draft` / `overlord_report_draft` read. A write can omit prose progress; it emits the normal attributable event with bounded operation metadata rather than duplicating all entry text into events. Use one shared service for CLI, MCP and backend routes.

Each operation names a stable client `entryId` and either upserts content or withdraws it with a reason. Supported kinds: human action, tradeoff, known risk, deferred work and assumption. Reuse existing field schemas and per-kind limits; expose concrete kind-specific payloads in generated types. Keep this new vocabulary bounded to declared core values; unknown extension values cannot enter the sealed V1 report silently.

Expected revision guards the draft header. Add `delivery_report_draft_batches`, unique `(draft_id, operation_id)`, with canonical batch digest and immutable accepted result (result revision and event id). Write the batch receipt, entry mutations and attributable update event atomically. Replay the same id/digest before CAS; changed input under the same id is refused. An accepted-batch replay after sealing or session end remains a currently authorized receipt read and does not regain update rights. Retain batch receipts and withdrawn entries for the draft/session lifetime, with at most 1,000 accepted batches and 1,000 distinct entry ids per draft; reject new writes beyond that bound while still allowing receipt reads and finalization. No silent pruning or lost replay guarantee. Active-entry limits remain separate. A batch succeeds atomically or returns a fresh draft on conflict. Enforce 12 active entries per kind and existing character/URL/deferred-work bounds at draft-write time. Withdrawn entries remain inspectable audit data but do not count toward active limits. Do not store credentials, transcripts or unbounded tool output.

Only the owning live session may write its draft. Distinct objectives and distinct sessions have separate drafts. Attach recovery of the same execution returns its compact active draft/revision. Follow-up creates a fresh draft. After an execution is abandoned, a replacement authorized execution may read/import selected prior observations explicitly; it does not inherit the old session's mutation rights or automatically seal that draft.

### 7.2 Seal and compatibility rules

A delivery with a draft sends `expectedDraftRevision` and optional final operations. Lock and validate once, apply those operations, then snapshot active entries into the normalized authored V1 report. Missing expected revision on an existing draft returns a precise pre-commit draft conflict with the current revision, preventing an older resumed client from silently ignoring discoveries. Sessions without drafts retain existing full-report behavior.

For draft-aware sessions, final supplied legacy report arrays merge by canonical kind/content with active draft entries; unmatched entries remain. Amend or remove a draft entry through its stable id/withdraw operation, never by omitting it from the final arrays. Validate the merged active set before acceptance; no truncation or model-selected discard. The final inspection response shows normalized eligible evidence and any exclusion warnings so the agent can correct it before deliver. Report normalization/eligibility remains shared with record-work and the non-draft path.

On acceptance, seal the draft and link the delivery in the finalization transaction. A lost-response replay returns the original sealed result. A failed delivery leaves the draft unsealed. Subsequent updates cannot change sealed source. Draft entry ids are not `mission_items.id` or delivery-local item refs; maintain a deterministic mapping at seal and preserve current V1 digest/position rules.

Do not create `mission_items` from draft entries. Only accepted delivery evidence creates live items; the existing reconciliation/supersede services continue to own later status. A draft cannot create human obligations, close a risk or supersede another delivery. Composition reads sealed evidence only and preserves risk text/deferred-work identity, so a closed risk cannot return under a paraphrase. Planned sibling/current leftover work stays excluded from out-of-mission deferred work; blockers still use `ask`.

### 7.3 Operator view

Show a collapsed “Draft evidence — not delivered” section on the current objective, read-only. Display the source session and active entries, with withdrawn observations behind a separate disclosure. It must not populate mission risk/action/suggestion badges, trigger promotion, change seen markers, or imply objective completion. Fetch lazily on expansion; refresh through scoped entity changes rather than broad mission reload loops. Include read-only parity on iOS; no new native editing flow.

Roll out draft-writing guidance as an opt-in pilot first. Measure still-applicable evidence omissions, reporting calls/bytes, finalization failures and user corrections before making it a default instruction. Existing sessions/clients without a draft need no extra call or mandatory report fields.

## 8. Protocol and module work map

All new commands use existing protocol transport and error conventions, shared core services, hosted/local MCP parity and generated connector catalogs. New reads require normal mission/session visibility; writes require current event permission plus the more specific ownership/binding checks above. Attach and lifecycle instructions are worded separately for CLI/MCP. Additive fields are optional for older clients; the changed conflict/publication behavior still requires a major contract release.

| Module | Required implementation |
| --- | --- |
| Contract | Protocol lifecycle, deliver/record-work/update/new command shapes, receipt replay, ended-session publication, narrative basis/freshness, draft sealing and no partial delivery. Update data/architecture/auth/OpenAPI, status/author compatibility notes, shared seen vectors, ADR amending ADRs 0046/0060/0073 as applicable, components/extension registries where exposed capabilities change. Increment through version tooling, generate API/types, restamp conformance manifests for major. |
| Database | Five new tables, summary evidence/publication fields, uniqueness/FKs/indexes, conservative backfill and job cancellation in both editions; generated types. Preserve historical vocabulary and source records. Cover portable timestamp and scope semantics. |
| Core | Finalization/receipt helper, in-lock session revalidation, durable side effects, publication availability/CAS, draft service and seal normalization; extract shared run/limit helpers. Remove automatic narrative trigger/publication code without removing live item services. |
| Backend | Protocol dispatch/body schemas, scoped receipt/context/draft reads, post-delivery write authorization; summary DTO/freshness/seen bounds; worker retirement and cutover gate. Cover sessionless record-work author binding. |
| Automations | Remove mission narrative implementation/exports. Retain delivery formatting, shared provider config, objective descriptions and unrelated workers. No replacement narrative generator. |
| CLI | Stable persisted operation ids/receipt recovery, new commands and flags/file envelopes, draft inspection, successful-with-unpublished-prose output and help. Do not run attach or resume-follow-up to publish prose. |
| MCP | Same semantics and typed payloads for hosted/local tools; update `packages/contract/src/mcp-tools.ts`, `mcp/tool-catalog.ts`, `mcp/server.ts`; test success versus tool-error behavior and retry identity. |
| Connectors | Reporting loop, one immediate reconciliation retry, explicit stale/missing disclosure, no automatic repair promise, no partial completion and preserved execution boundary. Regenerate tools/capabilities as affected and sync plugin versions under connector-versions skill. |
| Web | `MissionOverviewCard`, objective draft view, summary read types, provenance/missing/outdated states, receipt links, rendered-evidence acknowledgement and scoped refresh. Preserve live status independent of narrative. |
| Desktop | Shared web UI and refresh behavior; verify Electron rendering and protocol transport/retry behavior, no second native draft store. Runner scheduling policy unchanged. |
| iOS | In OverlordMobile: optional new `Contract.swift` fields, API reads, `MissionSummaryDerive.swift`, summary/draft views, coverage/seen fixtures, lazy scoped refresh. Preserve old-server decoding; do not invent freshness when fields are absent. |
| Docs | General workflow and examples, record-work parity, replay failure cases, narrow publication authority, missing-prose semantics, removal of summary worker/config guidance, migration/release/rollback steps. Keep public and agent docs consistent. |

No work is required in Latch, marketing or marketplace repositories for these protocol semantics unless source inspection during implementation discovers an actual consumer. Mobile changes are executed in its own repository/objective; this plan update does not edit sibling resources.

## 9. Ordered implementation phases and acceptance

Each phase lands its code, contract delta, migrations, generated artifacts and focused checks together. Do not land normative behavior before its implementation. Prepare interfaces first in this plan, not through a contract-only release.

| Phase | Scope / contract classification | Completion evidence | Estimate |
| --- | --- | --- | --- |
| 1. Replay-safe finalization | Durable operation receipts and lookup; in-lock single acceptance; transactional handoff of side effects; deliver + record-work parity. Additive minor if existing conflict behavior remains in force. | Dropped response replays the same delivery/mission; concurrent different ids cannot finalize one session twice; malformed/auth failures leave no accepted record; jobs eventually run once logically. | 3–5 days |
| 2. Agent-only narrative boundary | Evidence basis, accepted stale/absent prose, one-shot post-delivery publication/read; no expiry; remove all automatic narrative writers/triggers; migration + fleet cutover gate. Major release. | Stale prose accepts report/closes; later valid publication works after arbitrary elapsed time; superseded/revoked writes fail; queued and in-flight old composer cannot publish after cutover. | 5–8 days |
| 3. Honest client state and seen parity | Server freshness DTO, web/desktop/iOS unavailable/outdated/legacy states, provenance and narrative watermark/visibility fixtures. Implement with phase 2 for a user-facing release. | No endless generating state; accepted delivery visible without prose; only displayed evidence acknowledged; cold/read-only mobile and desktop parity verified. | 3–5 days |
| 4. Draft evidence and seal | Draft storage/update/read, idempotent batches, final inspection/merge/seal; small read-only web/iOS objective view; opt-in agent instructions. Additive minor on the new baseline. | Withdrawal, replacement session import, revision conflict, overflow, replay and immutable sealed evidence behave as specified; draft never leaks into live items or composer input. | 5–8 days |
| 5. Integrated release verification | Contract/API/conformance/connector parity, SQLite + real Postgres races, CLI + MCP lifecycle, browser/Electron/iOS flows, cutover/restore rehearsal and publication observability. No new behavior. | All acceptance journeys below pass and release checklist distinguishes automated/local/device/production evidence. | 2–4 days |

Estimate **18–30 engineering days** of serial effort across repositories, with uncertainty from receipt/outbox reuse, mobile scope and fleet cutover tooling. These are planning estimates, not measured delivery commitments. Phases 2 and 3 are one release unit; do not remove the composer while clients promise automatic text, or ship accept-without-publication first. Drafts can follow the reliable boundary and need not delay that release. Instrumentation runs with phases 1–4; a two-week observation window is not a prerequisite to start implementation.

### 9.1 Required test journeys

- Same operation repeated before/after session end, lost response, differing body, revoked user, deletion/project move, old delivered session without a receipt, concurrent deliver/deliver and deliver/update in SQLite and Postgres. Assert one delivery, source report, objective transition, seal and durable side-effect identity.
- Record-work retry creates one mission/objective/delivery with operation id; omitted id retains documented legacy behavior. No fabricated session or accidental linkage of someone else's earlier closes.
- Parallel A/B delivery with the same content/evidence bases, including A delivering without prose so content stays unchanged: B accepts/closes with an outstanding opportunity; B reads and publishes coherent whole-mission prose. No second delivery or execution reopen.
- Advance the clock beyond minutes/days without other work: publication still succeeds. Advance evidence through a newer delivery or follow-up/reopen: old publication fails. Success replay is stable; a changed second publication is refused. Include publication-versus-new-delivery lock races.
- Absent prose on first delivery, legacy generated text, empty old pending shell, ineligible mission, no composer/provider available. Delivery and live lists work; no text is generated. Prior prose remains truthful in provenance and visibly lacks new coverage.
- All former trigger paths (questions, item decisions, presentation save, reopen) enqueue no narrative job. Pending/running historical job cancellation and release drain prevent late publication/successor jobs. Unrelated delivery presentation and objective-description workers continue working.
- Draft batch A commits and loses its response, B edits the same entry, then replay A: preserve B and return A's receipt with no duplicate event, including after sealing/session end. Also test draft batch replay/CAS, resolved withdrawal, normalized final merge/limit failure, abandoned session import, pre-delivery inspection, deliver race and sealed immutability. Assert risk/deferred-work identities and item decisions survive presentation reconciliation unchanged.
- Post-delivery publication/freshness watermark, source deletion, same-millisecond changes, unseen tab coverage, stale response acknowledgement, coo:1278 items watermark and open-question behavior. Shared vectors on web/iOS plus browser/Electron rendering and iOS decoding/UI tests.
- Backend RBAC for full/mission_lifecycle/project_automation/hosted OAuth, expired/revoked credentials, same-user rotated token, cross-user/cross-workspace ids, ended non-delivered sessions and sessionless publication. Responses reveal no foreign source existence.
- CLI file/JSON/stdin envelopes and persisted retry id; local/hosted MCP accepted-with-unpublished-prose responses; generated tool catalogs/help/instructions and connector version parity.

Run relevant focused checks in each phase. At integration, run contract checks, API generation/parity checks, conformance versions, core/backend/CLI/automations/web/desktop suites and mobile build/tests; use a real Postgres conformance database rather than treating SQLite as production evidence. Remove only obsolete narrative-generator tests; keep the retained owner of run selection, item lifecycle, scopes and seen semantics explicit.

### 9.2 Implementation objective mapping

All objectives are assigned to `claude` / `claude-opus-5-5` (Opus 5.5), created as unqueued drafts. Order reflects dependencies; it does not authorize launch or deployment. Web/desktop and iOS slices split phases 3 and 4 so each runs in its owning resource.

| Order | Objective | Resource | Work |
| --- | --- | --- | --- |
| 1 | `coo:1297.hk2v` | primary | Make delivery and record-work finalization replay-safe |
| 2 | `coo:1297.7bbk` | primary | Replace mission narrative composition with agent-only publication |
| 3 | `coo:1297.jwen` | primary | Show truthful mission narrative freshness on web and desktop |
| 4 | `coo:1297.eydc` | mobile | Implement agent-only summary freshness and safe seen state on iOS |
| 5 | `coo:1297.c6h4` | primary | Add durable draft evidence updates and atomic report sealing |
| 6 | `coo:1297.9388` | primary | Expose provisional draft evidence on web and desktop |
| 7 | `coo:1297.vxcy` | mobile | Expose provisional draft evidence read-only on iOS |
| 8 | `coo:1297.c47x` | primary | Verify the complete delivery workflow and prepare release evidence |

## 10. Release compatibility and coo:1278

Old clients may still omit narrative/draft/operation fields; acceptance remains supported. They lose automatic mission prose by deliberate product decision. New fields must not break old iOS decoders. Receipts cannot promise sessionless old-client idempotency without an operation id. New publication/draft commands require the new backend; capability/version errors must be explicit rather than silently starting follow-up.

Release core/backend/storage before CLI/MCP/connectors, then web/desktop/mobile consumers through supported release gates, with phases 2/3 artifacts prepared before cutover. Use the no-old-worker gate in section 6.1; no bare overlapping backend rollout. Publish compatibility notes and verify the exact release SHA/build and current worker fleet. Do not claim deployment from local tests alone.

Live read during this planning revision: coo:1278.pyw6 and its three successors remain draft, and cross-mission closing is not present in the inspected source. Do not change or launch them as part of this plan review.

- `pyw6`: preserve same-project scope, target permission checks, restore protection, exact-session attribution and earlier-close linking. When released with this plan, replace all-or-nothing summary-conflict tests with accepted delivery/closes plus withheld prose and later publication. Remove resend-every-close instructions only once the behavior actually changes. If pyw6 ships first, retain its existing contract rules until this release. Record-work cannot link an earlier session it does not have.
- `kst1`: keep discovery/ranking independent of draft evidence. Close verified live items promptly because it updates current state, not because narrative concurrency might roll them back.
- `9zqn`: retain foreign-target prose isolation, Resolved/Restore and `itemsWatermark`; combine with the independent narrative watermark only when rendered. Summary publication remains own-mission only.
- `agbz`: mirror these independent evidence/seen rules and optional decoding in iOS. No draft editing or new execution rights.

Prefer the reliable narrative boundary before/with pyw6 when release schedules coincide, but do not make general workflow work depend on cross-mission functionality. Rebase migrations/ADRs/version changes against whichever lands first, and test a global deterministic mission-lock order for any operation touching multiple missions; do not combine this transaction refactor with unexamined opposite-direction foreign-lock acquisition.

## 11. Review choices and explicit exclusions

The plan is concrete enough to implement after review. Remaining product choices have recommended defaults; they are not reasons to postpone writing implementation details:

| Review choice | Default in this plan |
| --- | --- |
| Adopt draft evidence now or after observing receipts/narrative changes? | Include it as phase 4, opt-in initially. It is independently releasable. |
| Show provisional evidence to people? | Collapsed read-only objective section on web/desktop/iOS; exclude all draft values from mission obligations and badges. |
| Keep delivery-report formatting? | Yes. Remove automatic mission headline/summary generation only. |
| Permit publication when delivery originally omitted prose? | Yes, once, by its original authorized author while its evidence basis is still current. Avoid a new execution solely for missing prose. |
| Preserve old generated mission prose? | Yes as visibly legacy historical text until an agent replaces it. Do not delete records or relabel their author. |

No partial/incomplete delivery implementation, remainder-objective creation, general discussion-time summary editor, accepted-report editing or dedicated correction notes. None is needed to ship the workflow above. No timer or automatic narrative fallback can be added as a hidden recovery mechanism. No plan to make all five report arrays mandatory for existing clients.

### 11.1 Correctness requirements incorporated from review

The implementation baseline incorporates R1–R4 of `delivery-process-review.md`: inline narrative checks both evidence/content bases; scalar seen acknowledgement keeps whole-snapshot coverage; draft updates have durable batch identities/receipts and retained-history bounds; CLI attempts persist before send and MCP callers retain operation ids. These are requirements of the affected objectives, not deferred integration cleanup. The recommended conservative seen behavior is selected for this scope; independent section clearing and author-takeover editing remain excluded. The implementation objectives explicitly test each correction.

## 12. Evidence and validation status

This is a document-only implementation plan, not a claim that the designs passed tests or shipped. Current-source inspection refreshed finalization, narrative agent/worker paths, caller authorization, operator read/seen fields, retained shared helpers and module integration points. No current contract or source behavior was changed.

The earlier research run executed 47 existing focused tests (protocol mission summary/items, mission summary composition and delivery composition), plus contract/conformance checks. That verifies the **pre-change baseline**, not this proposed implementation. Those test results were not rerun or relabeled as implementation evidence in this revision. Historical research sample and its limits follow; no additional production rates are claimed.

## Appendix A. Research evidence


### A.1 Sources and sample

Read-only live API collection through the installed authenticated `ovld` CLI, approximately 09:20–09:24 UTC on 2026-11-18. Project: Overlord, `49763405-008f-4267-89e4-c57f5a234c91`. Selection: **every mission created since 2026-11-15T00:00:00Z** returned by a mission-only search, limit 100. It returned 19 missions, below the limit. Retrieved `list-deliveries --limit 100` for each; all totals fitted the page. There were 79 deliveries on 17 missions, spanning 2026-11-15T21:38:39.988Z through 2026-11-18T09:10:11.865Z. This is a recent single-project cohort, not all production deliveries or a random sample.

For each mission with deliveries, loaded explicit-objective context using the newest delivery's objective UUID. Those 17 context responses carried 1,026 mission-history events; six reached the 100-event cap. At least coo:1284's history ended on November 16 while its latest delivery was November 17, so absent recent events cannot be counted as absent activity. Current compact attach directives and ordinary load-context history are different surfaces.

| Mission | Deliveries | All five authored evidence arrays empty |
| --- | ---: | ---: |
| coo:1277 | 0 | 0 |
| coo:1278 | 2 | 0 |
| coo:1279 | 9 | 3 |
| coo:1280 | 2 | 0 |
| coo:1281 | 8 | 4 |
| coo:1282 | 1 | 1 |
| coo:1283 | 6 | 2 |
| coo:1284 | 16 | 11 |
| coo:1285 | 3 | 3 |
| coo:1286 | 1 | 1 |
| coo:1287 | 1 | 1 |
| coo:1288 | 1 | 1 |
| coo:1289 | 6 | 5 |
| coo:1290 | 1 | 1 |
| coo:1291 | 4 | 3 |
| coo:1294 | 16 | 4 |
| coo:1295 | 1 | 1 |
| coo:1296 | 1 | 0 |
| coo:1297 | 0 | 0 |
| **Total** | **79** | **41** |

The DTO's normalized `report.agentReport` was the measurement surface. Missing or invalid legacy reports normalize to empty arrays (`packages/contract/src/delivery-report.ts:117`), so emptiness measures the **visible structured record**, not whether an agent submitted a raw report. Counts with at least one entry: human actions 14/79, tradeoffs 9/79, risks 22/79, deferred work 10/79, assumptions 30/79. Overall, 41/79 (51.9%) were completely empty. Empty is not automatically deficient: many deliveries are small presentation changes or research revisions.

### A.2 Answers that the evidence supports

| Requested measure | Result | Interpretation |
| --- | --- | --- |
| Delivery conflict frequency | **Unknown.** | Successful delivery records exclude rejected attempts. Runtime log search for `mission_summary_conflict` returned no entries, but logging/retention completeness was not established. This is not a zero rate. |
| Summary omission after conflict | **Unknown.** | No durable attempted request/retry chain was available. `missionSummary` is expressly not stored in delivery payloads. Current narrative provenance cannot reconstruct all historical retry submissions. |
| Close omission after conflict | **Unknown.** | Final item status cannot distinguish an omitted close from a close already done elsewhere, skipped, restored, or never attempted. Need rejected-request close counts/hashed identities and an attempt chain. |
| Missions actually running objectives in parallel | **0 overlapping pairs observed among 48 reconstructible launch-to-delivery intervals**, drawn from the capped histories of the 17 delivered missions. | A lower-coverage observation, not a production prevalence estimate. Counted first “claimed execution”/“started launching” through delivery per objective, then overlaps between different objective ids on the same mission. Capped histories, interrupted runs, multiple sessions and missing terminal boundaries prevent establishing a denominator of fully observed mission executions. Parallel configuration prevalence was not obtained. |
| Thin reports compared with work | **41/79 structurally empty; at least one clear prose-to-structure omission.** | Does not establish a quality defect in all 41, or loss caused by compaction. See the examples below. |

Concrete examples, retrievable by delivery or event id:

* coo:1284 delivery `fa1dedbe-af7b-4950-ba45-cfd631e7ab2f` reports a continuing undo/unfinished-IME limitation, uncontrolled performance evidence, and remaining device journeys; its authored risk list and all other evidence arrays are empty. The limitation survives in prose, so it was not forgotten entirely. This is a discoverability gap in structured reporting.
* coo:1281 update `555a9fda-6db8-4aa8-b9f6-31a7c2ad9417` raises request pagination and interaction failures; the later same-objective review delivery `a6d998cb-3fff-4110-9ff5-431068022ae2` has empty structured risks/actions/deferred work but enumerates findings in prose. This shows that a risk-like observation can survive a session and still never enter structured evidence. It may be reasonable for a review's findings to live in its report rather than become implementation risks; manual classification is required.
* As a control outside the cohort, coo:1260's release-verification delivery `d4543b8c-6f4e-4f0d-9d96-7a865f9cddfa` carries explicit release limitations and human actions. The reporting path can preserve substantive evidence when supplied.

Railway source: project `16825060-9441-490c-ab61-fc4e50ed9686`, production environment `156c6901-3134-4ecf-ba24-b10fe0d256f3`, backend service `71f225e9-8dff-4348-95d5-f3d7f2f02e2b`. Requested November 15–18 logs with a 500-entry bound. The HTTP tool returned 501 records covering only 09:19:20–09:20:53 on November 18 and included non-409 responses despite a status filter. It cannot supply a trustworthy filtered rate. Direct read-only PostgreSQL connection using existing production configuration failed DNS resolution; a separate source-client REST read lacked authentication. Neither failure invalidates the successful installed-CLI reads. No secrets, infrastructure settings or production data were changed.

### A.3 Operational measurement

During implementation, add bounded operational counters/events: request id, session/objective scope, delivery operation id, accepted/rejected result, error code, whether narrative was supplied, its base/current revision, close count, and salted item-id digests. Record no prose, raw request body or credentials. Persist an acceptance receipt in the finalization transaction; use existing audit/telemetry ownership and a retention bound for rejected attempts. Pair retries by operation/session, not timestamps alone. A narrative-only publication retry is not another delivery.

For two weeks, distinguish legacy rejected-delivery conflicts from new accepted deliveries with withheld prose, count successful outstanding publications and still-outstanding/superseded opportunities, and measure replay frequency/latency. Where pre-cutover attempt data exists, calculate retries missing previously attempted narrative or closes/conflicted operations. Measure concurrent distinct-objective execution intervals/all fully observed mission runs separately. Separate opt-in configuration from actual concurrency. For reporting quality, manually label a sample of updates/asks through delivery as resolved, still applicable, already assigned within mission, outside scope, or omitted. Compare draft-enabled and legacy sessions by still-applicable omission rate, reporting calls/bytes, delivery latency and user corrections; stratify by task type and session length. A resolved warning should disappear, so raw word matching is not a quality metric. This measurement is recommended implementation work, not completed research evidence.

Reproduction of the live cohort selection:

```sh
ovld protocol search --project-id 49763405-008f-4267-89e4-c57f5a234c91 --date-field createdAt --from 2026-11-15T00:00:00Z --entity-types mission --limit 100 --output json
ovld protocol list-deliveries --mission-id <each-result-display-id> --limit 100 --output json
ovld protocol load-context --mission-id <display-id> --objective-id <newest-delivery-objective-UUID> --output json
```

Evaluate `not any(report.agentReport[k] for k in [humanActions, tradeoffsMade, knownRisks, deferredWork, assumptions])`. Repeating later will change totals; the table records this collection, not a permanent live query. Temporary raw responses were used for analysis; the stable cohort, counts, record ids and limitations are retained here.

