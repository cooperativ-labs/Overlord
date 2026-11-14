# Unify `draft` and `future` objectives into one ordered draft queue

Mission: coo:1274 · Status: **approved implementation plan**

Contract impact: major. `future` is removed from `objectives.state`. The
`reorder-future-objectives` command and the `overlord_reorder_future_objectives` MCP tool are
renamed. The reorder input now accepts `draft` and `submitted` objectives.

Rollout assumption: there is one user, and every change below ships in one release. Nothing is
kept for backward compatibility. That means no `future` input alias, no old command names, and
no clients tolerating a mixed state. The webapp, desktop, CLI, MCP, connectors, and the
OverlordMobile app are all updated before the release goes live.

---

Line numbers below are navigation hints, not stable references. Implementation must use symbols.

## 1. Target model

- Ordinary unstarted objectives are **`draft`**; discussion still uses `submitted`. The `future` state no longer exists.
- Drafts are ordered by `objectives.position`. A mission may have any number of drafts.
- **Queue head** is the first live `draft` or `submitted` by position, including saved blank drafts.
  **Next runnable draft** is the first live draft with non-empty instruction text. These are
  different selectors; do not label both “next up”. Ties break on `created_at`, then `id`.
  Neither is persisted. Automatic draft selection skips submitted objectives and blank drafts;
  submitted objectives remain explicitly launchable and reorderable.
- `submitted` (being discussed) and `launching` (launch in flight) are unchanged. `submitted` stays
  in the reorderable queue. `launching` does not.
- Any draft or submitted objective can be launched, queued, or reordered, including the first one.
  There is no promote step.
- Creating, reordering, reopening, or launching one objective never demotes/promotes another. In particular, setting an
  objective to `draft` no longer demotes other drafts, and no "refill" step promotes anything.

State machine after the change:

```
draft ⇄ submitted → launching → executing → pending_delivery → complete
  ↑__________________________________________________________________|  (reopen)
```

## 2. Shared helpers (do these first)

### 2.1 `automations/src/objective-manager/rules.ts`

| Change | Detail |
| --- | --- |
| Remove `'future'` from `ObjectiveLifecycleState` (L2) | The type checker will then find every remaining reference. |
| Delete `FUTURE_OBJECTIVE_STATES` and `isFutureObjective` | Also remove their re-exports from `objective-manager/index.ts` and `automations/src/index.ts`. |
| Add `QUEUED_OBJECTIVE_STATES = ['draft', 'submitted']` and `isQueuedObjective()` | These are the reorderable, not-yet-launched states. |
| Add `nextUpDraft(objectives)` | Returns the first `draft` with instruction text, sorted by `sortObjectivesByLifecycleOrder`, or `null`. Export it. Use only for automatic runnable-draft selection. Add `firstDraft` (blank allowed) for editing, discuss, and the resource badge; use `queuedObjectives[0]` for the visible queue head. |
| `ObjectiveLifecycleView` | Delete `futureObjectives`. Add `queuedObjectives` (`draft` + `submitted`, in position order). Add `launchingObjectives`. Keep `editableObjectives` only if callers still need it; otherwise delete it. `nextUpObjective` becomes the first objective in `[...launching, ...queued]`. `hasNonExecuted` = `launching.length + queued.length > 0`. |
| `sortObjectivesForMissionDisplay` (L468) | The final two groups become a single `ordered.filter(isQueuedObjective)` block in position order. |
| `validateObjectiveLifecycle` | Delete the `multiple_drafts` check, and remove the code from the `ObjectiveLifecycleViolation` union (L95). |
| `shouldDiscardEmptiedObjective` (L402) | Change to `return objective.state === 'draft';`. |
| Delete `planEnsureDraftSlot`, `EnsureDraftSlotPlan` | Also remove `ensureDraftSlotPlan` from `manageObjectiveLifecycle` output (`index.ts` L73, L100). |
| `ManageObjectiveLifecycleOutput` | Replace `futureObjectiveIds` and `editableObjectiveIds` with `queuedObjectiveIds` and `launchingObjectiveIds`. |
| `decideAutoAdvanceAfterDelivery` (L617) | Use `nextUpDraft`. Behavior is unchanged: it already chose the first non-empty draft. |
| Run Queue dispatch plan | Remove `promoteFutureToDraft` from the dispatch action type (L181) and from the planner (L281). |
| `objective-lifecycle.md` | Rewrite Section 6 ("always a next slot" / `ensureDraftSlot`). Remove the refill references in L40, L182, L269, L292, L332, and L515. Describe next-up as derived. |

