# Agent-authored mission summaries: implementation plan

Mission coo:1260, objective coo:1260.e12m. Follows the design assessment delivered in coo:1260.7taz.
Written against contract `172.3.0`.

Scope: the delivering mission only. Correcting another mission's summary is out of scope and is
tracked in mission coo:1278.

**Contract impact: major**

Why major and not minor: the change (a) reverses ADR 0046's guarantee that the summary is "never
sent to agents, now or later", (b) adds a value to the closed `mission_summaries.generated_by`
vocabulary and the `MissionSummaryDto.generatedBy` enum, (c) changes what `headline` and
`summary_markdown` mean (agent-verified account, no longer a model digest of delivery text), and
(d) replaces `human_action_resolutions` and the summary reference lists with a new table, which
changes data meaning and reverses the rule that item text is never copied out of a delivery.
CONTRACT.md section 5 classes each of these as breaking. A major increment needs the owner's
approval (section 7) and a restamp of every conformance manifest.

## 1. Product result

The delivering agent writes the mission's headline and summary as part of `deliver`, starting from
the summary it was given at attach. In the same call it closes earlier risks, human actions and
suggestions that it has verified are no longer true, each with a short reason. People read a
summary that states what the mission has produced, what still limits it and what they must do,
written by the one participant that has seen the repository.

Risks, human actions and suggestions become rows in one table, `mission_items`, each with a
status. A person's decision and an agent's decision are written to the same row, so the summary
panel, the delivery cards and the agent's baseline cannot disagree.

The external model stops being the routine author. It stays only as a fallback for deliveries that
carry no agent summary (older CLI or plugin, hosted MCP clients that omit it, `record-work` without
one).

## 2. What is stale today, and what fixes each part

| Part of the panel | Source today | Why it goes stale | Fix in this plan |
| --- | --- | --- | --- |
| Headline and summary | Gemini, from the previous summary plus bounded delivery prose (`automations/src/compose-mission-summary/compose.ts`) | The model sees no repository state and no other mission | Agent writes them at delivery |
| Risks | Gemini picks from `knownRisks` in delivery JSON; references kept in `mission_summaries.risks_json` | A risk leaves only when its own objective reopens | Rows in `mission_items`; agent or person closes them |
| Human actions | Read-time projection of delivery JSON; no status since contract v150 | An action leaves only when its objective re-delivers or reopens | Rows in `mission_items`; agent or person closes them |
| Suggestions | Deferred work in delivery JSON, minus `human_action_resolutions` rows | A later objective implements the suggestion; nobody dismisses it | Rows in `mission_items`; agent or person closes them |
| Other missions' summaries | Not addressed | A concurrent mission fixes the issue | Out of scope; mission coo:1278 |

## 3. Design

### 3.1 Storage (both editions, one migration name)

#### `mission_items` (new)

