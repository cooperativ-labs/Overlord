# Project-Scoped Mission Statuses (coo:752)

**Status:** proposed — migration plan, not yet implemented
**Contract impact:** version bump required (`92` → `93`) before implementation
**Modules touched:** `database`, `core`, `rest` (backend), `webapp`, `cli`, `mcp`, `contract`, plus the mobile client (separate repo, **released in lockstep** — no backward compatibility)
**Desktop:** no shell work — it renders the webapp; only the settings nav labels move
**Latch / marketing:** no impact (verified: no status references)

---

## 1. Decision

Move the definition of mission (card) statuses from the **workspace** to the
**project**. After this migration:

- Every project owns its own ordered set of statuses.
- Project settings gains a **Card statuses** page using the same drag-to-reorder,
  rename, set-default, add, delete interface that lives in workspace settings today.
- Workspace settings **loses** its Card statuses page entirely.
- A mission's `status_id` always names a status belonging to that mission's own project.

The stable *status type* vocabulary (`draft`, `execute`, `review`, `complete`,
`blocked`, `cancelled`) is **not** changing. This is the single most important
scoping fact in this plan: every agent-facing contract — protocol `--phase`
values, `mission-status-to-execute` / `mission-status-to-review` side effects,
webhook `status.type`, `statusType` filters in search — is expressed in *types*,
not in user-defined status names or ids. Consequently **the agent protocol,
the CLI protocol surface, and the MCP tool contracts are semantically unchanged**;
their work is documentation, one new read tool, and validation-scope wording.