### 2.2 SQL ordering convention

Each selector must document its state and non-empty-text predicate. All use
`ORDER BY position ASC, created_at ASC, id ASC LIMIT 1`. Add a short comment pointing at
the corresponding selector so SQL and TypeScript agree on eligibility as well as order.
Preserve explicit-objective selection and existing active-objective precedence/ambiguity errors.

## 3. Database migration

Create `<timestamp>_unify_draft_future_objectives.sql` in **both**
`database/postgres/migrations/` and `database/sqlite/migrations/`. The `backend/{postgres,sqlite}/`
copies are gitignored build outputs; do not edit them. The migration runs in this order:

1. **Preserve existing rows and evidence.** Do not infer “never run” from null timestamps and
   delete blank rows during this vocabulary migration. Blank rows may carry configuration,
   attachments, launch requests, sessions, or historical evidence. The removal of refill logic
   does not require deleting them. Keep saved blanks editable but exclude them from automatic
   runnable selection; new empty composers remain client-only.
2. **Flip the state, including soft-deleted rows:** update every `future` row to `draft`,
   increment its revision and updated timestamp, using each dialect's actual SQL timestamp
   expression (not an unbound `:now` placeholder). Preserve IDs, positions, ownership,
   provenance, configuration, attachments, and Run Queue membership. Do not rewrite historical
   events/delivery payloads: their state strings describe what happened at the time.
3. **Run Queue:** no entry deletion is needed. Existing queue identity, position, pause state,
   retry/hold state and dispatch status survive unchanged.
4. **Constraint.**
   - Postgres: `ALTER TABLE objectives DROP CONSTRAINT objectives_state_check;` then
     `ADD CONSTRAINT objectives_state_check CHECK (state IN ('draft','submitted','launching','executing','pending_delivery','complete'));`.
     Confirm the constraint name against the migration-built schema; verify all ownership constraints and RLS policies remain intact.
   - SQLite: rebuild the table. Precedent: `20261005120000_account_connections_profile_scope.sql`
     (`PRAGMA foreign_keys = OFF; BEGIN; CREATE TABLE objectives_vNNN …; INSERT … SELECT; DROP; ALTER … RENAME; COMMIT; PRAGMA foreign_keys = ON;`).
     Copy the column list from the **current** schema: 002 plus every later `ALTER TABLE objectives ADD COLUMN`
     (`launched_at`, `started_at`, `reopened_at`, `created_by_kind`, `created_by_agent`, the
     resource key, and so on). Generate it from `sqlite_master` on a migrated dev database, not by
     hand. Recreate every index and trigger on `objectives` (`idx_objectives_active_mission_position`,
     `idx_objectives_workspace_id`, `idx_objectives_project_id`, and the ones later migrations
     added). Inventory every foreign key, trigger and view referencing `objectives`. With foreign keys off, the textual references
     resolve to the renamed table, the same way the precedent migration handles them.
   Execute this through the real migration runner in tests: `foreign_keys = OFF` must take
   effect outside a transaction, and the runner must not introduce a conflicting outer BEGIN.
   Require `PRAGMA foreign_keys = 1` after success and safe connection cleanup after failure.
   Recreate composite unique keys as well as indexes; child workspace/objective foreign keys
   depend on them. Compare the before/after schema, allowing only the state CHECK change.
5. **Positions:** no renumbering is needed. The unique `(mission_id, position)` index already
   guarantees positions are unique, and turning future rows into draft does not move anything.

Then update `contract/data/README.md`:

- `instruction_text` (L989): change `draft`/`future` to `draft`.
- `state` (L990): remove `future`.
- `reopened_at` (L1004): remove "a `future → draft` promotion".
- Run Queue paragraph (L1594): "promotes only the selected future objective" becomes "launches
  only the selected objective".
