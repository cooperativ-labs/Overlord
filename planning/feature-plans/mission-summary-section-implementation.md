# Mission summary section: phased implementation plan

Date: 2026-10-24. Status: review decisions incorporated; no runtime changes are made by this document.

Design source: the canvas "Mission Deliveries Section" (https://claude.ai/artifact/3UwTbGJFdzNe6YSYEWre7V), boards *Web · summary, review mission*, *Web · updating, all clear, before first delivery*, and *iOS · summary*. The earlier "Mission Deliveries section: presentation spec" (24 Oct 2026) is superseded by this plan where the two differ; its derivation rules for runs and supersession (§4.1) and its accessibility rules (§8) still apply.

Prerequisite: `coo-1199-change-tracking-implementation.md` lands first. This plan builds on that cutover and must not reintroduce anything it removes. The compatibility section at the end lists every point of contact.

## 1. Product result

The mission panel gains one agent-maintained block, **Mission summary**, that answers three questions for the whole mission: what happened, what the operator still has to do, and what should happen next. It also lists significant risks and the files changed across the mission. It is rewritten by a compose job after every delivery and after every operator decision that changes its contents.

The objective accordions keep the per-delivery reading but lose the parts that now live in the summary. An expanded objective shows the delivery narrative, tradeoffs, known risks, assumptions, and the compact files-changed list from coo:1199. For summary-eligible missions, human actions and deferred work no longer render inside objective rows on web. Existing missions keep their full delivery presentation because they do not receive a summary (§4.2).

Nothing else on the mission panel or the iOS mission screen changes. The iOS flat deliveries stack stays until a later follow-up.

## 2. Phases at a glance

| Phase | Scope | Contract bump | Release |
| --- | --- | --- | --- |
| 1 | Web objective accordion shows narrative, tradeoffs, risks, assumptions, files changed; actions and deferred work removed | No | Shared release |
| 2 | Backend: mission summary compose job, storage, DTO, route; STE-inspired compose instructions; deferred work as an agent-written object, never rewritten | Yes (one bump, read the current number at execution time) | Shared release, including web, iOS, and connector adoption of the deferred-work object |
| 3 | Web and desktop: Mission summary section above Artifacts | No (consumes phase 2) | Shared release |
| 4 | iOS: Mission summary section above Artifacts; existing deliveries stack untouched | No (consumes phase 2) | Shared release |

These are implementation phases within one release, not independently shipped changes. Removal of the old sections and introduction of their replacements ship together.

Phase 1 can start before coo:1199 is finished only if it touches no file-change code; it does not. Phases 2 to 4 wait for coo:1199.

## 3. Phase 1: trim the web objective accordion

### 3.1 What changes

`webapp/web/components/DeliverySummaryCard.tsx` exports `DeliveryPresentation`, which today renders, in order: pending notice, markdown, follow-up actions (`humanActions`), tradeoffs (`tradeoffsMade`), known risks, deferred work with `DeferredWorkItem` controls, assumptions, and the full-text accordion. `webapp/web/components/objectives/ObjectiveEvidenceSections.tsx` wraps it as `MissionDeliveryCard` per run and renders `LiveFileChangeList` as its own section beneath it.

Add a `variant` prop to `DeliveryPresentation`:

- `objective` renders pending notice, markdown, tradeoffs, known risks, assumptions, full-text accordion. Human actions and deferred work are the only sections removed.
- `full` renders what it renders today.

Consumers (use `objective` only for summary-eligible missions; otherwise retain `full`):

- `ObjectiveEvidenceSections.tsx` passes `objective` for every run in `complete`, `active`, and `history` modes.
- `UnassignedEvidenceSection.tsx` (deliveries whose objective was deleted) passes `objective`. Its actions and suggestions are included by the mission-wide summary evidence selection (§5.5), so the shared release retains access to them.
- `LiveActivityFeed` and any other caller inside `MissionPanel.tsx` pass `objective`. A caller outside the mission panel, if one exists at implementation time, keeps `full` until phase 3 and is listed in the delivery notes.

The files-changed section is already separate and already compact after coo:1199. Do not touch `LiveFileChangeList`.

### 3.2 Tradeoffs stay in the objective card

Tradeoffs are per-objective decisions and are not summarised at mission level, so the objective card keeps rendering them exactly as today. Only the two blocks that move to the mission summary leave the card.

### 3.3 Tests and acceptance

- Update `DeliverySummaryCard` and `ObjectiveEvidenceSections` tests: an `objective` card with a report that has actions and deferred work renders neither heading; tradeoffs, risks and assumptions still render; the full-text accordion still opens.
- `ObjectiveEvidenceSections` row counts (the `n files` label) unchanged.
- Realtime: a `human_action_resolution` change still invalidates the deliveries query (`webapp/web/lib/realtime-invalidation.ts` case stays), because phase 3 will read resolutions from the same query.
- No contract, backend, or iOS change.

## 4. Phase 2: backend, compose, and contract

### 4.1 Contract

Bump the contract once for this phase. Read the current version in `CONTRACT.md` at execution time; do not hard-code it. Update `CONTRACT.md`, `contract/components.yaml`, `packages/contract/src/index.ts`, and the database schema reference. The change summary covers §4.2 to §4.7 below.

### 4.2 Mission summary storage

Persist a `summary_enabled` marker on missions: existing rows are false at migration; every mission created after the cutover is true, including duplicated missions. This is a creation-time decision, not inferred from whether a summary row exists. Old missions remain ineligible even after later deliveries; do not backfill them or enqueue summary jobs for them. Clients hide the summary on ineligible missions and retain the full delivery presentation.

New table `mission_summaries`, one row per eligible mission, replaced in place:

| Column | Notes |
| --- | --- |
| `mission_id` PK, FK missions cascade | |
| `workspace_id`, `project_id` | denormalized for scoping, same pattern as `human_action_resolutions` |
| `revision` integer | increments on every write |
| `requested_generation` integer | increments transactionally on every eligible compose trigger, including while a job is running |
| `completed_generation` integer | generation represented by the last published result; initially 0 |
| `status` | `pending`, `composed`, `fallback` |
| `headline` text | one sentence |
| `summary_markdown` text | two to five sentences |
| `risks_json` | array of `{ deliveryId, objectiveId, index, text }`; `text` is the model's bounded rewrite or the original string |
| `suggestions_json` | array of `{ deliveryId, objectiveId, actionId }` in display order; includes unresolved and promoted items while their source remains eligible; fields are read from the delivery's deferred-work object at projection time, never copied |
| `source_delivery_id` nullable | the delivery whose compose triggered this row, null for a non-delivery trigger |
| `generated_by` | `deterministic`, `gemini` |
| `generated_at`, `model` nullable | |
| `created_at`, `updated_at` | |

Both SQLite and PostgreSQL migrations. Regenerate Kysely types. Writing the row records an `entity_changes` row with `entityType = 'mission_summary'`, `entityId = mission_id`, `missionId` set, so both clients invalidate on it.

### 4.2a Seen marker for the new-item dot

New table `mission_summary_seen` with `mission_id`, `workspace_user_id`, `seen_at`, primary key on the pair, both FKs cascading. `PUT /api/missions/:id/summary/seen` accepts a watermark for the evidence actually displayed for two seconds and returns `{ seenAt }`. Validate the watermark against the caller-authorized evidence snapshot; never substitute the request time. Upsert monotonically so retries or another device cannot move it backwards. The summary read supplies a snapshot watermark tied to the returned evidence; newly available but not rendered evidence must not be acknowledged by an older snapshot. The summary route (§4.3) includes the caller's `seenAt | null`. No entity change is recorded for a seen write; it only affects the caller's own view and the client updates its cache locally. Per-user rather than per-mission so a second workspace user does not clear the first user's dots.

### 4.3 Mission summary DTO and route

```ts
export interface MissionSummaryDto {
  missionId: string;
  revision: number;
  status: 'pending' | 'composed' | 'fallback';
  headline: string;
  summary: string;                 // markdown
  risks: MissionSummaryRiskDto[];
  suggestions: MissionSummarySuggestionDto[];
  sourceDeliveryId: string | null;
  generatedBy: 'deterministic' | 'gemini';
  generatedAt: string | null;      // null in the first pending shell
  model: string | null;
  /** When the calling user last opened this summary; null before the first visit. */
  seenAt: string | null;
}
export interface MissionSummaryRiskDto { deliveryId: string; objectiveId: string; text: string; }
export type MissionSummarySuggestionDto = {
  deliveryId: string; objectiveId: string; actionId: string;
  title: string;                   // verbatim agent title in either state
} & (
  | { state: 'open'; change: string; location: string; doneWhen: string; resolution: null }
  | { state: 'resolved'; resolution: HumanActionResolutionDto }
);
```

`GET /api/missions/:id/summary` returns an envelope with `eligible`, `summary: MissionSummaryDto | null`, and the evidence snapshot watermark used by the seen write. This distinguishes an old, ineligible mission from an eligible mission awaiting its first compose. A question can trigger the first compose before any delivery. Resolved suggestions return only identity, title, state, and resolution (including outcome and target reference); dismissed suggestions are omitted. Do not return their change, location, or done criteria. Retain promoted rows while their source delivery remains eligible. Read projection excludes risks and suggestions whose source has become ineligible, including during a pending recompose. Reuse mission read authorization. It is not folded into `MissionDetailDto`, so the detail payload does not grow and the summary can refresh on its own invalidation.

**The summary is an operator surface only.** It is never sent to agents. `load-context`, the mission packet an agent receives when an objective launches, the hosted and local MCP tools, and the CLI protocol commands do not expose it, now or as a planned follow-up. Everything the summary says is derived from deliveries, objectives, resolutions, and agent requests that the mission packet already carries, so sending the summary as well would duplicate that context in a less precise form. Agents that need prior context keep reading the deliveries and objectives directly.

### 4.4 Mission summary compose job

New worker job type `overlord.mission.summary.compose.v1` in `packages/core/service/worker-jobs.ts`, with an `enqueueMissionSummaryComposeJob({ ctx, missionId, reason })` helper. Coalesce jobs by `missionId`, but never discard a trigger: atomically increment `requested_generation` on every trigger, even while a job is queued or running. Set `status = pending`, bump revision, and emit a `mission_summary` change in that transaction, retaining previous content. The first trigger creates a pending shell with empty text/lists, `generatedBy = deterministic`, and null generation time/model. The worker captures the requested generation with a consistent evidence snapshot. Publication checks that generation transactionally; if it changed during generation, discard the stale draft and repeat from current evidence. Coordinate publication and job completion with enqueueing under the same mission lock or equivalent transactional protocol: a trigger either belongs to the worker's next pass or leaves a queued successor. A crash/retry must retain the outstanding counter difference. The existing queued/running dedupe predicate alone is insufficient. Add the job type to the `worker_jobs` core-types line in `contract/components.yaml`.

Triggers, each calling the helper inside the same transaction as the write it follows:

1. `backend/delivery-compose-worker.ts` after it persists a `composed` or `fallback` presentation (not on `pending`). This serialises the mission summary after the per-delivery compose, so the summary always reads composed markdown.
2. Deferred-work resolution write (`backend/deferred-work-resolutions.ts`), on create and delete.
3. Agent request created, answered, or expired, where the request was a question or structured choice on an objective of the mission (the request creation service and the service that updates `agent_requests.status`).
4. Objective reopened: changing `reopenedAt` changes which deliveries are eligible.

Not a trigger: a seen-marker write (§4.2a), other objective state changes alone, file-change sync, notes. The running-objective sentence is derived on the client (§5.2), so it does not need a recompose. Human actions have no operator state (§4.6), their list changes through delivery supersession or objective reopening.

New worker `backend/mission-summary-compose-worker.ts`, registered beside `deliveryComposeWorker` in `backend/index.ts`, same `WorkerJobPoller` pattern, same bounded metric logging without prompt content. Steps:

1. Load the mission (title, status type, bounded constraints and acceptance criteria), all non-deleted objectives (display key, title, state, `reopenedAt`), eligible deliveries selected before presentation limits (§4.4a), resolutions for those deliveries, open agent requests for the mission, and the previous `mission_summaries` row.
2. Split deliveries into current-run and superseded per objective using the `reopenedAt` rule. Superseded deliveries contribute nothing.
3. Build the model input (§4.5). Call Gemini through a new `composeMissionSummaryWithGemini` in `automations/src/compose-mission-summary/`, same `generate` override hook as the delivery composer so tests inject a generator.
4. Reconcile the draft in a new pure module `packages/core/service/mission-summary-compose.ts`, unit-tested: drop any risk whose source ref does not match the evidence, bound text lengths, fall back deterministically when the draft is null or the provider is not configured. Suggestions are never part of the draft: the worker retains unresolved and promoted deferred-work references from eligible current-run deliveries, newest delivery first, deduped by normalised `title`; dismissed items are hidden and promoted items project to compact resolved rows. Only unresolved items enter the model context. Deterministic fallback for the model-written parts: headline is the one-sentence summary of the newest current-run delivery (port the existing web helper), summary is the latest-per-objective one-liners joined (at most three), risks are the latest-per-objective `knownRisks` deduped by normalised text. If no eligible delivery exists yet, use a deterministic headline and summary describing the open question or running objective, or an awaiting-delivery message when neither exists; do not dereference a missing newest delivery.
5. In the guarded publication transaction, verify `requested_generation` still matches the captured generation, write the result, set `completed_generation`, bump revision, and record the entity change. If the counter changed, keep pending and compose again rather than publishing the stale result.

Failure handling mirrors the delivery worker: retry with the queue's backoff, and on final failure build and persist a deterministic `fallback` from current evidence using the same generation guard, so an older attempt cannot clear a newer pending request.

### 4.4a Select evidence before limiting it

`MISSION_EVIDENCE_LIST_LIMIT` is currently 200 delivery records across a mission, not per objective. The existing mission-deliveries query applies that cap newest-first before client derivation. Do not use that capped page as the summary's evidence source: 200 newer deliveries from busy objectives could hide another objective's still-current delivery.

Select current-run eligibility and the latest eligible delivery per objective in the database before applying any global presentation/model bounds. Suggestions use their own current-run eligibility selection because they can span multiple deliveries. Preserve unassigned delivery evidence (§5.5). Apply the same selection to the web/iOS summary actions and sources, not just the compose worker: provide a shared service projection through an operator read surface and add its DTO to the phase 2 contract. Do not derive summary completeness from the ordinary capped delivery feed. Keep the existing feed and agent-context loading behavior outside this change.

If the selected evidence itself exceeds a bound, return explicit totals/truncation metadata and display that limitation rather than implying a complete list. The model's text budget is separate from the selection of operator actions and suggestions.

### 4.5 What Gemini receives and returns for the mission summary

Input, all bounded, JSON in the prompt body in this order:

- mission: title, status type, constraints (2,000 chars), acceptance criteria (2,000 chars)
- previous summary: headline and summary text, or null; the instruction says to update it, not restart
- objectives: `[{ key, title, state, latestDelivery: { deliveryId, deliveredAt, firstParagraph (600 chars) } | null }]`
- newest delivery: composed markdown in full (3,000 chars) with its objective key
- open actions: `[{ ref: "<deliveryId>:<actionId>", objectiveKey, action, reason, blocking, category }]` from the latest current-run delivery per objective
- open questions: `[{ requestId, objectiveKey, prompt (400 chars) }]`
- pending suggestions, for context only: `[{ objectiveKey, title }]` unresolved deferred-work items across current-run deliveries, so the summary can mention that work is waiting without restating it
- known risks: `[{ ref: "<deliveryId>:<index>", objectiveKey, text }]` across current-run deliveries, deduped by normalised text, newest kept
- counts: deliveries, distinct file paths (from `changed_files` for the mission; after coo:1199 this is paths only, no diff stats)

Response schema (`responseMimeType: application/json`, same client and model settings as the delivery composer):

```
headline: string (<= 140 chars)
summary: string (markdown, 2 to 5 sentences)
risks: [{ ref: string, text?: string }]      // only significant ones; may be empty
```

The model never returns actions, suggestions, or files; those are derived. Suggestions are the agent's deferred-work objects as written (§4.7). Reconciliation drops any `ref` not in the input.

System instruction, mission summary (new):

- Write for the operator who owns the mission. Say what is done, what is in flight, what is blocked, and what is waiting on them, in that order.
- The headline names the single most important fact right now. Prefer the newest delivery unless an open blocking action or question outranks it.
- Keep a risk only when it can change what the operator does next or hides a real follow-up. Drop routine caveats.
- Use only facts in the evidence. Never invent files, commands, or state.
- Follow the writing rules in §4.8.

### 4.6 Human actions carry no operator state

Human actions are shown, never ticked off. Contract v150 deleted reported-human-action resolutions and this plan does not bring them back: no table change, no route, no `DeliveryDto` addition. An action stays in the list until the delivery that reported it is superseded, which happens when the objective re-delivers (the v136 rule: a re-delivery replaces its predecessor's list) or is reopened. If an operator has done the work and the agent has not re-delivered, the action remains visible; that is accepted.

Agent questions leave the list when the request is answered or expires, because the request service changes `agent_requests.status`.

### 4.7 Delivery compose changes

In `automations/src/compose-delivery/compose.ts` and `packages/core/service/delivery-compose.ts`:

- **Deferred work becomes a structured object the agent writes.** The agent is the only party with the code in front of it, so it writes the item and nothing rewrites it. `DeliveryAgentReportV1.deferredWork` changes from `string[]` to `DeferredWorkV1[]`:

  ```ts
  export interface DeferredWorkInputV1 {
    /** Imperative, at most 80 characters. Shown as the row title. */
    title: string;
    /** The specific change that is needed. One or two sentences, at most 400 characters. */
    change: string;
    /** Where to find it: file, function, component, or command. At most 200 characters. */
    location: string;
    /** Concise done criteria: the observable result, one sentence, at most 200 characters. */
    doneWhen: string;
  }
  export interface DeferredWorkV1 extends DeferredWorkInputV1 {
    /** Stable delivery-local id, same derivation as today (index plus digest of the canonical object). */
    id: string;
  }
  ```

  `DeliveryPresentationV1.deferredWork` carries the same objects. `DeliveryDeferredWorkItemDto` gains `title`, `change`, `location`, and `doneWhen` beside `actionId` and `resolution`; its `action` field is removed. The deferred-work resolution routes are unchanged. String items are rejected with `invalid_input` by `deliver` and `record-work`; there is no legacy compatibility, because every connector moves to the new guidance on deploy. Update `contract/delivery-report-v1-fixtures.json`, the normalisation, salvage, and persisted-report schemas in `packages/core/service/delivery-report.ts` and the validation entry points in `packages/core/service/protocol.ts`, the `action_id` digest input, `filterDeferredWork` and `deferredWorkTextsOverlap` (compare on `title + change`), the search-document body builder, the CLI `--payload-json` validation, the MCP catalog, the web `DeferredWorkItem` component, and iOS `Contract.swift` decoding.

- **Historical deferred work is dropped.** In both database editions, clear historical `agentReport.deferredWork` and `presentation.deferredWork` arrays and remove their associated deferred-work resolution records before enabling the new strict read schemas. Preserve every other report field and delivery record. Do not synthesize structured objects or remap old IDs. Refresh affected search documents so discarded suggestions do not remain searchable. New deliveries use the new object and ID shape exclusively.

- **Agent guidance.** Update the three places that instruct agents today, with the same wording in each: `connectors/core/overlord-mission/SKILL.md` (both the deliver paragraph and the Delivery Evidence section), `connectors/core/overlord-mission/reference/record-work.md`, and the `deferredWork` item schema in `packages/contract/src/mcp-tools.ts`. The rule:

  > Each `deferredWork` item is one recommended objective outside this mission. Be very concise. `title` names the work in an imperative phrase. `change` states only the specific change that is needed. `location` says where to find it in the code: the file, function, component, or command. `doneWhen` states the observable result in one sentence. Do not add instructions on how to do the work, background, or rationale. The operator turns the item into an objective or a mission as written, so it must read as a task, not as a note.

  One example pair in the skill, matching the style of the existing human-action example:

  > Vague: `{ "title": "Fix flaky test", "change": "The sync worker has a flaky test.", "location": "backend", "doneWhen": "It passes." }`
  > Good: `{ "title": "Advance the fake clock before the second retry", "change": "The test asserts the retry fired but never advances the fake clock between attempts, so it passes or fails on real time.", "location": "backend/sync-worker.test.ts › retries after a 503", "doneWhen": "The test passes 20 consecutive runs with the fake clock driving both attempts." }`

  The existing exclusions stay: never queued future objectives, never leftover slices of the current objective, never human follow-up. Bump connector and shared-skill versions per the `connector-versions` skill and regenerate the MCP catalog and capabilities.

- **The delivery composer no longer sees deferred work.** Remove the DEFERRED WORK rules block from `SYSTEM_INSTRUCTION`, remove `deferredWork` from `COMPOSE_DELIVERY_RESPONSE_SCHEMA` and its `required` list, and remove `deferredWork` and `omittedDeferredWork` from the prompt body. The reconciler sets `presentation.deferredWork` to the eligible agent objects. Eligibility filtering (`filterDeferredWork`) stays; it removes items that restate planned work or human follow-up, it does not edit them. This reverses the rewrite rule introduced for deferred work in an earlier contract version; the change summary says so.

- **STE-inspired writing rules** (§4.8) are added to the delivery composer's system instruction and apply to `markdown`, `humanActions.action` and `reason`, `tradeoffsMade` text, `knownRisks`, and `assumptions`. They do not apply to deferred work (never in the prompt), to `command`, `verify`, `link`, file paths, identifiers, or quoted agent text.
- The composer's input loses `changeRationales` (coo:1199 removes it) and gains nothing new. The deterministic path and the `pending` to `composed | fallback` lifecycle are unchanged.

### 4.8 Writing rules shared by both composers

Loosely based on ASD-STE100. These go into both system instructions as a short list; they are guidance, not a checker.

- One topic per sentence. Keep sentences short: about 20 words for an instruction, about 25 for a description.
- Use the active voice and name the actor: "The migration adds a table", not "A table is added".
- Use the present tense for state and the simple past for what the agent did.
- Use the imperative for anything the operator must do: "Run the test suite", not "The test suite should be run".
- Use one term for one thing throughout a message. Do not vary vocabulary for style.
- Prefer short, common words. Avoid noun stacks longer than three words; rewrite "delivery compose worker fallback path" as "the fallback path of the compose worker".
- Keep articles ("the", "a"). Do not drop them for brevity.
- No idioms, no hedging filler, no marketing adjectives.
- Technical names, commands, paths, and quoted agent text are exempt and are copied exactly.
- When the evidence is unclear, say that it is unclear. Do not smooth it over.

### 4.9 Tests and acceptance

- `packages/core/service/mission-summary-compose.test.ts`: run and supersession split; latest-per-objective selection; action and risk dedupe; suggestion listing and dedupe by normalised title; reconciliation drops unknown refs; deterministic fallback shape; bounds.
- Deferred-work shape: `protocol.ts` normalisation rejects string items and over-long fields with `invalid_input`; the stable id derivation is covered by a fixture in `contract/delivery-report-v1-fixtures.json`; `filterDeferredWork` overlap tests use `title + change`; CLI payload validation and the MCP catalog schema match.
- `backend/mission-summary-compose-worker.test.ts` with an injected generator: composed row written with revision bump and entity change; null draft yields `fallback`; a resolution trigger composes with `sourceDeliveryId` null; queued triggers coalesce but increment the request counter; a trigger during generation causes a fresh pass; a trigger at publication/job-completion cannot be lost; retries preserve outstanding generations; stale attempts cannot overwrite a newer result. Cover delivery, resolution, reopening, and new/answered/expired question triggers. Assert pending notification precedes generation, prior content is retained, and first pending shells have null `generatedAt`.
- `backend/delivery-compose-worker.test.ts`: after a composed presentation the mission summary job is enqueued; `pending` does not enqueue.
- `packages/core/service/delivery-compose.test.ts`: deferred work in the presentation equals the eligible agent objects regardless of what the draft returned; the prompt body contains no deferred-work section.
- Seen route tests: idempotent monotonic writes scoped to the caller; validate displayed snapshot watermarks; an older snapshot cannot acknowledge unseen newer evidence; another user retains their own baseline.
- Migration tests on both editions: old deferred work and its resolutions are removed; other report evidence survives and parses; old missions remain ineligible after new deliveries; newly created and duplicated missions are eligible.
- Evidence selection tests: more than 200 deliveries concentrated on one objective do not hide another objective's latest eligible delivery or suggestions; test explicit truncation after selection.
- Suggestion projection tests: promotion survives recomposition as title plus resolution/target; details are omitted, dismissal hides the row, and supersession removes ineligible references.
- Conformance: `yarn test:conformance` on both database editions for the new tables, mission eligibility marker, and historical deferred-work migration.
- Prompt fixtures: one before-and-after sample per composer under `automations/src/**/fixtures` showing the STE-inspired rewrite, used in a snapshot-free assertion that the instruction text contains the rule list and that deferred work is untouched.

## 5. Phase 3: web and desktop Mission summary section

### 5.1 Placement and files

`MissionPanel.tsx` gains one `<div className="space-y-3">` with the uppercase `h2` and the new section, between `MissionTerminalSessionsSection` and the Artifacts block. Nothing above or below moves. Desktop consumes the shared SPA; audit for independent renderer references only.

New components under `webapp/web/components/mission-summary/`:

- `MissionSummarySection.tsx`: container; owns the summary query, the derived blocks, expand state, and the updating strip.
- `MissionSummaryHeader.tsx`: the `MISSION SUMMARY` label and the `as of … · from n deliveries` trailer.
- `MissionSummaryPost.tsx`: headline, status chip, summary markdown, sources line.
- `MissionSummaryActions.tsx`: the blue-tinted checklist.
- `MissionSummarySuggestions.tsx`: the purple-tinted accordion rows.
- `MissionSummaryRisks.tsx` and `MissionSummaryFiles.tsx`.
- `lib/mission-summary-derive.ts`: pure derivations below, unit-tested.

Reuse `Markdown`, `HumanActionDetails`, the `ring-2` highlight, the `?objective=` scroll logic, and the outline control class from `DeferredWorkItem.tsx` (violet-300 border, violet-800 text, white/70 fill).

### 5.2 Data and derivation

Queries already on the panel: mission detail, deliveries, file changes, agent requests. Summary actions and sources use the eligible evidence projection in §4.4a, not the capped delivery feed. New: `useQuery(['mission-summary', missionId])` on `GET /api/missions/:id/summary`, invalidated by the `mission_summary` entity change (add a case to `realtime-invalidation.ts`).

Derived on the client from those queries, memoised on their arrays:

- **Status chip** from `mission.statusType`: `In review`, `Executing`, `Blocked`, `Complete`, `Draft`. Colour plus text; never colour alone.
- **Running sentence**: for each `executing` or `pending_delivery` objective, `{title} is running.` or `{title} is waiting on a question.` when it has an open request. Appended after the composed summary so the summary stays correct between composes.
- **Sources line**: objective keys of current-run deliveries, newest first, `live` marker on executing ones.
- **Your actions**: latest current-run delivery per objective → `report.presentation.humanActions`; open agent requests of kind question or structured choice. No row for reviewing the mission itself; the status chip already says it is in review. Blocking first, then newest delivery first, then report order. Deduped across objectives by normalised action text, newest kept. There is no done state and no checkbox (§4.6); the leading column is the kind glyph.
- **Suggestions**: from the summary DTO, unresolved first. Collapsed row: `title` on the first line, `location` in mono on the meta line with the objective key. Expanded: `change` as plain text, a `Done when:` line with `doneWhen`, then the two outline buttons and Dismiss. Resolved ones render only their title and the `Added as coo:…` line using `resolution.outcomeRef`, with no detail accordion; dismissed ones are hidden. No model text anywhere in this block.
- **Risks**: from the summary DTO. When the DTO is `fallback`, the list is the deterministic one from §4.4; the heading still reads `Risks`.
- **Files changed**: distinct `FileChangeDto` rows across the mission, grouped and ordered by `observedAt` desc, capped at six chips collapsed. Chip content after coo:1199: provenance badge (`N` native for `declared_edit`, `D` for `agent_declared`, `?` for null) instead of the add/modify/delete letter, directory in muted mono, basename, and the resource key when the mission spans more than one resource. **No line counts**: the DTO has none, and the coo:1199 plan rules out per-file metadata. The canvas shows `+n −n`; drop them. Label the block `Files changed · {total}` with the cumulative caveat on hover.
- **New-since-last-visit dot**: capture `seenAt` once as the immutable visit baseline when the section mounts. An action, question, suggestion or risk carries the dot when its introducing delivery or request is newer than that baseline. A null baseline gives no dots for the first visit. Keep the baseline separate from cached/persisted `seenAt`, so writes and refetches do not clear dots during the visit. After a displayed evidence snapshot has remained visible for two seconds, acknowledge its watermark (§4.2a), not the wall-clock request time. New evidence starts its own visibility period; navigation/unmount cancels unfinished periods. Advance the cache monotonically without altering the visit baseline. On the next mount use the saved watermark as the new baseline. No dot on the headline or summary text.

### 5.3 Interactions

- Action rows expand to show `HumanActionDetails` (command, verify, link). The key link scrolls to the source objective row. Nothing is written.
- Question rows link to the objective row where the answer composer lives.
- Suggestion header toggles the accordion. `+ Objective on this mission` and `+ New mission` call the existing deferred-work promotion mutations; the created objective or mission takes `title` as its title, `change` plus `location` as its instruction, and `doneWhen` as its acceptance criteria, verbatim. `Dismiss` calls the dismiss mutation. All three reuse `DeferredWorkItem`'s handlers, not new endpoints.
- Objective key links scroll to and `ring-2` highlight the objective row and open it, through the generalised `?objective=` logic. They do not change the accordion's own expand state beyond opening it.
- `Previous summaries` is a disabled ghost control in phase 3 with a tooltip; history is not stored.

### 5.4 States

- Ineligible mission: hide this section and keep the existing full delivery presentation.
- Eligible mission with no summary row and no running objective: header only, dashed card, "The summary appears after the first delivery."
- Eligible mission with no summary row, objective running: dashed card with the running sentence.
- First pending shell: show the updating strip with no generated text/date; include any running sentence.
- `pending` with previous content: previous content at 55 percent opacity under the blue updating strip naming the source objective when `sourceDeliveryId` is set.
- Summary error: header, then the existing error sentence pattern.
- No open actions: single line `No open actions`.

### 5.5 Unassigned delivery evidence

For eligible missions, deliveries whose objective was deleted (the Unassigned evidence section) move their actions and suggestions to the summary in the same release. The mission summary's action and suggestion lists include them because they derive from deliveries by mission, not by objective; they render with the title `Delivery` and no key, as the original spec described.

### 5.6 Tests and acceptance

- `mission-summary-derive.test.ts`: every rule in §5.2 with fixtures for a review mission with four deliveries across three objectives, one superseded delivery, one deleted objective, one open question, and a `seenAt` between the second and third delivery so the dot rule is exercised.
- Component tests: dots persist after seen writes/refetches, clear on the next visit, and do not acknowledge evidence arriving before it has been displayed for two seconds; old missions hide the summary and retain full cards; promoted rows remain compact after recomposition. The five blocks render per the canvas; empty, pending, and error states; action detail expansion; accordion open state; chip truncation at 375 px.
- Acceptance walk: the canvas board *Web · summary, review mission* matches a seeded mission; a re-delivery on an objective replaces that objective's actions without reload; accepting a suggestion as an objective adds a future objective and collapses the row to `Added as`; a new delivery shows the updating strip, then the new headline; nothing above the section or below it changes in markup.

## 6. Phase 4: iOS Mission summary section

### 6.1 Placement and files

In the OverlordMobile repository. `MissionDetailContentView.swift` renders, in order, notes, `artifactsBlock` (when non-empty), `MissionDeliveriesSectionView`, `activityBlock`, `fileChangesBlock`. Insert `MissionSummarySectionView` immediately before `artifactsBlock`. Leave `MissionDeliveriesSectionView` and everything after it untouched.

New under `Overlord/Views/MissionDetail/`:

- `MissionSummarySectionView.swift`: container, loads the summary and owns expand state.
- `MissionSummaryPostView.swift`, `MissionSummaryActionsView.swift`, `MissionSummarySuggestionsView.swift`, `MissionSummaryRisksView.swift`, `MissionSummaryFilesView.swift`.

In `OverlordCore`:

- `Contract.swift`: `MissionSummaryDto`, `MissionSummaryRiskDto`, `MissionSummarySuggestionDto`; decoding tests in `OverlordTests/ContractV<n>Tests.swift` following the existing per-version files.
- `MissionSummaryDerive.swift`: the §5.2 derivations as pure functions with tests, so the watch and widgets can reuse the headline later.
- `MissionReloadHub.swift`: add `mission_summary` to the entity types that reload the mission screen, beside `human_action_resolution`.
- API client: `GET /api/missions/:id/summary` and `PUT /api/missions/:id/summary/seen`; the same two-second viewport rule as web for the seen write.

Reuse `DeliveryPresentationView`'s accent-section builders for tints, `DeferredWorkItemView`'s promotion and dismiss handlers, `MissionMarkdownView`, and `MissionFeed.deliveryOneSentenceSummary` for the fallback headline.

### 6.2 Layout per the canvas

- 18 pt white card; sub-blocks separated by hairlines; `Your actions` on the light blue tint, `Suggested next` on the light purple tint.
- Action rows: title, meta line with kind chip, reason and key, trailing chevron. No checkbox. Tapping the row expands the details; the key opens the objective.
- Resolved suggestions: title plus resolution/target only, with no expanded details; dismissed suggestions are hidden.
- Open suggestion rows: header is `title` with `location` in mono beneath and a chevron; expanded body is `change` and a `Done when:` line behind a purple rule, then two outline buttons side by side at full width (violet border and text), then `Dismiss`.
- Risks: glyph, text, short key.
- Files: wrapping chips with provenance badge, directory, basename, and a dashed `+n more` chip; no line counts (§5.2).
- Filters and the horizontally paging card strip from the earlier spec are gone; the summary has no filters.

### 6.3 Tests and acceptance

- `OverlordTests/MissionSummaryDeriveTests.swift` mirrors the web derivation tests on the same fixture.
- Contract decoding tests for the eligibility envelope, nullable summary/generation time, and open/resolved suggestion union.
- Snapshot or preview fixtures under `OverlordCore/PreviewData.swift` for populated, updating, all-clear, and before-first-delivery states.
- Acceptance walk on the simulator: the canvas board *iOS · summary* matches a seeded mission; suggestion actions round-trip; the existing deliveries stack, activity, and file changes blocks render exactly as before.

## 7. Order inside each phase

1. Contract first where a phase has one (phase 2), with fixtures and decoding tests before any service code.
2. Pure derivation modules and their tests before UI or workers.
3. Storage and routes, with route tests.
4. Workers and automations, with injected-generator tests.
5. UI, with component tests, then the acceptance walk.
6. Docs: CLI protocol docs are unaffected; update the mission-data-webhooks reference only if the delivery envelope changes (it does not in this plan), update the shared skill instructions for deferred-work wording (phase 2), and `CONTRACT.md`. The `load-context` documentation gains one sentence stating that the mission summary is not part of the agent packet.

## 8. Compatibility with coo-1199 change tracking

| coo:1199 decision | How this plan respects it |
| --- | --- |
| `FileChangeDto` is exactly `id, missionId, objectiveId, resourceKey, filePath, source, observedAt, hookHealth` | Files chips use only these. No line counts, no add/modify/delete letter; the badge is provenance. Basename derived on the client. |
| Lists are cumulative objective evidence, not a diff | The summary's files block is labelled cumulative and never implies a snapshot. Counting distinct paths across objectives follows the same rule. |
| Per-file rationale, `vcsStatus`, window metadata removed | Neither composer receives `changeRationales`; the mission summary composer receives path counts only. |
| Composer may condense narrative and report facts, never infer from filenames | The STE-inspired rules are about sentence form. Both system instructions keep the "use only facts in the evidence" rule and the deterministic fallback. |
| Keep structured verification, operator actions, decision-level tradeoffs | Human actions move surfaces (objective card to mission summary) but keep their stable ids and the compose-worker merge; they gain no operator state. Tradeoffs stay on the objective card unchanged. |
| Realtime refresh on changed-file and session diagnostics after removing rationale kinds | Untouched. This plan adds `mission_summary` and reuses `human_action_resolution`; it removes nothing. |
| Single breaking cutover, no aliases | This plan's contract bump follows the same rule: the deferred-work object replaces the string shape with no alias and no dual acceptance, and the composer stops rewriting. Everything else is additive. |
| Mobile ships against the new contract | Phase 4 decodes the phase 2 DTOs and the coo:1199 `FileChangeDto`; it does not touch the deliveries stack that coo:1199 updates for file changes. |

## 9. Non-goals

- No agent-facing exposure of the mission summary (§4.3). Any suggestion to add it to `load-context`, the mission packet, MCP, or the CLI is out of scope and should be declined in review of later work too. The sample suggestion text on the canvas that proposes this was placeholder copy and is not a product intent.
- No summary history. `Previous summaries` is a disabled control until a history table exists.
- No change to the iOS deliveries stack; that is a later follow-up.
- No webhook event for the summary.
- No done or dismissed state on human actions (§4.6).

## 10. Open questions for the reviewer

None. Review decisions: use a transactional requested-generation counter; drop historical deferred work and its resolutions; ship all phases together; recompose on reopening and new questions; retain promoted suggestions as title plus resolution; enable summaries only for newly created missions; publish pending immediately while retaining previous content; freeze each visit's dot baseline and acknowledge only displayed evidence; select eligible evidence before applying limits. Earlier decisions remain: tradeoffs stay on the objective card, the new-item dot ships in phase 3, human actions carry no done state, and there is no review-this-mission row.

## 11. Pre-implementation review (2026-10-24)

A check of this plan against the code at contract 165 (uncommitted coo:1199 work in the main checkout) found the issues below. Each has a resolution that implementers follow; where this section and an earlier section disagree, this section wins. Where the plan and the canvas disagree, the plan wins (the canvas notes still mention human-action resolutions as a trigger and the boards show `+n −n` line counts; both are stale).

### 11.1 Blocking

1. **coo:1199 has not landed.** Its objective `coo:1199.51jn` is executing and `coo:1199.k85p` (final validation) is a draft. Its changes, including the contract 165 bump, are uncommitted in the shared main checkout. No phase of this plan starts until coo:1199 is complete and its changes are committed. §2's "phase 1 can start early" no longer holds: `ObjectiveEvidenceSections.tsx` and `DeliverySummaryCard.tsx` both carry uncommitted coo:1199 edits.
2. **Phase 1 depends on phase 2.** Phase 1 chooses the `objective` variant only for summary-eligible missions, but `summary_enabled` arrives in phase 2. Implement the phase 2 contract and storage first, then the phase 1 trim together with phase 3. The release stays shared, so this changes only the order of work.
3. **The evidence projection has no defined shape or route.** §4.4a requires a shared projection of summary actions and sources, through an operator read surface with a contract DTO, but defines neither. Resolution: fold it into the `GET /api/missions/:id/summary` envelope, which becomes `{ eligible, summary, evidence, watermark }`. `evidence` holds `actions` (each human action of the latest current-run delivery per objective, with `deliveryId`, `objectiveId`, `actionId`, the full `HumanActionDto` fields, `deliveredAt`), `sources` (`{ objectiveId, deliveryId, deliveredAt }` newest first; a client renders an `objectiveId` that is not among the mission's live objectives as the unassigned `Delivery` row of §5.5), and `truncated: { actions: boolean, sources: boolean }` with totals. Open agent questions still come from the existing agent-requests query. One route keeps one invalidation (`mission_summary`) plus the existing `delivery` and `agent_request` invalidations for the same query key.
4. **The seen watermark is undefined.** Resolution: the watermark is the ISO time of the newest evidence item in the returned envelope (max of delivery `deliveredAt` and open agent request `createdAt` among the items returned). `PUT …/summary/seen` accepts `{ watermark }`, rejects a value later than the caller's current authorized evidence maximum, and stores `max(existing, watermark)`.

### 11.2 Plan corrections

5. **Missions have no constraints or acceptance criteria.** Migration `20260807120000_mission_notes_and_field_cleanup` dropped `acceptance_criteria_text`; no constraints field exists. Remove both from the worker load (§4.4 step 1) and the model input (§4.5). The mission input is title and status type only. Do not read mission notes; they are operator scratch text.
6. **Objectives have no acceptance-criteria field.** `CreateObjectiveBody` and `CreateMissionBody.objectives[]` take `title` and the instruction only. Promotion (§5.3, and the same on iOS) sets the title to `title` and the instruction to `change`, a blank line, `Location: {location}`, a blank line, `Done when: {doneWhen}`, verbatim. No contract change.
7. **Agent request kinds and statuses.** The kind is `choice`, not "structured choice" (`AgentRequestKind = 'question' | 'permission' | 'choice' | 'retry'`). Trigger a recompose on creation of a `question` or `choice` request and on every transition out of `open` (`resolved`, `released_to_terminal`, `expired`, `cancelled`), not only on answered and expired.
8. **Webhooks change.** §7.6 says the delivery envelope does not change. It does: the full `mission.delivered` envelope carries `delivery.report` (`DeliveryReportPayloadV1`, built in `packages/core/service/webhook-events.ts`), so `deferredWork` changes shape there too. The contract change summary says so, and phase 2 updates the mission-data-webhooks reference and example consumer.
9. **Eligibility on every creation path.** Implement `summary_enabled` as a column with default true and a migration that sets existing rows to false, so every creation path (REST, protocol `create` and `prompt`, `record-work`, MCP, inbox promotion, and the scheduled duplicate in `createScheduledDuplicateIfNeeded` in `backend/repository.ts`) is eligible without per-path code. Add a test per path that exists at implementation time.
10. **Deferred-work legacy ids.** `deferredWorkEntries` matches `legacyId` as well as `id` (`backend/deferred-work-resolutions.ts`). Historical deferred work is dropped (§4.7), so remove the `legacyId` match and its derivation.
11. **The iOS fallback helper is in the app target.** `MissionFeed.deliveryOneSentenceSummary` is in `Overlord/Lib/MissionFeed.swift`, which `OverlordCore` cannot import. Move the helper into `OverlordCore` (keep `MissionFeed` forwarding to it) before `MissionSummaryDerive.swift` uses it.
12. **iPad.** iPhone and iPad share one SwiftUI target. Phase 4 covers both size classes: check the summary section in the regular-width mission detail layout and in the iPad split view, not only on the phone.
13. **Path fix.** `UnassignedEvidenceSection.tsx` is at `webapp/web/components/`, not `components/objectives/`.
14. **The earlier presentation spec is not in the repository.** §0 cites its §4.1 (runs and supersession) and §8 (accessibility). Use these rules instead. Supersession: a delivery is superseded when it was delivered before its objective's `reopenedAt`, or when a newer current-run delivery exists for the same objective (the newer delivery's human actions replace the older list, the v136 rule). Suggestions and risks still span every current-run delivery. Accessibility: status is colour plus text; every row, toggle and button is a real button or link reachable by keyboard with a visible focus ring; icon-only controls have an `aria-label` (iOS: `accessibilityLabel`); the updating strip is announced as a polite live region; text meets 4.5:1.
15. **The summary is exempt from MCP parity.** `CONTRACT.md` asks for REST and MCP parity on PM surfaces. The phase 2 change summary records the summary and seen routes as an operator-only exemption, per §4.3 and §9.