This direction is already the documented intent. `cli/docs/06-core-domain-and-lifecycle.md`
states "Status names should be configurable per project later, but status type
semantics should remain stable", and the same file already phrases the singleton
rules as *per project* ("Only one project status should have the exclusive
`execute` type…"). The current workspace-level model was a consolidation step;
this plan reverses it deliberately and completely.

### 1.1 Why a fan-out copy, not a re-parent

The backfill **copies** each workspace's status set into every project of that
workspace, minting new ids, and then repoints missions to their project's copy.
It does not move existing rows onto one arbitrary project.

- Every workspace with N projects must end with N independent, editable sets.
  Re-parenting the single set to one project would leave the other N−1 projects
  status-less, and every mission in them dangling.
- Copying preserves `key`, `name`, `type`, `position`, `is_default`, and
  `is_terminal`, so every board looks byte-identical the moment the migration
  lands. The feature is opt-in divergence: nothing changes visually until a user
  edits one project's statuses.
- `key` stays stable per copy, which gives the two remaps that survive this plan —
  cross-project mission moves (§5.4) and schedule duplication (§3.3) — a
  deterministic correspondence between a source project's status and a target
  project's status.

---

## 2. Current state (inventory)

### 2.1 Schema

`workspace_statuses` (`database/{postgres,sqlite}/migrations/002_initial_core.sql`)
is keyed by `workspace_id` with five uniqueness guarantees, all workspace-scoped:

| Index | Guarantee |
| --- | --- |
| `idx_workspace_statuses_workspace_key` | one row per `(workspace_id, key)` |
| `idx_workspace_statuses_active_name` | one active row per `(workspace_id, lower(name))` |
| `idx_workspace_statuses_active_default` | exactly one `is_default` per workspace |
| `idx_workspace_statuses_active_execute` | exactly one `type = 'execute'` per workspace |
| `idx_workspace_statuses_active_review` | exactly one `type = 'review'` per workspace |

Three tables carry a foreign key into it, each via the composite
`(workspace_id, status_id)` pattern this codebase uses everywhere:

| Table | Column | On delete |
| --- | --- | --- |
| `missions` | `status_id` (NOT NULL) | RESTRICT |
| `my_mission_positions` | `status_id` (NOT NULL) | CASCADE |
| `schedules` | `next_status_id` (nullable) | SET NULL |

**Explicitly not affected:** `mission_status_seen.status_id` does *not* hold a
`workspace_statuses.id`. It stores indicator keys — the literal strings
`'blocking_question'` and `'returned_to_execute'` (see
`markMissionStatusesSeen`, `backend/repository.ts:3933`). It has no FK and must
**not** be touched by this migration. Anyone who greps for `status_id` will find
it; call it out in the migration comment so nobody "fixes" it.

`search_documents` stores no status id. `missions.status_type` is a denormalized
copy of the type and stays exactly as it is.

### 2.2 Backend service and routes

Status CRUD lives in `backend/repository.ts` (~lines 2020–2320):
`selectWorkspaceStatusesForWorkspace`, `listWorkspaceStatusesForWorkspace`,
`resolveStatusWorkspaceId`, `createWorkspaceStatus`, `updateWorkspaceStatus`,
`deleteWorkspaceStatus`, `reorderWorkspaceStatuses`, plus helpers at ~400–490
(`uniqueStatusKey`, `assertUniqueStatusName`, `countActiveStatusesByType`,
`clearWorkspaceDefaultStatuses`) and lookups at 3832 (`getWorkspaceStatus`),
5849 (schedule duplication), and 6198 (My Missions reorder, organization-scoped).

Two route families exist in `backend/index.ts`:

- **Legacy, active-workspace** (`/api/workspace/statuses*`, lines 1287–1319) — GET,
  POST, PATCH reorder, PATCH `:statusId`, DELETE, gated by `WORKSPACE_READ` /
  `WORKSPACE_UPDATE`.
- **Workspace-scoped** (`/api/workspaces/:id/statuses*`, lines 867–923) — the same
  five operations against an explicit workspace, authorized inside the service
  (coo:135), so the settings modal can edit any org workspace without switching.

Seeding is `seedWorkspaceStatuses` in `backend/workspaces.ts:291`, called on
workspace create (line 433) and on onboarding (line 570), reading
`DEFAULT_STATUSES` from `database/src/constants.ts`. `createProject`
(`backend/repository.ts:3162`) explicitly does *not* seed statuses today.

### 2.3 Core service

`packages/core/service/missions.ts` holds four workspace-scoped resolvers, all
querying `WHERE workspace_id = ctx.workspace.id`:

- `getDefaultStatusId` (line 121) — mission creation
- `getReviewStatusId` (line 137) — `deliver`, `record-work`
- `getExecuteStatusId` (line 153) — `attach`
- `getWorkspaceStatusById` (line 176) — explicit column choice from the board

and the two transition writers `moveMissionToReview` (1471) and
`moveMissionToExecute` (1525), called from `packages/core/service/protocol.ts`
at lines 839, 1278, 1651, 2166.

`packages/core/service/webhook-events.ts:210` joins `workspace_statuses` to build
the `status: { id, type, label }` object in `mission.status_changed` and full
`mission.delivered` envelopes.

### 2.4 Contract

`packages/contract/src/index.ts`: `WorkspaceStatusDto` (348),
`CreateWorkspaceStatusBody` (359), `UpdateWorkspaceStatusBody` (366),
`ReorderWorkspaceStatusesBody` (376), and `MissionDetailDto.statuses` (780).
`contract/extension-points.yaml:256` declares the `workspace_statuses.type`
vocabulary and its three per-workspace singleton constraints.
`contract/components.yaml:200` names `GET /api/workspaces/:id/statuses` as a
stable REST capability. `CONTRACT.md:846` restates the type vocabulary.

Realtime uses the `workspace_status` entity-change type
(`backend/repository.ts` 2128/2192/2240/2285 → `webapp/web/lib/realtime-invalidation.ts:180`),
which today invalidates `['workspace']`, every project-scoped query, and My Missions.

### 2.5 Webapp

| File | Role |
| --- | --- |
| `components/settings/StatusesPage.tsx` | the editor itself, takes `workspaceId?` |
| `components/workspaces/WorkspaceSettingsModal.tsx` | hosts it under the "Card statuses" nav item |
| `pages/BoardPage.tsx` | `useWorkspaceStatuses(workspaceId)` → columns, filter, complete-status lookup |
| `pages/MyMissionsPage.tsx` | one status query **per workspace**, merged into columns |
| `pages/my-missions-columns.ts` | `buildMergedStatusColumns` / `resolveMergedColumnReorder`, keyed by workspace |
| `pages/MissionStatusFilterDropdown.tsx`, `pages/BoardColumn.tsx`, `pages/useBoardColumnDnd.ts` | consume the DTO |
| `components/MissionStatusSelect.tsx`, `components/MissionPanel.tsx` | render `mission.statuses` from `MissionDetailDto` |
| `components/scheduling/ScheduleEditor.tsx` + `schedule-editor-helpers.ts` | pick `nextStatusId` |
| `lib/api.ts` (386–429), `lib/queries.ts` (366, 1020–1058), `lib/query-keys.ts` (26–29) | transport |

### 2.6 Mobile (`OverlordMobile`, separate repo, released in lockstep — see §9)

| File | Role |
| --- | --- |
| `OverlordCore/Contract.swift:508` | `WorkspaceStatusDto` |
| `OverlordCore/APIClient.swift:188` | `listWorkspaceStatuses(workspaceId:)` → `/api/workspaces/:id/statuses` |
| `Overlord/Lib/WorkspaceData.swift:82,156` | fans out one request per workspace, dedupes by id, caches under `all-statuses` |
| `Overlord/Lib/Missions.swift:113,164,203` | `statusColumns` (merge by name, grouped by `workspaceId`), `statusName(for:)`, `preferredCompleteStatus(for workspaceId:)` |
| `Overlord/Views/MissionsList/MissionsScreen.swift` | columns, filter, drag-to-move |
| `Overlord/Views/Home/HomeScreen.swift:504` | status names on cards |
| `Overlord/Lib/MissionDetailAdapters.swift:104` | mission detail status picker |

### 2.7 CLI and MCP

Neither reads or writes status *definitions* today.

- `cli/src/commands.ts:1687` (`ovld missions list`) forwards only `q`,
  `projectId`, and `limit` — the documented `--status <csv>` flag is **not
  implemented** (a pre-existing drift bug, see §11.1).
- `cli/src/help.ts:65,95`, `cli/src/protocol-help.ts:199`, `cli/README.md:251`,
  and `cli/docs/06-core-domain-and-lifecycle.md:134–164` document statuses.
- `mcp/tool-catalog.ts:96` — `overlord_search_missions.status` takes status
  *types*, not names; `mcp/server.ts:150` forwards it verbatim.
- `contract/protocol-commands.yaml` expresses every status side effect as a type.

---

## 3. Target data model

### 3.1 Table

Rename to `project_statuses` and add `project_id`. `workspace_id` is retained —
not redundantly, but because every composite FK, every `recordChange` call, and
the realtime membership filter are workspace-keyed, and because it keeps the
`(workspace_id, id)` unique index that `missions` and `my_mission_positions`
already point at.

```sql
CREATE TABLE project_statuses (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (char_length(btrim(key)) > 0),
  name text NOT NULL CHECK (char_length(btrim(name)) > 0 AND name = btrim(name)),
  type text NOT NULL CHECK (type IN ('draft','execute','review','complete','blocked','cancelled')),
  position integer NOT NULL CHECK (position >= 0),
  is_default boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  UNIQUE (workspace_id, id),
  UNIQUE (project_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES projects (workspace_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_project_statuses_project_key
  ON project_statuses (project_id, key);
CREATE UNIQUE INDEX idx_project_statuses_active_name
  ON project_statuses (project_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_project_statuses_active_default
  ON project_statuses (project_id) WHERE is_default = true AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_project_statuses_active_execute
  ON project_statuses (project_id) WHERE type = 'execute' AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_project_statuses_active_review
  ON project_statuses (project_id) WHERE type = 'review' AND deleted_at IS NULL;
CREATE INDEX idx_project_statuses_project_position
  ON project_statuses (project_id, position) WHERE deleted_at IS NULL;
```

Every uniqueness guarantee moves from `workspace_id` to `project_id`. The
`(workspace_id, project_id)` composite FK is what makes it impossible for a
status row to claim a project in a different workspace.

### 3.2 Dependent FKs

```sql
-- missions
FOREIGN KEY (project_id, status_id)
  REFERENCES project_statuses (project_id, id) ON DELETE RESTRICT

-- my_mission_positions (add project_id, backfilled from the mission)
FOREIGN KEY (project_id, status_id)
  REFERENCES project_statuses (project_id, id) ON DELETE CASCADE
```

Switching `missions` from `(workspace_id, status_id)` to `(project_id, status_id)`
is the load-bearing change: the database itself now refuses to put a mission into
a foreign project's column. `my_mission_positions` gains `project_id` for the same
reason (denormalized from `missions.project_id`, kept in sync by the same code
path that already maintains `cascadeMissionProjectId`).

### 3.3 Schedules

`schedules` is workspace-scoped and carries no `project_id`, but
`schedules.next_status_id` must now name a *project's* status. Two options:

**Chosen: replace the id with a key.**

```sql
ALTER TABLE schedules DROP COLUMN next_status_id;   -- after backfill
ALTER TABLE schedules ADD COLUMN next_status_key text;
```

`resolveDuplicateStatus` (`backend/repository.ts:5839`) already tolerates a
missing/invalid target and falls back to the project's default. It becomes:
resolve `next_status_key` against the **duplicated mission's own project**;
fall back to that project's default when the key is absent or unmatched. This is
strictly more robust than an id — a mission moved to another project keeps a
working schedule, because the key exists in every project that still carries the
default status set.

**Alternative considered:** add `schedules.project_id` and keep an FK-checked
`next_status_id`. Rejected because it introduces a second source of truth for
which project a schedule belongs to (the mission chain already answers that) and
because a cross-project mission move would then have to rewrite the schedule row
or leave a genuinely dangling pointer. The key approach loses declarative FK
integrity, which the existing null-tolerant resolver already compensates for.

`ScheduleEditor` sends `nextStatusKey` instead of `nextStatusId`, selected from
the mission's project statuses it already has in `mission.statuses`.

---

## 4. Migration and backfill

Paired SQLite + Postgres migrations named
`2026MMDDHHMMSS_project_scoped_mission_statuses.sql`. Postgres wraps in
`BEGIN/COMMIT`; SQLite uses `PRAGMA foreign_keys = ON` and the table-rebuild
pattern already used in this repo (SQLite cannot alter a foreign key in place —
`missions` and `my_mission_positions` must be rebuilt via
create-new → copy → drop → rename, with every index recreated afterwards).

### 4.1 Ordered steps

1. **Create** `project_statuses` (empty).
2. **Fan out.** For every non-deleted project, insert one copy of its workspace's
   non-deleted statuses, minting a fresh `id` and preserving
   `key/name/type/position/is_default/is_terminal/metadata_json`. Timestamps are
   the migration timestamp; `revision` resets to 1.

   ```sql
   INSERT INTO project_statuses
     (id, workspace_id, project_id, key, name, type, position,
      is_default, is_terminal, metadata_json, created_at, updated_at, revision)
   SELECT <new-id>, p.workspace_id, p.id, ws.key, ws.name, ws.type, ws.position,
          ws.is_default, ws.is_terminal, ws.metadata_json, :now, :now, 1
     FROM projects p
     JOIN workspace_statuses ws
       ON ws.workspace_id = p.workspace_id AND ws.deleted_at IS NULL
    WHERE p.deleted_at IS NULL;
   ```

   Id generation differs per dialect: Postgres can use `gen_random_uuid()::text`;
   SQLite has no UUID function, so this step runs through a **migration runtime**
   module (the pattern already established by
   `database/src/objective-display-key-migration-runtime.ts` and
   `project-resources-resource-key-migration-runtime.ts`) that generates ids with
   `newId()` and executes the inserts. Use the runtime for both dialects so the
   generated ids are identical in shape.

   **Soft-deleted projects** are skipped. Their missions are already soft-deleted
   and their status pointers are never read; the `ON DELETE RESTRICT` FK is only
   enforced against rows that exist, and the old workspace rows are retained
   (step 7) precisely so nothing dangles.

3. **Repoint missions**, matching by `key` within the mission's own project:

   ```sql
   UPDATE missions m
      SET status_id = ps.id
     FROM workspace_statuses ws, project_statuses ps
    WHERE ws.id = m.status_id
      AND ps.project_id = m.project_id
      AND ps.key = ws.key;
   ```

4. **Repoint `my_mission_positions`** the same way, adding and backfilling
   `project_id` from the joined mission in the same statement.

5. **Backfill `schedules.next_status_key`** from the old
   `workspace_statuses.key`, then drop `next_status_id`.

6. **Verification gates.** The migration must fail loudly rather than land a
   half-migrated board. Assert, before dropping anything:
   - zero rows where `missions.deleted_at IS NULL` and `status_id` does not
     resolve in `project_statuses` for that mission's `project_id`;
   - every non-deleted project has exactly one `is_default`, one `type='execute'`,
     and one `type='review'` active status;
   - `count(project_statuses)` equals `count(projects) × count(statuses)` summed
     per workspace.

7. **Retain, do not drop, `workspace_statuses`** in this migration. Rename it to
   `workspace_statuses_legacy` and leave it read-only for one release as the
   rollback source and the audit trail for support. A follow-up migration one
   release later drops it. Dropping it in the same migration makes the rollback
   path a restore-from-backup, which is not acceptable for the Cloud edition's
   shared control plane.

### 4.2 Edge cases the backfill must handle

| Case | Handling |
| --- | --- |
| Workspace with zero projects | Nothing to fan out. Its statuses are legacy-only; the next project created there seeds `DEFAULT_STATUSES` (§5.1). |
| Workspace whose statuses were customized (renamed/reordered/added) | Copied verbatim per project; every project starts with the customized set. |
| Mission whose `status_id` points at a soft-deleted status | Cannot occur — `deleteWorkspaceStatus` refuses to delete a status with missions on it. Assert it anyway in step 6 and fall back to the project default with a logged warning. |
| A project that is `archived` | Treated identically to active; archived projects are unarchivable and must keep working boards. |
| Duplicate lowercase names in one workspace | Blocked today by `idx_workspace_statuses_active_name`, so the per-project copy is safe. |

## 5. Core service changes

### 5.1 Seeding moves to project creation

- `seedWorkspaceStatuses` → `seedProjectStatuses({ workspaceId, projectId, ... })`,
  same `DEFAULT_STATUSES` source.
- Remove the two workspace-create call sites (`backend/workspaces.ts:433`, `:570`).
- Add one call inside the `createProject` transaction
  (`backend/repository.ts:3162`, replacing the comment that currently explains why
  it does *not* seed) — and in every other project-creation path:
  `POST /api/projects/initialize` (the composite mobile path, contract v32),
  `ovld protocol create-project`, and `overlord_create_project`. All of these
  funnel through `createProject`, so one call site suffices; verify this in
  implementation rather than assuming it.

A project without a default/execute/review status is unusable — mission creation,
`attach`, and `deliver` all 409. Seeding must therefore be inside the same
transaction as the project insert, never a follow-up write.

### 5.2 Resolvers become project-scoped

The four resolvers in `packages/core/service/missions.ts` change from
`ctx.workspace.id` to an explicit `projectId` parameter:

```ts
getDefaultStatusId(ctx, projectId)
getReviewStatusId(ctx, projectId)
getExecuteStatusId(ctx, projectId)
getProjectStatusById(ctx, projectId, statusId)   // was getWorkspaceStatusById
```

Every caller already has the project in hand:

- `createMissionWithObjectives` (line 609) resolves the project before choosing a
  status — pass it straight through.
- `moveMissionToReview` / `moveMissionToExecute` both call `getMissionSummary`
  first, which returns `mission.projectId`. One-line change each.
- The error strings change from "Workspace has no default status" to
  "Project has no default status" — these are user-visible 409s, so update the
  webapp toast copy that matches on them, if any.

### 5.3 Backend CRUD becomes project-scoped

`resolveStatusWorkspaceId` → `resolveStatusProjectScope(db, projectId)`, which
loads the project, derives its `workspace_id`, and authorizes
`PERMISSIONS.PROJECT_UPDATE` on it. The helpers at ~400–490 change their
`workspace_id = ?` predicate to `project_id = ?`:
`uniqueStatusKey`, `assertUniqueStatusName`, `countActiveStatusesByType`,
`clearWorkspaceDefaultStatuses` → `clearProjectDefaultStatuses`.

The "this workspace already has a `${type}` status" 409 becomes "this project
already has a `${type}` status". The delete guards (`countMissionsOnStatus`,
default-status guard, execute/review guard) are unchanged in logic and now
naturally scope to the project because `status_id` is unique across projects.