- Vocabulary (L2881): remove `future`.
- Lifecycle (L2919): change to `draft -> submitted -> launching -> executing -> complete`.

Run the `kysely-codegen` skill or the type-generation script so the generated database types drop
`future`.

## 4. Backend and core services

### 4.1 Creating and inserting objectives

**`packages/core/service/missions.ts`**

- `insertObjective` / `createObjectiveOnMission` (L412–424): delete the `draftRow` lookup and
  `resolvedState`, and use `requestedState`. Rename `allowsBlankInstruction` to
  `requestedState === 'draft'`. The launch-selection default (L454) also keys on `=== 'draft'`.
- Mission creation (L753–754): `statusType === 'review' ? 'complete' : 'draft'`.
- Delete `ensureNextDraftObjective` (L548–~620) and its import and call in
  `packages/core/service/protocol.ts` (L46, L889). Attach no longer refills anything.
- discuss-objective (L1229–1233): when no `objectiveId` is given, select the draft with
  `firstDraft(objectives)` (blank drafts remain editable). Update the comment.

### 4.2 `backend/repository.ts`, `updateObjective`

- Instruction-blank guard (L7096): `resultingState === 'draft'`.
- Delete the guard against moving a completed objective to the future queue (L7118–7120).
- **Delete the single-draft block** (L7224–~7290): no more demoting other drafts and no more
  moving a promoted future objective into the draft slot.
- **Reopen moves the objective to the head of the queue.** For a reopenable state → draft,
  form the movable set from the reopened row plus live draft/submitted rows. Sort their existing
  position slots, then assign the reopened row to the first slot and the other queued rows to
  the remaining slots in their existing relative order. Leave every other objective's position
  unchanged, including launching, executing and complete rows. If the reopened row is already
  before the queue, or no queue exists, it keeps its position. Use
  `applyObjectivePositionUpdates` with all mission rows available for safe temporary slots.
  Coordinate the position write and final state update so revisions stay monotonic and change
  evidence includes both fields; do not overwrite a helper-incremented revision with a stale
  value. Sync Run Queue order in the same transaction. Existing reopen timestamps, evidence
  retention, request cancellation and queue pausing remain in effect.
- Delete the `ensureDraftSlotAfterObjectiveLeavesQueue` call (L7350–7363) and the function itself
  (L6978–~7060).
- The `disconnectingToQueue` logic (L7365+) is unchanged.

### 4.3 Reordering (`reorderFutureObjectives` → `reorderObjectives`)

`backend/repository.ts` L6801:

- Rename the function to `reorderObjectives` and the body type to `ReorderObjectivesBody`. Rename
  the type in `packages/contract/src/index.ts` (L274) and in the OpenAPI schema.
- Accept objectives in `draft` or `submitted` (`QUEUED_OBJECTIVE_STATES`). Reject any other
  state with `400 Objective <id> is not a queued objective`.
- **Completeness:** require the submitted IDs to be exactly the mission's live queued
  objectives. Reject missing IDs as well as extra ones. This matches the protocol rule that
  already says "complete post-move ordering". Check it against the current code, which only
  rejects duplicates and unknown IDs.
- Reuse `applyObjectivePositionUpdates` for the temporary-position two-pass update and keep
  `syncRunQueueOrderFromMissionPositions`. Assign only existing queued slots, as below.
- **Run Queue consistency is already handled**: `syncRunQueueOrderFromMissionPositions` carries
  the new order into every queue holding the mission's `waiting`/`blocked` entries
  (`contract/architecture.md` L228). The only new case is that the head draft can now move. Add a
  test for it (see §8).
- **Launching objectives inside the block.** A `launching` objective can sit between queued
  objectives in position order. Renumbering over a contiguous range would then collide with it.
  Change the renumbering to assign the targets the sorted list of positions they **currently
  hold**, rather than `basePosition + index`. That way the slots of excluded rows are never
  touched. There is no separate legacy future reorder implementation to retain.