One row per risk, human action or suggestion that a delivery reported. One table with a `kind`
column, not one table per kind: the three share a lifecycle, the same reads ("what is open on this
mission") and the same writes (set a status, a reason and who did it). They differ only in content
fields, which live in `detail_json`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Id | Primary key. This is the reference agents and clients use. |
| `workspace_id`, `project_id`, `mission_id`, `objective_id`, `delivery_id` | Id | Denormalized from the delivery. `mission_id` and `delivery_id` cascade on delete. |
| `kind` | text | Closed: `risk`, `human_action`, `suggestion`. |
| `item_ref` | text | Stable identity inside the delivery. Suggestions reuse `DeferredWorkV1.id`. Risks and human actions get `<kind>-<digest of canonical content>`, because their ids in delivery JSON today are positional (`human-action-<n>`, array index). Unique on `(delivery_id, kind, item_ref)`. |
| `position` | integer | Order inside the delivery. |
| `text` | text | Risk text, action sentence, or suggestion title. |
| `detail_json` | Json | Kind-specific fields: `change`, `location`, `doneWhen` for a suggestion; `reason`, `category`, `blocking`, `command`, `verify`, `link`, `source` for an action; `{}` for a risk. |
| `status` | text | Closed: `open`, `done`, `dismissed`, `superseded`. |
| `status_reason` | text, nullable | At most 280 characters. Required when an agent closes an item. Shown to people. |
| `resolved_by_kind` | text, nullable | Closed: `person`, `agent`. Null while `open` or `superseded`. |
| `resolved_by_workspace_user_id` | Id, nullable | Set for `person`. |
| `resolved_by_objective_id`, `resolved_by_delivery_id` | Id, nullable | Set for `agent`. |
| `outcome`, `outcome_ref` | text, nullable | Promotion of a suggestion (`mission_created`, `objective_added`), as on `human_action_resolutions` today. |
| `resolved_at`, `reported_at`, `created_at`, `updated_at`, `revision` | | `reported_at` is the delivery's `delivered_at`. |

Indexes: `(mission_id, status, kind)` for the panel and the attach baseline;
`(project_id, status, kind)` for project-wide reads (coo:1278); unique
`(delivery_id, kind, item_ref)`.

Every write appends an `entity_changes` row with `entity_type = 'mission_item'` and the mission,
objective and delivery ids, so panels and delivery cards refresh.

No database view. The schema has none in either edition, and each caller wants a different slice.
One core read function, `listMissionItems({ missionId | projectId, kinds, statuses, limit })`,
is the single definition of "open" for the panel route, the attach baseline, the delivery DTO and
the fallback composer. Per-mission counts for list screens, if wanted later, are a grouped count
over the same table.

#### Lifecycle rules

- **Write.** `deliverSession` and `recordWork` insert rows from the immediate deterministic
  presentation in the delivery transaction. `persistDeliveryPresentation` reconciles when the
  delivery compose worker saves the final presentation: upsert by `(delivery_id, kind, item_ref)`,
  insert new items (such as `deterministic_rule` actions), and delete rows that are still `open`
  and no longer present. A row someone already closed is never deleted.
- **Supersede.** The current-run rule becomes a stored status in place of a recomputation from
  timestamps. When an objective delivers again, the `open` human actions of its earlier
  deliveries become `superseded` (the v136 rule). When an objective reopens, every `open` item of
  its earlier deliveries becomes `superseded`. The supersession rule in
  `packages/core/service/mission-summary-compose.ts` moves into this writer.
- **Close.** A person or an agent sets `done` or `dismissed`. Promotion of a suggestion sets
  `done` with an `outcome`, as today.
- **Restore.** A person sets a closed item back to `open` and the resolver fields are cleared.
  `superseded` items cannot be restored.
- The delivery JSON is unchanged and remains the record of what the agent reported at the time.
  The table is the live working set.

#### `mission_summaries`

| Column | Type | Meaning |
| --- | --- | --- |
| `content_revision` | integer, default 0 | Increments only when headline or summary is written. This is the concurrency token. The existing `revision` cannot serve: it also moves on every pending notification. |
| `narrative_delivery_id` | Id, nullable | The delivery whose author wrote the current headline and summary. Soft reference. |
| `narrative_objective_id` | Id, nullable | Its objective, for the "Updated by coo:1260.e12m" line. |

`generated_by` gains the value `agent`. `model` then holds the objective's agent model id.
`risks_json` and `suggestions_json` are no longer read or written.

#### Migration and backfill

1. SQL migration in both editions: create `mission_items` and the new summary columns.
2. A migration runtime step in TypeScript (the pattern of
   `database/src/objective-display-key-migration-runtime.ts`) backfills rows from every live
   delivery through the same writer the delivery path uses, applies the supersession rules, then
   copies each `human_action_resolutions` row onto its suggestion row. It is idempotent and
   batched. SQL alone is not suitable: the digests are computed in code and the JSON functions
   differ between SQLite and Postgres.
3. A second SQL migration, ordered after the backfill, drops `human_action_resolutions`,
   `risks_json` and `suggestions_json`. The whole change ships in one production release, so no
   legacy storage or read path is kept.

### 3.2 Attach: the editing baseline

`attach` and `resume-follow-up` responses gain an optional top-level `missionSummary`, present only
when `missions.summary_enabled` is true:

```json
{
  "missionSummary": {
    "contentRevision": 7,
    "headline": "…",
    "summary": "…",
    "author": "agent",
    "openItems": [
      { "id": "<itemId>", "kind": "risk", "objective": "coo:1260.7taz", "text": "…" },
      { "id": "<itemId>", "kind": "human_action", "objective": "coo:1260.7taz", "text": "…", "blocking": true },
      { "id": "<itemId>", "kind": "suggestion", "objective": "coo:1260.7taz", "text": "…" }
    ],
    "truncated": false
  }
}
```

`openItems` is `listMissionItems` for the mission with `status = 'open'`, under the existing
`MISSION_SUMMARY_LIMITS`. On a mission with no summary yet, `headline` and `summary` are empty and
`contentRevision` is 0. `load-context` and `connect` do not carry it (PM decision 6). The seen
marker stays operator-only.

`agentInstructions` (`assembleAgentInstructions` in `packages/core/service/protocol.ts`) gains a
short "Mission summary" block: who reads it, what to write, when to close an item, and the
one-retry rule on conflict (3.4).

### 3.3 Deliver: the write

`deliver` accepts `missionSummary` in `--payload-json` / `--payload-file`, plus
`--mission-summary-file <path|->` for convenience. The hosted MCP `overlord_deliver_session` tool
and `record-work` / `overlord_record_work` accept the same object.

```json
{
  "missionSummary": {
    "baseContentRevision": 7,
    "headline": "One sentence, at most 140 characters.",
    "summary": "Markdown, at most 1,200 characters.",
    "closeItems": [
      { "id": "<itemId>", "status": "done", "reason": "Fixed by the retry guard added in this objective." },
      { "id": "<itemId>", "status": "dismissed", "reason": "The endpoint this warned about was removed." }
    ]
  }
}
```

Inside the existing `deliverSession` transaction, after the delivery insert and the item writes:

1. Lock the summary row (`lockMissionSummaryRow`), creating the shell if absent.
2. Compare `baseContentRevision` with `content_revision`. On mismatch, abort the whole
   transaction (3.4).
3. For each `closeItems` entry, update the row when it belongs to this mission and is `open`:
   set status, `status_reason`, `resolved_by_kind = 'agent'` and the delivering objective and
   delivery. An unknown id, an item of another mission, or an item that is no longer open is
   skipped with a bounded warning; it never rejects the delivery.
4. Write headline, summary, `generated_by = 'agent'`, `narrative_*`, `generated_at`, and bump
   `content_revision` and `revision`.

`closeItems` is accepted without headline and summary, and the reverse. Malformed or over-long
`headline` / `summary`, or a close entry without a reason, is a 400 `invalid_input` before any
write. A delivery with no `missionSummary` behaves as now, apart from the item rows.

Writing guidance for the agent (lives in the instructions block and the connector skill, and is
linted advisorily with `lintSte`, never blocking):

- State what the mission now provides and why it matters, then current limits, then what a person
  must do.
- Say whether a claim is implemented, tested or deployed. Do not merge them.
- Rewrite the whole summary to be true now. Do not append to the previous text.
- Close an item only after checking it in the code or the mission history. Give the reason. Use
  `done` when the item was addressed and `dismissed` when it no longer applies.
- Do not restate open actions or suggestions in prose; they are shown as their own lists.

### 3.4 Conflict

Only an agent narrative write moves `content_revision`, so a conflict means "another objective of
this mission delivered a summary since you attached". Parallel objectives make this a real case.
Closing items never conflicts: a person or another agent closing the same item first only produces
a warning.

Recommended behaviour (PM decision 2): reject the delivery with 409 `mission_summary_conflict`.
Nothing is written. The error body carries the fresh `missionSummary` baseline in the attach
shape. The CLI prints it to stdout. The agent reconciles and delivers again; the instructions
allow one retry, after which it delivers without headline and summary and says so in the delivery
summary, which lets the fallback composer run. Delivery therefore cannot be blocked more than
once by this check.

### 3.5 Worker and external model

`overlord.mission.summary.compose.v1` and its generation guard stay, but the worker now writes
prose only. Changes in `backend/mission-summary-compose-worker.ts`,
`packages/core/service/mission-summary-compose.ts` and `worker-jobs.ts`:

- The worker no longer selects risks or publishes suggestion references. Lists come from
  `mission_items` at read time.
- If the newest live delivery is the row's `narrative_delivery_id`, a trigger enqueues nothing and
  leaves `status` unchanged, so the panel never dims over agent-written text. This is the rule
  that stops the model overwriting the agent.
- If the newest delivery carried no agent summary, the worker composes prose as today (Gemini,
  else deterministic), with the agent's text as `previousSummary`, and records `gemini` or
  `deterministic` as the author.
- Objective reopen: prose is left alone. The client's running sentences already cover the gap
  until the objective re-delivers.

`readMissionSummaryEvidence` and `toMissionSummaryInput` read open items from `mission_items`, so
the fallback model also stops repeating closed claims. Gemini's response schema loses `risks`.

### 3.6 Read surface and clients

REST:

- `GET /api/missions/:id/summary`: `risks`, `suggestions` and `evidence.actions` are projected from
  open `mission_items` rows and each gains `id`. `MissionSummaryDto` gains
  `author: { kind, objectiveId, deliveryId }`, `contentRevision`, and
  `closedItems: [{ id, kind, text, objectiveId, status, reason, resolvedBy, resolvedAt }]`
  (bounded, newest first). An old client shows correct lists with no change.
- `PUT` and `DELETE /api/deliveries/:deliveryId/deferred-work/:actionId/resolution` keep their
  shape and are backed by `mission_items` (`backend/deferred-work-resolutions.ts`,
  `backend/deferred-work.ts`). `DeliveryDto` deferred-work items keep their `resolution` field,
  which now also reports an agent's close.
- New `PUT` and `DELETE /api/mission-items/:id/resolution` for a person to close or restore any
  item, including risks and human actions (PM decision 4).

Clients:

- Web and desktop (`webapp/web/components/mission-summary/`): provenance line under the post
  ("Updated by coo:1260.e12m" or "Written automatically"); a collapsed "Resolved" group listing
  closed items with who closed them, the reason and a Restore control; a close control on risks
  and actions. `webapp/web/lib/mission-summary-derive.ts` loses its client-side current-run and
  resolution filtering, and `contract/mission-summary-derive-fixtures.json` is updated with it.
- iOS (`OverlordMobile/Overlord/Views/MissionDetail/MissionSummary*.swift`): the same provenance
  line and resolved group, read-only in the first version.
- Seen marker: unchanged, because an agent's narrative write or close always arrives with a
  delivery, which already moves the watermark.
- Webhooks: no change. `mission.delivered` carries ids only.

### 3.7 Authorization

Narrative and item writes at delivery ride on the session's existing delivery permission and are
limited to items of the session's mission; no new grant. The attach field is read under the same
permission that already returns the mission packet. A person closing or restoring an item needs
the permission the deferred-work resolution routes require today.

## 4. Phases

Each phase lands contract text, code, tests and generated artifacts together (ADR 0010).

### Phase 1: `mission_items` and the read side (no behaviour change for agents)

1. New ADR: supersedes ADR 0046 in part (agents receive the summary as an editing baseline and
   may write narrative and item status; the seen marker stays operator-only) and records the
   move from delivery JSON plus `human_action_resolutions` to `mission_items`.
2. Migration `<ts>_mission_items.sql` in `database/sqlite/migrations/` and
   `database/postgres/migrations/`, the backfill runtime step, `packages/core/types/db.ts`,
   a migration test and Postgres conformance tests.
3. Core item writer and `listMissionItems`; calls from `deliverSession`, `recordWork`,
   `persistDeliveryPresentation`, the objective reopen path in `backend/repository.ts`, and the
   deferred-work resolution routes.
4. Summary route, delivery DTO, compose worker and evidence reader switched to the table (3.5,
   3.6). Risks become the deterministic open list.
5. `contract/data/README.md` (`mission_items`, `mission_summaries`, `human_action_resolutions`
   marked retired, vocabularies), `contract/architecture.md` (schema summary, "Mission summary"
   and deferred-work REST rules), `contract/api/openapi.yaml` (DTO additions, new operations,
   `info.version`), `yarn api:generate`.
6. `yarn version:contract major`, changelog entry, manifest restamp.

Done when: every existing panel and delivery card shows the same open items as before the
migration, resolutions made before the migration are preserved, and a comparison test proves the
table-backed lists equal the JSON-derived lists on fixture missions.

### Phase 2: protocol write path

1. `attachSession` / resume-follow-up: build and return `missionSummary`; instructions block.
2. `deliverSession` and `recordWork`: validation, conflict check, narrative write and
   `closeItems` (3.3, 3.4). New error code `mission_summary_conflict`.
3. Worker non-overwrite rule (3.5).
4. CLI: `--mission-summary-file`, payload passthrough, conflict output, `protocol-help.ts`,
   `flag-registry.ts`. `contract/protocol-commands.yaml` and `contract/protocol.md`.
5. MCP: `packages/contract/src/mcp-tools.ts`, `mcp/tool-catalog.ts`, `mcp/server.ts`;
   `yarn connectors:mcp-tools`.
6. Connector skill and references (`connectors/core/overlord-mission/SKILL.md`,
   `reference/cli.md`, `reference/mcp.md`, `reference/record-work.md`), version sync per the
   `connector-versions` skill, `docs/src/content/docs/docs-for-agents/agent-protocol.mdx`.
7. Tests: core unit tests for validation and conflict; backend tests for attach payload, deliver
   with and without summary, close of own-mission and foreign items, parallel-objective conflict,
   worker non-overwrite, fallback when the newest delivery has no agent summary;
   `cli/test/protocol-lifecycle.test.ts`; Postgres conformance.

Done when: an agent that delivers with `missionSummary` sees its text in the panel immediately,
an item it closed moves to the resolved group with its reason, and a second parallel delivery
with a stale base gets 409 with a fresh baseline.

### Phase 3: clients

Web, desktop and iOS changes in 3.6, including the person-facing close and restore routes. iOS
ships from the OverlordMobile repository.

### Rollout

The full change goes to production in one release. The phases above are build order, not release
stages, so no phase has to preserve the behaviour it replaces and there is no kill switch.

- The migration is one-way: after the backfill, the old table and columns are dropped.
- CLI and plugin versions already installed keep working: they omit `missionSummary` and get the
  fallback composer.
- Existing summaries keep `generated_by` as stored until the next agent delivery.
- Order on release day: backend deploy (runs the migrations and backfill), then CLI and connector
  publish, then web, then iOS.

## 5. Impact on other modules

| Module | Change |
| --- | --- |
| Contract | ADR; data, architecture, protocol text; `protocol-commands.yaml`; OpenAPI; major version; manifest restamp |
| Database | New table and columns in both editions; TypeScript backfill step; drop migration for the old table and columns |
| Core | Item writer and reader; `protocol.ts` attach, deliver, record-work; `delivery-presentation.ts` reconcile; `worker-jobs.ts` trigger; `mission-summary-compose.ts`, `mission-summary-evidence.ts` |
| Backend | `mission-summary.ts` projection; `deferred-work.ts` and `deferred-work-resolutions.ts` on the new table; item resolution routes; reopen path in `repository.ts`; compose worker |
| Automations | `compose-mission-summary`: risks leave the response schema; prompt wording for fallback-only use |
| CLI | Deliver and record-work input, conflict output, help |
| MCP | Attach output, deliver and record-work input schemas |
| Connectors | Core skill and references for every adapter; version bump |
| Web, desktop | Provenance line, resolved group, close and restore; simpler derive code |
| iOS (OverlordMobile) | Provenance line, resolved group |
| Docs | Agent protocol page |
| Runner, auth, webhooks | None |

## 6. PM decisions that remain

The implementation objectives on coo:1260 build the recommended option of each decision below.
Changing one before its objective runs means editing that objective.

Settled in discussion: cross-mission corrections are out of scope (coo:1278); risks, human actions
and suggestions move to one `mission_items` table with status, replacing
`human_action_resolutions`; agents close all three kinds as part of a summary update; no database
view.

1. **Approve a major contract increment.** Recommended: yes. There is no minor route now that
   `human_action_resolutions` is replaced.
2. **Conflict behaviour at delivery.** Recommended: reject once with a fresh baseline, then allow
   delivery without headline and summary (3.4). Alternative: always accept the delivery, discard
   the stale summary and let the fallback composer write it. The alternative never interrupts an
   agent but brings back model-written text exactly when two objectives deliver close together.
3. **Fate of the Gemini composer.** Recommended: keep it as fallback only, for deliveries without
   an agent summary. Alternative: remove it and use the deterministic text. Removal is simpler
   but makes the panel noticeably worse for missions run with older connectors and for
   `record-work`.
4. **May people close risks and human actions?** Contract v150 removed ticking off human actions
   on purpose ("shown, never ticked off"). With status on every row this is now nearly free, and
   the plan includes it in phase 3. Recommended: yes. If no, only agents close risks and actions,
   and people keep Restore.
5. **Summary length and shape.** Recommended: keep one headline (140 characters) and a summary of
   up to 1,200 characters of Markdown as free prose. Alternative: three fixed fields (what it
   provides, limits, your actions), which is easier to scan and to lint but needs new columns and
   a layout change on web and iOS.
6. **Read-only exposure outside attach.** Recommended: attach and resume-follow-up only.
   Alternative: also return it from `load-context` and `connect` now, so chat agents can answer
   "where does mission X stand" from the human-facing account.
7. **Summary-only updates after delivery.** Out of scope as planned: an agent changes the summary
   or closes items only with a delivery. Decide whether a discussion-mode agent may do either
   without re-delivering (`ovld protocol update-summary`); that would also need the seen
   watermark to move on those writes.
8. **Risks across re-deliveries.** Today a risk from an earlier delivery of the same objective
   stays listed after that objective delivers again; only human actions are replaced. The plan
   keeps this. Alternative: a re-delivery supersedes all of its objective's earlier open items,
   which is simpler and removes one source of repeated risks.

## 7. Risks

- Two records of one item (delivery JSON and the table) can drift. Mitigation: one writer
  function for every path, reconciliation when the presentation is saved, and the phase 1
  comparison test.
- The backfill touches every delivery and the old storage is dropped in the same release.
  Mitigation: idempotent, batched, tested on a copy of production data before release, and a
  database backup taken before the deploy.
- Agents may write promotional or overlong prose. Mitigation: length limits, instructions,
  advisory lint warnings returned on deliver.
- An agent may close an item wrongly. Mitigation: required reason, visible provenance, Restore.
- Attach payload growth. Mitigation: existing limits; `openItems` is capped and flagged
  `truncated`.
- Two authors of the summary row (agent in the delivery transaction, worker afterwards).
  Mitigation: both take the summary row lock; the worker never writes prose when
  `narrative_delivery_id` is the newest delivery.