**Authorization shift.** Status editing moves from `workspace:update` to
`project:update`. Under the shipped `overlord.rbac.toml`, `ADMIN` and `MANAGER`
hold `project:*`; `MEMBER` holds only `project:read`. So the effective set of
people who can edit statuses is unchanged (MEMBER could not edit them before
either, lacking `workspace:update`). No RBAC file change is required. State this
in the contract changelog so it is not mistaken for a silent privilege change.

### 5.4 Cross-project mission moves

`updateMission` (`backend/repository.ts:5379`) currently keeps the mission's
status across a project move because statuses are workspace-shared. That comment
and behavior must be replaced with an explicit **remap**:

1. If the caller supplied an explicit `statusId`, validate it belongs to the
   *target* project.
2. Otherwise resolve the source status's `key` in the target project.
3. Otherwise match on `lower(name)`.
4. Otherwise use the target project's default status.

In every branch, also rewrite `status_type`, reset `board_position` via
`topBoardPosition` in the new project, and repoint/delete the mission's
`my_mission_positions` rows (whose `project_id` must move with the mission —
extend the existing `cascadeMissionProjectId` helper). Emit
`mission.status_changed` when steps 3 or 4 actually changed the status.

### 5.5 My Missions reorder

`backend/repository.ts:6198` resolves a status id across the whole *organization*
and derives the workspace from it. It must additionally derive the **project** and
reject a status that does not belong to the target mission's project (§7.4). The
organization-wide lookup itself stays — My Missions legitimately spans workspaces —
but its per-mission validation tightens by one level.