- **Concurrency:** validate membership and lifecycle state under the same serialization boundary
  used for writes. A transaction alone at Postgres READ COMMITTED is insufficient: coordinate
  reorder with create/delete, launch/claim, reopen and Run Queue position writes using a shared
  per-mission lock (or equivalent checked writes/retry). SQLite must hold its write transaction
  before reading the set. If the submitted set is stale, reject atomically and have web/mobile
  refetch before retrying; never silently drop or move a newly launching objective.
- Empty input is a no-op only for an empty queued set; unchanged order writes no revisions or
  events. Preserve permission checks and mission/workspace isolation on all renamed surfaces.
- Audit direct `updateObjective({ position })` and create-with-position callers so they cannot
  bypass the queued-state/order invariants or leave Run Queue order stale. Specify guarded
  internal use or reject unsupported external position mutations in the same release.

Route (`backend/app.ts` L1854): keep `PATCH /api/missions/:id/objectives/reorder` and change the
handler to `reorderObjectives`.

### 4.4 Launch and Run Queue

- `backend/execution/launch.ts` L308–314: remove the `future` hint branch. Use the single message
  "Only draft, submitted, or launching objectives can be launched."
- `backend/run-queue-dispatch-worker.ts` L244–247: delete the `promoteFutureToDraft` update.
- `packages/core/service/run-queue.ts`:
  - L432 `SEQUENCEABLE_OBJECTIVE_STATES` becomes `['draft', 'submitted']`.
  - L830 cascade becomes `o.state IN ('draft', 'submitted')`.
- **Cascade semantics with out-of-order queueing.** Queueing objective #3 cascades to objectives
  positioned after it (`o.position > ?`), and objectives #1 and #2 stay unqueued. That is correct
  ("queue this and everything after it"). Leave it as is and document it.

### 4.5 "The draft" readers (lowest position, explicit order)

| Site | Change |
| --- | --- |
| `packages/core/service/protocol.ts` `resolveActiveObjective` (L169–170) | `nextUpDraft(objectives)` after existing active-state resolution; preserve deterministic submitted/blank fallback where currently allowed. Do not change explicit-ID selection or ambiguity errors. Confirm `listObjectives` ordering. |
| `cli/src/launch.ts` L326 | Same: prefer the lowest-position draft. |
| `backend/repository.ts` L3771–3774 and L6541–6544 (`draft_objective_resource_key`) | Add `ORDER BY o.position, o.created_at, o.id`. This is a latent bug today. |
| Same queries, L3766–3769 and L6536–6539 (`has_pending_objective_with_instructions`) | `o.state = 'draft'`. |

### 4.6 Delivery, Run Queue dispatch and "awaiting approval"

`packages/core/service/protocol.ts` L2752–2760: the next-objective query uses
`position > (delivered objective's position)`. Because objectives can now launch out of order,
replace it with the next runnable draft, skipping submitted objectives and blank drafts:

```sql
SELECT id, title FROM objectives
 WHERE mission_id = ? AND deleted_at IS NULL AND state = 'draft'
   AND TRIM(COALESCE(instruction_text, '')) <> ''
 ORDER BY position, created_at, id LIMIT 1
```

The `awaiting_approval` event and the "not already queued" check after it are unchanged.
Do not introduce a second automatic scheduler. Delivery currently enqueues the durable Run Queue
worker; Run Queue membership/order remains authoritative. `decideAutoAdvanceAfterDelivery` is
an exported planner, not a call in the production delivery path. Update its semantics and tests,
but test real dispatch separately. A later queued objective does not implicitly enqueue earlier
unqueued drafts, and queued successors can proceed without the informational approval event
changing queue membership.

### 4.7 Search

`packages/contract/src/search.ts` L18 and L110: remove `future` from the `objectiveStates`
vocabulary and from its error message. Update the `objectiveStates` enum in `contract/api/openapi.yaml`
if the search request schema lists one.

### 4.8 Protocol command, MCP, CLI

| File | Change |
| --- | --- |
| `backend/protocol/missions.ts` L549–560 | Rename the subcommand to `reorder-objectives` and call `reorderObjectives`. |
| `backend/protocol/missions.ts` L167 (the `update-objective` instruction-text guard) | `row.state !== 'draft'`. Error text: "Objective instruction text can only be edited in draft state". |
| `backend/protocol-subcommand-table.test.ts` L31 | Rename the entry. |
| `packages/contract/src/mcp-tools.ts` L354 | Rename the tool to `overlord_reorder_objectives` and update its description. |
| `mcp/server.ts` L506–511, `mcp/README.md` L81 | Rename. |
| `connectors/core/scripts/overlord-mcp.mjs` L522, L1554–1558 | Rename. Then run the `connector-versions` sync and bump the patch version. |
| `cli/src/help.ts` L95 and L109; `cli/src/protocol-help.ts` L33, L116, L325 | Rename, and change the copy to "Replace one mission's complete order of unstarted (draft/submitted) objectives". |
| `cli/docs/01-command-reference.md` L254, `cli/docs/03-agent-protocol.md` L65 | Rename. |
| `docs/src/content/docs/{cli,mcp}.mdx`, `docs-for-agents/{mcp,agent-protocol}.mdx` | Rename, and update the copy. |
| `connectors/core/overlord-mission/reference/context.md` L16 | Add one sentence saying that `futureObjectives` in attach/load-context means "positioned after the current objective", not an objective state. |

Fix the `splitObjectivesAroundCurrent` comment that calls lower-position objectives already
worked: lower-position drafts may still be unexecuted after an out-of-order launch.
The `previousObjectives` / `futureObjectives` fields in attach and load-context responses are
**not renamed**. They describe position relative to the current objective and are unaffected.

## 5. Contract documents

Add an ADR for retiring `future` and the old command/tool, defining selection, reordering,
reopen semantics, migration preservation and the single-release cutover. Include the affected
backend/core, automations, database, CLI/MCP/connectors, web/desktop and mobile consumers.
Update `contract/conformance.md` and `contract/extension-points.yaml` objective state vocabulary
and lifecycle diagram; these are additional normative sources, not just generated types.
Bump with `yarn version:contract major`. Never type the version by hand. Fill in the changelog
skeleton it creates.

- `contract/protocol-commands.yaml`:
  - Replace `reorderFutureObjectives` (L406–418) with `reorderObjectives`: `--mission-id`,
    `--ordered-objective-ids-json`, the queued-state rule, and the side effect
    `updates-queued-objective-positions`.
  - The instruction-edit rule (L633) becomes "only in draft state". This matches the protocol
    guard. REST `updateObjective` is looser: it locks only executing, pending_delivery, and
    complete. Leave that difference as it is; this change does not address it.
- `contract/components.yaml` L417: rename the MCP tool.
- `contract/api/openapi.yaml`:
  - Objective state enum (L10956): remove `future`.
  - Reorder operation (L8235–8250): change the summary and description.
  - Rename the schema `ReorderFutureObjectivesBody` → `ReorderObjectivesBody` (L12656) and fix its
    item description.
  - Bump `info.version`, then regenerate the types, Zod schemas, and operation table.
- `contract/architecture.md`:
  - L38: remove "a `future → draft` promotion".
  - L223: change the cascade list to `draft` or `submitted`.
  - L228: rename `reorderFutureObjectives`.
- `contract/data/README.md`: see §3.
- `contract/mission-summary-derive-fixtures.json` L14: change `"state": "future"` to `"draft"`.
  Add shared vectors covering mixed submitted/draft/blank queues and out-of-order completion,
  and update every TypeScript and Swift derivation consumer. Then copy the file over the OverlordMobile fixture
  (`OverlordTests/Fixtures/MissionSummary/mission-summary-derive-fixtures.json`).
- **Conformance manifests:** a major increment requires restamping every manifest
  (`yarn check:conformance-versions`). Regenerate the connector manifests with
  `yarn connectors:capabilities` and update any hand-written ones.
- Run `yarn api:generate`, `yarn connectors:mcp-tools`, `yarn connectors:capabilities`,
  then `yarn contract:check` and the contract tests until they pass.

## 6. Webapp