### 5.6 Webhooks

`packages/core/service/webhook-events.ts:210` swaps its join to
`project_statuses` on `(m.project_id, m.status_id)`. The emitted
`status: { id, type, label }` shape is **unchanged**, so no consumer breaks. The
`id` values do change once (they are new rows) — note this in the webhook docs'
changelog, since a consumer that persisted status ids will see them rotate.

---

## 6. REST API surface

### 6.1 New — project-scoped CRUD

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/api/projects/:id/statuses` | `project:read` |
| POST | `/api/projects/:id/statuses` | `project:update` |
| PATCH | `/api/projects/:id/statuses/reorder` | `project:update` |
| PATCH | `/api/projects/:id/statuses/:statusId` | `project:update` |
| DELETE | `/api/projects/:id/statuses/:statusId` | `project:update` |

Bodies are unchanged apart from the type renames in §7.1.

### 6.2 New — the aggregate read

The single most important non-obvious consequence of this migration: **My Missions
and the mobile missions list stop needing N workspace queries and start needing M
project queries**, where M is much larger. A user in one workspace with 30
projects would go from 1 request to 30.

Add one aggregate endpoint and route both aggregate clients through it:

```
GET /api/workspaces/:id/project-statuses
→ ProjectStatusDto[]   // every non-deleted status of every non-deleted project
                       // in that workspace, each carrying projectId
```

Authorized exactly like the existing workspace-scoped read (active membership in
`:id`). This keeps My Missions at one request per workspace and keeps mobile's
existing `withThrowingTaskGroup` fan-out shape intact — only the URL and the
grouping key change.

### 6.3 Removed — both workspace status route families, in full

Every client ships in lockstep with the backend (the webapp is served by it; the
mobile release is coordinated with the deploy, per §9), so there is **no
compatibility window and no deprecated read**. All ten existing status routes are
deleted in the same change that adds §6.1 and §6.2:

- `GET` / `POST` / `PATCH` reorder / `PATCH :statusId` / `DELETE` on
  `/api/workspace/statuses*` (legacy active-workspace).
- `GET` / `POST` / `PATCH` reorder / `PATCH :statusId` / `DELETE` on
  `/api/workspaces/:id/statuses*`.

Mutating status definitions against a workspace has no coherent meaning once they
are project-owned, and the aggregate read (§6.2) is a strictly better shape than
the workspace read it replaces — it carries `projectId`, which every aggregate
client now needs.

Because there is no read to keep, `/api/workspaces/:id/project-statuses` could in
principle reuse the freed `/api/workspaces/:id/statuses` path. Use the explicit
`project-statuses` path anyway: an identical URL returning a differently-scoped
payload is exactly the shape that makes a stale client fail silently instead of
loudly with a 404.

---

## 7. Contract changes

Bump `CONTRACT.md` **Current version** `92` → `93` (the sole authoritative
statement), add a changelog row, and update `contract/components.yaml`. Also bump
`mcp/conformance-manifest.yaml` (`contractVersion: '92'` — the only manifest
currently at 92) and, when its client work lands, the mobile repo's manifest.

Do **not** touch `database/src/constants.ts:CONTRACT_VERSION` (`'1'`). Despite the
name it is the schema-ledger stamp written into `schema_migrations.contract_version`,
not the component contract version. The other conformance manifests are pinned at
older versions (connectors at 52, desktop at 35, the GitHub extension at 33) and
only move when their own surface changes — none of them do here.

### 7.1 `packages/contract/src/index.ts`

```ts
export interface ProjectStatusDto {
  id: string;
  workspaceId: string;
  projectId: string;      // new
  key: string;
  name: string;
  type: StatusType;
  position: number;
  isDefault: boolean;
  isTerminal: boolean;
}

export interface CreateProjectStatusBody { name: string; type: StatusType; isDefault?: boolean }
export interface UpdateProjectStatusBody { name?: string; isDefault?: boolean }
export interface ReorderProjectStatusesBody { orderedStatusIds: string[] }
```

The old `WorkspaceStatusDto` / `CreateWorkspaceStatusBody` /
`UpdateWorkspaceStatusBody` / `ReorderWorkspaceStatusesBody` names are **deleted,
not aliased**. The only TypeScript consumer is the webapp, which ships in
lockstep; mobile has its own Swift declarations. A deprecated alias would only
let a stale call site compile against a route that no longer exists, so the
rename is a single mechanical pass across `lib/api.ts`, `lib/queries.ts`, the
board, My Missions, and the settings page.

`MissionDetailDto.statuses` keeps its name and becomes "the statuses of this
mission's project" — a documentation change, not a shape change. Its
`ReorderProjectStatusesBody` doc comment changes "every status in the workspace"
to "every active status in the project".

### 7.2 `contract/extension-points.yaml`

Rename the `workspace_statuses.type` key to `project_statuses.type`; the value
list is unchanged. Rewrite the three constraints:

```yaml
    constraints:
      - 'Exactly one active status per project must have type=execute'
      - 'Exactly one active status per project must have type=review'
      - 'Exactly one active default status per project'
      - 'A mission status_id must belong to that mission's own project'