| File | Change |
| --- | --- |
| `webapp/web/components/objectives/MissionObjectivesSection.tsx` | Replace the editable and future groups with: (1) `launchingObjectives`, rendered as non-draggable full `DraftObjective` cards; then (2) one `DndContext`/`SortableContext` over `queuedObjectives`. In that list, **index 0 renders as the full launch card and the rest render in today's compact future style**, so dragging a card to the top expands it. Rename `SortableFutureObjective` → `SortableQueuedObjective`, `futureOrder` → `queueOrder`, and the hook to `useReorderObjectives`. Collapse the two ghost composers (`showNextUpGhost` / `showQueuedGhost`) into one composer at the end of the queue. Rewrite the doc comment (L147–170). |
| `webapp/web/components/objectives/future-objective-order.ts` | Rename to `queued-objective-order.ts`, and `mergeFutureObjectiveOrder` → `mergeQueuedObjectiveOrder`. The logic is unchanged. |
| `webapp/web/lib/queries/optimistic-updates.ts` L78–120, `lib/queries/objectives.ts` L76–82, `lib/api/objectives.ts` L6–13 | Rename to `reorderObjectives`, `ReorderObjectivesVars`, and `createReorderObjectivesMutation`. |
| `DraftObjectiveToolbar.tsx` L50, L101–103, L111–124 | Delete `isFuture`, `handlePromote`, and the Promote button. `isLaunchable` covers every draft. Add an optional `compact` prop if the compact queue card needs a smaller Launch button. |
| `DraftObjective.tsx` L68, L130 | Delete `isFuture`. `commitEmpty={objective.state === 'draft'}`. The compact-versus-full layout now comes from the queue index prop, not from state. |
| `DraftObjectiveActions.tsx` L37, L42 | Remove `'future'` from `QUEUE_CONTROL_STATES` and `MANUALLY_SETTABLE_STATES`. |
| `ObjectiveMenuButton.tsx` L79–80, L218 | `canShowMarkComplete = state !== 'complete'`; `canShowMarkDraft = state !== 'draft'`. New copy: "…returns to the top of the draft queue. Its deliveries, file changes…". |
| `ObjectiveCollapsibleItem.tsx` L447 | Same copy change. |
| `components/ui.tsx` L115 | Remove the `future: 'Future'` label. |
| `components/DeferredWorkItem.tsx` L173 | `state: 'draft'`. Confirm the API defaults to draft, and drop the field if it does. |
| `pages/missionCardState.ts`, `MissionDraftResourceBadge.tsx` | No code change. They benefit from the backend's new ordering and draft-only query. |

Search the webapp for `isFutureObjective`, `futureObjectives`, and `'future'` once the
automations type change lands. The compiler will flag the rest.

## 7. OverlordMobile (sibling repo)

Deliver this from the `OverlordMobile` checkout.

| File | Change |
| --- | --- |
| `OverlordCore/Contract.swift` L113 | Remove `case future`. Update the reorder request comment (L2245): "every queued (draft/submitted) objective id, top-to-bottom". |
| `OverlordCore/Theme.swift` L34 | `case .draft:`. |
| `OverlordCore/ShareDestinationRules.swift` L41, L78 | `[.draft]`; remove `.future` from the switch. |
| `OverlordCore/Compose/ComposerPrimaryButton.swift` | Delete the `.promote` glyph and its color branches. |
| `Overlord/Views/MissionDetail/MissionDetailContentView.swift` | Merge `draftObjectives` and `futureObjectives` into one `queuedObjectives` list in position order. Make the whole list reorderable (L1047 reorder now sends every queued ID). Delete the `.futureSaveOrPromote` and `.futureSaveOnly` action modes, and `futureComposerKey` / `drafts.futureObjective`; keep a single end-of-queue composer. As on the web, the first queued item renders as the full launch card. |
| Tests: `MissionDetailDraftsTests`, `ShellStateTests`, `FeedModelTests`, `AssistantChatTests`, `ContractV90Tests`, `ContractV165BackendFixtureTests` | Remove `future` fixtures and expectations. Add a reorder test that moves the head draft. |
| Mission-summary fixture | Copy it from `contract/` (§5). |

## 8. Tests

### Rewrite or delete