```

Mirror the type-vocabulary line at `CONTRACT.md:846`.

### 7.3 Entity changes and realtime

Rename the entity-change type `workspace_status` → `project_status` and include
`projectId` on the change record (`recordChange` already accepts it). In
`webapp/web/lib/realtime-invalidation.ts:180` the case narrows from
"invalidate everything workspace-scoped" to:

```ts
case 'project_status': {
  const projectId = projectIdFor(change);
  if (!projectId) return null;
  return [keys.projectStatuses(projectId), keys.missions(projectId), keys.myMissions];
}
```

This is a real improvement: editing one project's statuses no longer invalidates
every project-scoped query in the workspace.

### 7.4 Status-id writes reject out-of-project ids

Every write that accepts a status id — `PATCH /api/missions/:id` (`statusId`), the
board reorder, and the My Missions reorder (`backend/repository.ts:6198`) — must
**reject** a status id that does not belong to the target mission's own project,
with the existing `STATUS_UNAVAILABLE_FOR_WORKSPACE`-style 409 re-worded for
projects. There is no sibling-project remap: every client sends an in-project id
from day one.

This is also enforced declaratively by the `(project_id, status_id)` composite FK
(§3.2), so a service-layer bug cannot corrupt the board — the write fails at the
database instead. The service check exists to return a useful error rather than a
constraint violation.

The one place a `key`-based remap *does* survive is the cross-project mission move
(§5.4), which is a different problem: there the mission is deliberately changing
projects and its status must follow it.

---

## 8. Webapp and desktop

### 8.1 Settings

- Move `components/settings/StatusesPage.tsx` →
  `components/projects/project-settings/StatusesPage.tsx`, prop `projectId: string`
  (no longer optional — there is no "active project" fallback).
- Add `{ name: 'Card statuses', icon: GitBranch }` to `navItems` in
  `ProjectSettingsModal.tsx`, between **Tags** and **Integrations**, and render it.
- Delete `{ name: 'Card statuses', icon: GitBranch }` from `WorkspaceSettingsModal.tsx`
  and its render branch, and remove the now-unused import.
- `ProjectSettingsNavSection` gains the member; `WorkspaceSettingsNavSection`
  loses it — grep for any deep-link that passes `initialNav: 'Card statuses'`.

The page body itself needs almost no change: it is already parameterized by an id
and drives everything through the query hooks.

### 8.2 Transport

- `lib/query-keys.ts`: replace `workspaceStatuses(workspaceId?)` with
  `projectStatuses(projectId)` → `['project', id, 'statuses']` (matching the
  existing `projectTags` shape) and add
  `workspaceProjectStatuses(workspaceId)` → `['workspace', id, 'project-statuses']`
  for the aggregate.
- `lib/api.ts`: replace the five workspace status calls with five project calls
  plus `listWorkspaceProjectStatuses(workspaceId)`.
- `lib/queries.ts`: `useWorkspaceStatuses` → `useProjectStatuses(projectId)`;
  the four mutation hooks take `projectId` and write to the project key.

### 8.3 Board

`BoardPage.tsx` swaps `useWorkspaceStatuses(workspaceId)` for
`useProjectStatuses(projectId)` — it already has `projectId`. Everything
downstream (`baseColumns`, the status filter, `completeStatusId`,
`visibleStatuses`, `BoardColumn`, `useBoardColumnDnd`) is unchanged.

### 8.4 My Missions — the real work

`pages/my-missions-columns.ts` re-keys from workspace to project:

- `MergedStatusColumn.statusIdByWorkspace` → `statusIdByProject`
- `buildMergedStatusColumns(orderedProjectIds, statusesByProject)`
- `resolveMergedColumnReorder` looks up `column.statusIdByProject.get(mission.projectId)`
  and slices `mergedOrderedMissionIds` by `projectId`, since the reorder endpoint
  persists one project's slice at a time.
- The "status doesn't exist in this workspace" error string becomes
  "…in this project".

`pages/MyMissionsPage.tsx` replaces its per-workspace `statusQueries` fan-out with
one `useWorkspaceProjectStatuses` per workspace (§6.2), groups the result by
`projectId`, and derives `orderedProjectIds` from the missions' own project order
(project position within workspace, workspaces in their existing order). The
"move to complete" path at line 445 looks up the complete status in the
**mission's project**, not its workspace.

Column-count blowup is worth calling out: with per-project customization, the
merged column list is the union of distinct status names across every project the
user has assigned missions in. Immediately after migration this is identical to
today (all projects share one set). It only grows when users diverge. v1 keeps
the merge-by-lowercase-name behavior; a per-project column grouping mode is
deferred (§13).

### 8.5 Scheduling

`ScheduleEditor.tsx` / `schedule-editor-helpers.ts` swap `nextStatusId` for
`nextStatusKey`, selecting from `mission.statuses` (already the project's set via
`MissionDetailDto`). `MissionSchedulingControls.tsx` and `MissionPanel.tsx` pass
`mission.statuses` through unchanged.

### 8.6 Desktop

No shell work. Confirmed: no `statuses` references anywhere under `desktop/`. It
renders the webapp, so it inherits the settings move.

---

## 9. Mobile (`OverlordMobile`)

**The mobile release is coordinated with the backend deploy.** It does not need to
work against the old routes, and the backend does not need to keep them. That
decision is what removes the compatibility projection, the sibling-project remap,
and the deprecated contract aliases from this plan — it is by far the largest
simplification available here, and it is why §6.3 deletes all ten legacy routes
outright.

The trade is that the deploy is genuinely atomic: the shipped build calls
`/api/workspaces/:id/statuses`, which will 404 the moment the backend ships. Users
who have not updated see the missions list fail to load statuses until they do.
Confirm the app-store review lead time is acceptable before scheduling the backend
deploy, and consider gating the backend release behind the mobile build reaching
"ready for sale" rather than "submitted".

### 9.1 The mobile update

1. `OverlordCore/Contract.swift:508` — rename `WorkspaceStatusDto` →
   `ProjectStatusDto`, add `let projectId: String`.
2. `OverlordCore/APIClient.swift:188` — repoint `listWorkspaceStatuses(workspaceId:)`
   to `/api/workspaces/{id}/project-statuses` and rename it
   `listProjectStatuses(workspaceId:)`; optionally add a per-project
   `listProjectStatuses(projectId:)` for a future project settings screen.
3. `Overlord/Lib/WorkspaceData.swift` — `allWorkspaceStatuses` keeps its
   per-workspace fan-out (one request each, unchanged cost) and the cache key
   `QueryKeys.allStatuses` stays workspace-keyed; dedupe by `id` still works.
4. `Overlord/Lib/Missions.swift`:
   - `statusColumns(statuses:orderedWorkspaceIds:)` → `orderedProjectIds:`,
     grouping by `\.projectId` instead of `\.workspaceId`.
   - `preferredCompleteStatus(for workspaceId:)` → `for projectId:` — **the
     required fix**; every caller passes `mission.projectId`. Without the
     server-side remap, a workspace-scoped lookup here now produces a 409 rather
     than degrading, so this one is not optional.
   - `statusName(for:statuses:)` unchanged.
5. `Overlord/Views/MissionsList/MissionsScreen.swift` — pass ordered project ids
   into `statusColumns`; the move path at 599/627 selects the target status from
   the mission's own project.
6. `Overlord/Views/Home/HomeScreen.swift:504` — no logic change.
7. `Overlord/Views/MissionDetail/MissionDetailScreen.swift` and
   `MissionDetailAdapters.swift:104` — no change; they already read
   `mission.statuses` from `MissionDetailDto`, which is the project's set.
8. `OverlordTests/ContractCodingTests.swift` — update the DTO fixture.
9. `conformance-manifest.yaml` in the mobile repo — bump to contract 93.

Watch/`OverlordWatchShared/WatchMissionTransport.swift` and
`WatchMissionInbox.swift` carry a `statuses:` field that is a list of *watch draft
statuses*, unrelated to mission card statuses. No change; note it so nobody
migrates it by grep.

### 9.2 Release ordering

Backend v93 and the mobile build in §9.1 ship together. Neither tolerates the
other's old surface: the new mobile build 404s against a pre-v93 backend, and the
old build 404s against v93. Sequence the deploy and the app release accordingly.

---

## 10. CLI

The CLI does not read or write status definitions today, and the protocol surface
is type-based, so there is no lifecycle work. The changes are:

### 10.1 New read command (recommended, additive)

```
ovld statuses list --project-id <id|slug|name> [--json]
ovld protocol statuses --project-id <id>        # protocol alias for agents
```

Prints `key`, `name`, `type`, `position`, and default/terminal flags for one
project. This is worth adding in the same change because it is the only way for
an agent or a scripted operator to discover a project's board columns now that
they vary per project. Read-only, `project:read`, added to
`cli/src/protocol-help.ts`, `cli/src/help.ts`, and `cli/src/flag-registry.ts`.

### 10.2 Fix the documented-but-missing `--status` filter

`ovld missions list --status <csv>` is documented in `cli/src/help.ts:65`,
`cli/src/protocol-help.ts:199`, and `cli/src/flag-registry.ts:118`, but
`cli/src/commands.ts:1691` never forwards it — it builds `q`, `projectId`, and
`limit` only. This is pre-existing drift, not caused by this migration, but this
is the right moment to fix it: forward `--status` as a `statusTypes` CSV
(`searchMissions` in `packages/core/service/missions.ts:810` already accepts
`statusTypes`) and document unambiguously that it filters **status types**, not
project-defined status names.

### 10.3 Documentation

- `cli/docs/06-core-domain-and-lifecycle.md` — the "Mission Status Requirements"
  section already says "per project" for the singleton rules and already predicts
  this change ("Status names should be configurable per project later"). Delete
  the "later", and correct the remaining workspace-scoped phrasing.
- `cli/README.md:251` — no change needed (the link text already says "statuses").
- `docs/src/content/docs/planning-and-tracking.mdx:45` — the "Lifecycle statuses"
  section describes types; add one sentence saying status *names and order* are
  configured per project in project settings.
- `docs/src/content/docs/docs-for-agents/webhooks.mdx:69` — change "moves between
  workspace statuses" to "moves between the project's statuses".

### 10.4 Unchanged, and worth asserting in tests

`--phase draft|execute|review|deliver|complete|blocked|cancelled`,
`attach` → execute, `deliver` → review, `record-work` → review-status mission
creation, and `protocol search-missions --status next-up,execute` all keep
working with no code change. Add regression tests that prove it (§12).

---

## 11. MCP

### 11.1 Changes

- `mcp/tool-catalog.ts:96` — `overlord_search_missions.status` description
  currently reads "Comma-separated status types, such as draft,execute,review."
  This is already correct; tighten it to say status *types* are workspace-invariant
  and that project-defined status names are not accepted here.
- **New tool `overlord_list_project_statuses`** (read-only, `project:read`),
  taking `projectId` and returning the project's ordered statuses. Same rationale
  as §10.1: agents that read or reason about a board need to discover columns that
  now vary per project. Mirror it in the codex/cursor/antigravity connector shims,
  matching how `overlord_create_project` was mirrored.
- `mcp/conformance-manifest.yaml` — bump to contract 93.

### 11.2 Unchanged

`overlord_load_mission_context` returns mission context whose statuses are already
the mission's project's set. `overlord_create_mission`, `overlord_record_work`,
`overlord_attach_session`, `overlord_deliver_session` are all type-driven.
`contract/protocol-commands.yaml` needs no side-effect changes —
`mission-status-to-execute` / `mission-status-to-review` /
`creates-mission-in-review-status` remain accurate.

---

## 12. Tests

**Database / migration**
- Fan-out produces `projects × statuses` rows per workspace, with keys preserved.
- Every mission's `status_id` resolves in its own project after backfill.
- The composite FK rejects `UPDATE missions SET status_id = <other project's status>`.
- Per-project singleton indexes reject a second default / execute / review.
- Two projects in one workspace can each hold a status named "In Progress".
- A workspace with zero projects migrates cleanly.
- `mission_status_seen` rows are untouched.
- Rollback path restores a board that was never edited post-migration.

**Core**
- `createMissionWithObjectives` picks the *project's* default, and a mission
  created in project B is unaffected by project A's default.
- `attach` → project's execute status; `deliver` → project's review status.
- A project missing a review status 409s with a project-scoped message.

**Backend**
- Full CRUD on `/api/projects/:id/statuses` including reorder.
- Delete guards: last default, execute/review, status with missions on it.
- `project:update` required to mutate; `project:read` sufficient to list; a
  non-member reads as 404.
- Cross-project mission move remaps by key, then name, then default (§5.4).
- A status id from a sibling project in the same workspace is **rejected** with a
  409 on every status-id write — mission PATCH, board reorder, My Missions
  reorder (§7.4).
- `GET /api/workspaces/:id/project-statuses` returns exactly the caller's
  readable projects' statuses.
- Every removed route (`/api/workspace/statuses*`, `/api/workspaces/:id/statuses*`)
  is gone — a request to any of the ten returns 404, not a silently-scoped payload.

**Webapp**
- `buildMergedStatusColumns` merges by name across *projects*; two projects with
  divergent names produce the union.
- `resolveMergedColumnReorder` returns null when the mission's project has no
  status with that column's name.
- Board columns come from the project, not the workspace.

**CLI / MCP**
- `ovld protocol attach` / `deliver` still land the mission in execute/review with
  a project-scoped status set — the regression test that guards §10.4.