- `automations/src/objective-manager/rules.test.ts`:
  - delete the `planEnsureDraftSlot` cases (L195–282) and the `multiple_drafts` case (L185);
  - drop `promoteFutureToDraft` from the dispatch expectations (L523–865);
  - change the view tests (L53, L167) to `queuedObjectives`.
- `backend/objectives.test.ts`:
  - the reorder test (L397) uses drafts, and gains a case that moves the head;
  - the draft/position cases (L539, L594) become reopen-to-head cases.
- `backend/run-queue-mission-scope.test.ts` L278, `backend/mission-secondary-workspace.test.ts`
  L91 and L158, `backend/protocol-pm-management.test.ts` L48, `backend/mcp.test.ts` L351: rename
  to the new function, command, or tool.
- `backend/launch.test.ts`: replace the "promote first" assertion with "a non-head draft launches".
- `backend/mission-creation.test.ts`: every created objective is a `draft`.
- `packages/core/service/protocol.objectives.test.ts` L123–308: `futureObjectives` (positional)
  assertions stay. Fixtures that create `future`-state rows switch to `draft`.
- `webapp/web/lib/queries/optimistic-updates.test.ts` L10 and L112: rename.
- `cli/test/*`, `backend/activity-feed.test.ts`, `live-activities.test.ts`,
  `push-notifications.test.ts`, `agent-session-routes.test.ts`: replace `'future'` fixture
  states with `'draft'`.

### New tests

1. Creating a mission with three objectives yields three drafts at positions 0, 1, 2, and
   next-up is #0.
2. Adding an objective to a mission that already has drafts yields another draft at the end,
   and no other row changes.
3. Reordering `[#2, #0, #1]` updates positions, and every run queue holding the mission's waiting
   entries now matches that order.
4. Reordering with a `launching` objective between queued ones leaves the launching row's
   position untouched (the §4.3 slot fix).
5. Reordering rejects an incomplete or over-complete ID list, and IDs of non-queued objectives.
6. Launching a non-head draft succeeds, and the head stays a draft.
7. Delivering an objective launched out of order selects the next runnable draft for
   `awaiting_approval`, including lower positions; separately assert the exported planner uses
   the same draft eligibility. Real Run Queue dispatch is covered in case 16.
8. Reopening a completed objective moves it to the head of the queue, redistributes queued rows across their existing slots, and syncs the Run Queue.
9. Attaching to a mission with no explicit objective and several drafts picks the lowest-position
   draft.
10. Migration (SQLite and Postgres):
    - `future` rows become `draft`;
    - blank rows, attachments, history, configuration and Run Queue entries survive unchanged;
    - already soft-deleted future rows also convert so the tightened CHECK can be installed;
    - the CHECK rejects `future`;
    - all indexes and foreign keys survive the SQLite rebuild (`PRAGMA foreign_key_check` is empty).
11. The `draft_objective_resource_key` card field returns the lowest-position draft's resource,
    including a saved blank draft; runnable selection independently skips blanks. Preserve
    active-objective default attach precedence and multiple-active ambiguity errors.
12. Concurrent reorder versus launch/claim, insert/delete, reopen and Run Queue move: either one
    consistent ordering commits or the stale operation conflicts; no partial position writes,
    uniqueness failures exposed as server errors, or active row movement.
13. Mixed draft/submitted/blank queues, empty sets, unchanged orders, duplicates, foreign-mission
    IDs and unauthorized workspace access; verify no-op revisions and rollback on rejection.
14. Reopen before/after the queue and with no queue; sparse slots and interleaved active/history
    rows stay fixed. Revisions/change feed are coherent and old evidence survives.
15. Web and mobile drag the head and a submitted card, preserve the selected objective's composer
    and unsaved text by ID across layout changes, and refetch/rollback optimistic order on a stale
    set conflict. Both full and compact cards support launching any eligible objective.
16. Real delivery → Run Queue worker integration: previously queued successors launch by queue
    order, earlier unqueued drafts remain unqueued, and approval notices use the selected policy.
17. Migration runs on fresh and upgraded SQLite/Postgres databases through actual runners;
    schema parity, FK enforcement, RLS/isolation and evidence counts hold after success. Verify
    failure rollback/connection cleanup. No historical migration file is rewritten.