- `--status` CSV now actually filters (§10.2).
- `overlord_list_project_statuses` returns ordered rows.

**Mobile** — `ContractCodingTests` decodes `ProjectStatusDto` including
`projectId`; `statusColumns` groups by project; `preferredCompleteStatus(for:)`
selects within the mission's project (a workspace-scoped selection now 409s
server-side, so this has no graceful failure mode).

---

## 13. Phasing

Each phase is independently shippable and leaves the product working.

| Phase | Content | Gate |
| --- | --- | --- |
| **A — Contract** | Version 93, DTO renames (no aliases), `extension-points.yaml`, `components.yaml`, `CONTRACT.md` changelog | Contract review |
| **B — Schema** | Paired migrations, migration runtime, fan-out backfill, FK repointing, verification gates, `workspace_statuses_legacy` retention | All §12 database tests green on both dialects |
| **C — Core + REST** | Project-scoped resolvers and CRUD, project-create seeding, new project routes, aggregate route, **deletion of all ten legacy status routes**, out-of-project write rejection, cross-project move remap, schedule key resolution, webhook join | Backend tests |
| **D — Webapp** | Settings page move, transport rename, board, My Missions re-keying, scheduling editor | Manual board + My Missions pass with two divergent projects |
| **E — Mobile** | §9.1, built and submitted against a v93 staging backend | Mobile build approved and ready for release |
| **F — CLI + MCP + docs** | `statuses list`, `--status` fix, new MCP tool, all doc updates | `drift-review` clean |
| **G — Cleanup (next version)** | Drop `workspace_statuses_legacy` | One release elapsed with no rollback needed; the v93 rollback path is expired |

**A–E ship as one release.** The schema and the service that reads it cannot be
split across deploys against the Cloud edition's shared control plane, the webapp
is served by the backend, and — with no compatibility layer — the mobile build and
the backend are mutually exclusive with each other's old surface. E is built and
approved ahead of the deploy, then released alongside it. F is independent and can
land any time after C. G is a full contract version later and expires the retained
legacy rollback window.

---

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Users on the pre-v93 mobile build lose the missions list until they update | Accepted, per the lockstep decision (§9). No compatibility layer exists: the old build 404s the moment v93 deploys. Gate the backend deploy on the mobile build being ready for release, not merely submitted |
| The new mobile build is released before the backend deploys | It 404s in the other direction. Same gate, enforced from both sides: neither artifact goes out without the other |
| A project ends up with no default/execute/review status | Seeding inside the project-create transaction; migration verification gate; 409 with an actionable message |
| Status ids rotate, breaking webhook consumers that persisted them | Documented in the webhooks changelog; the `type` field (which consumers should key on) is stable |
| My Missions column explosion once projects diverge | Accepted for v1 — identical to today at migration time; per-project grouping deferred |
| SQLite FK changes require full table rebuilds of `missions` | Established repo pattern; rebuild + index recreation covered by the §12 conformance tests on both dialects |

---

## 15. Deferred

- A workspace-level **status template** that new projects inherit (this plan seeds
  from the hardcoded `DEFAULT_STATUSES` instead). Worth revisiting once users
  actually diverge per project.
- Copying one project's status set onto another ("apply statuses from…").
- A My Missions display mode that groups by project instead of merging by name.
- Per-project status colors / metadata (`metadata_json` is carried through the
  migration but still unused).
- Allowing more than one `execute` or `review` status per project.