## 9. Implementation objectives and order

Execute these objectives sequentially, all assigned to Claude Opus 5.5. They form one release;
none authorizes a production deployment. Keep code and its normative contract changes together.

1. **Primary repository implementation** — `coo:1274.5n3n` (`primary`): implement §§2–6 as one coherent change
   set: shared lifecycle selectors, both migrations, core/backend ordering and concurrency,
   launch/delivery/Run Queue behavior, protocol/CLI/MCP/connector changes, all normative contract
   updates and generated artifacts, and the web/desktop objective UI. Remove obsolete code,
   update affected fixtures/tests, and run focused migration, service, contract and UI checks.
   Use `yarn version:contract major` once for this change set. Do not deliver a broken build or
   defer necessary consumer updates within this repository to a later objective.
2. **Mobile implementation** — `coo:1274.yt1a` (`mobile`): implement §7 against the primary repository's new
   contract. Copy shared fixtures, update Swift consumers and tests, and verify reordered
   head/submitted cards, explicit launch, editor preservation and stale-order recovery. Complete
   the mobile build and relevant tests before delivery. This depends on objective 1.
3. **Integrated verification and release preparation** — `coo:1274.pk8q` (`primary`): verify every §8 acceptance
   case, repair remaining primary-repository integration defects, and run the full applicable
   test/type/lint/contract/generated-artifact gates. Confirm mobile build/test evidence from
   objective 2 and exercise web/mobile against the matching backend. Verify both database
   migration paths and real delivery-to-dispatch behavior. Produce a concrete cutover and
   rollback checklist under §10, with remaining blockers explicit. Do not deploy or migrate
   production. This depends on objectives 1 and 2.

Essential focused tests accompany each implementation objective; the final objective owns broad
regression coverage and cross-component verification. If a mobile defect is found during final
verification, fix it from the mobile resource and record that resource's evidence before declaring
the combined release ready.

## 10. Approved product behavior and release conditions

Automatic draft selection and approval notices skip submitted objectives and blank drafts.
Submitted objectives remain draggable and explicitly launchable. The visible queue head may
therefore differ from the next runnable draft. Explicit Run Queue membership and order remain
authoritative; a submitted objective already queued for execution is not skipped by dispatch.

On both web and mobile, render a full card for the queue head and compact cards for the rest.
Every eligible card supports launch without promotion. Preserve editor identity, pending uploads
and unsaved changes when dragging changes which card is expanded.

Reorder requires the complete draft/submitted set. Launching and active rows remain fixed.
Both database dialects enforce the new closed state vocabulary; SQLite rebuilds its table.
There are no outstanding PM decisions for this plan.

One release does not mean simultaneous client replacement. Before release, finish mobile and
all other consumers, stop old writers/dispatchers during migration, and restart only matching
versions. Already-open web tabs and old local CLI/connectors must refresh/update before writes.
Keep a pre-migration backup; rollback is restore plus matching old binaries, not running an old
single-draft binary against the new multi-draft data. Record the cutover procedure and verify
that no legacy process resumes writing `future`. This is an implementation/release requirement;
deployment and production migration require a separate release action.

Completion gates for implementation: `yarn api:generate:check`, `yarn contract:parity`,
`yarn check:conformance-versions`, `yarn contract:check`, generated MCP/capability artifact checks,
affected unit/integration suites on both database dialects, and web/mobile interaction checks.
Use the normal `yarn release:preflight major` and release finish process at release time.

## 11. Size

Re-inventory affected files before implementation, including normative and concurrency work. Most are renames, tests, and docs. The substantive changes are in
`automations/src/objective-manager/rules.ts`, `backend/repository.ts` (`updateObjective`,
reorder, refill removal), `packages/core/service/{missions,protocol,run-queue}.ts`,
`backend/run-queue-dispatch-worker.ts`, the migration pair, `MissionObjectivesSection.tsx`, and
`MissionDetailContentView.swift`. Net code goes down. Deleted: three refill implementations, the
single-draft demotion and repositioning block, the promote plumbing in the dispatcher and the UI,
and the `multiple_drafts` validator rule.
