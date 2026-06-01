# Implementation Plan: Target-Scoped Resources, Target Ownership & Multi-Org Runner

**Ticket:** 1:1306 — Review project resource management code
**Objective:** d3072e9a-d27d-457e-bb40-29c2bba97d84

> Tests are written **before** the code in every phase below. Legacy/backfill
> compatibility is explicitly **out of scope** (per the objective): we change the
> model to the target it should be, without preserving the old per-user
> behavior or worrying about migrating historical rows.

---

## Goals (as agreed)

1. **G1 — `ovld` finds the resource on its target.** The primary resource
   directory is keyed by **(project, execution_target)**. A runner on a given
   target resolves "where does this project live here" from the primary row for
   that (project, target).
2. **G2 — Primary is target-scoped, not user-scoped.** On a shared target,
   there is exactly one primary per (project, target). Who may change it depends
   on **target ownership** (see below).
3. **G3 — One runner serves all of a user's orgs on a target.** `ovld` is
   **org-agnostic**; the server claims queued work across every org the user is a
   member of that shares the target. Access stays gated by org membership +
   target ownership + project permission server-side.
4. **G4 — No primary ⇒ throw an error** when execution is attempted (request
   time), naming the project + target. Claim time is a fail-closed backstop.

### Target ownership model (the key design decision)

Add a nullable owner to the **org↔target** join (`organization_execution_targets`),
not to `execution_targets` (a target can be shared across orgs; ownership must be
per-org so my laptop can be "mine" in both my orgs while a shared server is
org-owned elsewhere).

```
organization_execution_targets.owner_user_id uuid null  -- NEW
```

- **`owner_user_id` set → personal target.** Only the owner may add/remove
  directories or set the primary for any project on it (in that org).
- **`owner_user_id` null → organization-owned target.** Any user with **edit
  permission on the directory's project** may change directories/primary.

Write authority is therefore a single predicate, enforced both in application
code (the real gate — all write paths use the service-role client) and in RLS
(defense-in-depth):

```
can_manage_resource(user, project, target):
  oet = organization_execution_targets[project.org, target]
  if oet.owner_user_id is not null: return user == oet.owner_user_id
  else:                             return has_project_edit_permission(user, project.org)
```

`has_project_edit_permission` = `has_org_role(org, ARRAY['ADMIN','MANAGER'])`
(VIEWER is read-only; AGENT is for automated agents, not interactive directory
edits). **Confirm this role set matches the project's existing "edit" gate** when
implementing — reuse the project edit predicate if one already exists rather than
hard-coding roles.

---

## Current state (verified) & what changes

The schema is *already* target-scoped where it counts; the bugs are in the app
layer assuming per-user scope:

- `project_resource_directories_target_path_uidx (project_id, execution_target_id, directory_path)` — already target-scoped path uniqueness. **Keep.**
- `project_resource_directories_primary_target_uidx (project_id, execution_target_id) WHERE is_primary` — already one-primary-per-(project,target). **Keep.** (This is why the prior review's "add user_id to the index" recommendation is now *reversed*: target-scoping is the intended behavior.)
- `project_resource_directories.user_id` (NOT NULL) → **re-interpreted as `added_by` audit only.** No column rename required; semantics change. The unique key and primary index already ignore it.
- Read paths filter by `user_id` → **must drop the user filter** and resolve per (project, target).
- Clear-primary writes filter by `(project, execution_target)` only → **now correct** (target-scoped). Just ensure all three write paths share one helper.
- `claim-execution` narrows to a single org → **broaden to the user's member orgs that share the target.**

---

## Phase 0 — Schema & RLS

### 0.1 Tests first

- **`tests/db/organization_execution_target_ownership.test.ts`** (or extend the
  existing migration/RLS test harness — match whatever pattern
  `tests/lib/overlord/execution-targets.test.ts` and existing DB tests use):
  - New column `owner_user_id` exists, nullable, FK to `auth.users`, `on delete set null`.
  - Default on insert via `ensureAssociations` is the registering user (personal) unless explicitly org-owned.
- **`tests/db/project_resource_directories_rls.test.ts`** — RLS behavior using
  two seeded users + one shared target:
  - Personal target (owner = userA): userB **cannot** insert/update/delete/set-primary a directory; userA can. userB (org member) **can** still SELECT the primary.
  - Org-owned target (owner = null): userB with MANAGER/ADMIN on the project **can** set primary; a VIEWER cannot write but can read.
  - Primary uniqueness: setting a new primary clears the prior one for the same (project, target) regardless of who owns the rows.

### 0.2 Implementation

- **Migration `…_execution_target_ownership.sql`:**
  - `alter table organization_execution_targets add column owner_user_id uuid references auth.users(id) on delete set null;`
  - Index `organization_execution_targets_owner_idx (owner_user_id) where owner_user_id is not null`.
- **Migration `…_resource_directory_ownership_rls.sql`:**
  - Add SQL helper `public.can_manage_project_resource_directory(p_project_id uuid, p_execution_target_id uuid) returns boolean` implementing the predicate above (security definer, stable).
  - Replace `project_resource_directories` write policies (insert/update/delete) to use the helper.
  - Broaden the SELECT policy: visible to any member of the project's org (not just self-or-org-admin), so members can see the shared primary.
- `yarn generate` to refresh `types/database.types.ts`; `yarn seed:sync`.

---

## Phase 1 — Shared authorization & primary helpers

Consolidate the three divergent add paths and the scattered clear-primary logic
into one module so behavior can't drift again.

### 1.1 Tests first

- **`tests/lib/resource-directories/primary-resource.test.ts`** (new):
  - `getPrimaryProjectResourceDirectoriesByProjectId` resolves per (project, target) with **no** `user_id` filter; returns one primary per project (optionally filtered by `executionTargetId`).
  - `resolveTargetOwnership(project, target)` returns `owner_user_id` for the project's org.
  - `assertCanManagePrimary(user, project, target)` allows the owner on a personal target, allows project-editors on an org-owned target, throws otherwise.
  - `shouldAutoPrimary(project, target)` returns true iff **no primary currently exists** for (project, target) (not "no rows"), so the first directory auto-promotes and a "rows exist but none primary" state self-heals.

### 1.2 Implementation

- In `lib/resource-directories/primary-resource.ts`:
  - Drop `.eq('user_id', userId)` from `getPrimaryProjectResourceDirectoriesByProjectId`; key the result map by `project_id` from the primary row.
  - Replace `targetHasProjectResourceDirectory` with `targetHasPrimaryResourceDirectory` (checks `is_primary = true`), used for auto-promotion.
  - Add `resolveTargetOwnership` and `assertCanManagePrimary` (and a non-throwing `canManagePrimary`).
  - Add `clearTargetPrimary(serviceClient, projectId, executionTargetId)` — the single canonical clear used everywhere.

---

## Phase 2 — Write paths (add / set-primary / remove / update), all three surfaces

Surfaces: server action `lib/actions/resource-directories.ts`, REST
`apps/web/app/api/protocol/{add,update}-project-resource/route.ts`, edge MCP
`supabase/functions/mcp/handlers/{add,update}-project-resource.ts`, and the SSH
sync in `lib/actions/projects.ts` (`syncSshRemoteResource`).

### 2.1 Tests first

- **`tests/lib/actions/resource-directories.test.ts`** (new/extended):
  - Add on a personal target by a non-owner → throws (authorization).
  - Add first directory auto-promotes to primary on **all three** paths (server action, REST, edge) — uses the shared `shouldAutoPrimary` helper.
  - `setResourceDirectoryPrimaryAction` clears the prior primary for the (project, target) and sets the new one, across users on a shared org-owned target (no 23505).
  - `removeProjectResourceDirectoryAction` of a primary **promotes the next** directory for that (project, target) (oldest remaining), leaving exactly one primary; removing a non-primary leaves the primary intact.
- **`tests/app/api/protocol/add-project-resource.test.ts`** and
  **`tests/app/api/protocol/update-project-resource.test.ts`** (extend if
  present): same auto-primary + authorization behavior as the server action.
- **Edge handler tests** under `supabase/functions/mcp/handlers/__tests__/` (match
  existing edge test pattern): `add-project-resource` auto-promotes the first
  directory and respects ownership.

### 2.2 Implementation

- All add paths: replace ad-hoc `isPrimary`/`shouldSetPrimary` logic with
  `shouldAutoPrimary` + `assertCanManagePrimary`; clear via `clearTargetPrimary`.
- `setResourceDirectoryPrimaryAction`: drop `.eq('user_id', …)` guards; gate with
  `assertCanManagePrimary`; clear + set scoped to (project, target).
- `removeProjectResourceDirectoryAction`: gate with `assertCanManagePrimary`; after
  deleting, if the deleted row was primary, promote the oldest remaining row for
  (project, target).
- `syncSshRemoteResource` (`projects.ts:445`): use `clearTargetPrimary`; gate with
  ownership.
- Add `setExecutionTargetOwnershipAction({ targetId, organizationId, ownerUserId })`
  gated to org **ADMIN** or the current owner (transfer / donate-to-org). Tests in
  `tests/lib/actions/execution-target-ownership.test.ts` first.

---

## Phase 3 — Read/consumer paths (synthesized local/remote dirs)

Consumers that synthesize `local_working_directory` / `remote_working_directory`
must resolve the **target-scoped** primary, not a per-user one.

### 3.1 Tests first

- Extend **`tests/lib/actions/projects.test.ts`** (or add): 
  - `getProjectUserLocalSettingsByProjectId` and `getProjectUserSshSettingsByProjectId` resolve the (project, target) primary regardless of which user added it.
  - An org admin/member viewing a project on a shared target sees the same primary as the owner.

### 3.2 Implementation

- `getProjectUserLocalSettingsByProjectId` / `getProjectUserSshSettingsByProjectId`
  (`projects.ts`): drop user filters on the resource lookup; resolve by
  (project, target). Keep SSH **credentials** per-user (those remain personal).
- `apps/web/app/api/projects/[projectId]/file-tree/route.ts` and any other
  `is_primary` reader: confirm target-scoped resolution.

---

## Phase 4 — `claim-execution`: org-agnostic, cross-org, target-scoped working dir

### 4.1 Tests first

- **`tests/app/api/protocol/claim-execution.test.ts`** (new/extended):
  - A user who is a member of org A and org B, running one target shared by both,
    claims queued requests from **both** orgs in successive polls (no org filter
    from the token).
  - A request whose org does **not** share the claiming target is **not** claimed.
  - Working-directory fallback resolves the (project, target) **primary** (no
    `user_id` filter) and only on the claiming target.
  - Backstop: if a project request reaches claim with no primary on the claiming
    target, the request is left for retry and a `ticket_event` records the missing
    primary (no silent skip).

### 4.2 Implementation

- In `claim-execution/route.ts`:
  - Resolve the user's member org ids (`members` where `user_id = userId`),
    intersect with orgs that include the claiming target
    (`organization_execution_targets.execution_target_id = executionTargetId`).
  - Replace `.eq('organization_id', organizationId)` with `.in('organization_id', allowedOrgIds)`; keep `.eq('requested_by', userId)`.
  - `resolveWorkingDirectory` fallback: drop the `user_id` requirement; select the
    (project, target) primary (`is_primary` desc) and keep the
    `execution_target_id === executionTargetId` guard.
  - On `project_id && !workingDirectory && !sshCommand`: instead of silently
    `continue`, record a `ticket_event` ("No primary directory for <project> on
    this target") then continue (fail-closed backstop to G4).
- **CLI:** stop sending `x-organization-id` for the claim poll (server ignores it
  for scoping now). Optional but cleanest; the server is authoritative.

---

## Phase 5 — Request-time error when no primary (G4)

### 5.1 Tests first

- **`tests/lib/overlord/execution-requests.test.ts`** (extend):
  - `createExecutionRequest` with a **specific** `targetExecutionTargetId` and no
    primary for (project, target) → throws a clear error naming project + target;
    nothing is queued.
  - With a target-agnostic (`any`) request and the project has **no primary on any
    reachable target** → throws.
  - When a primary exists → request is created normally (existing behavior intact).

### 5.2 Implementation

- In `createExecutionRequest` (`lib/overlord/execution-requests.ts`), after
  resolving the ticket/objective and when `ticket.project_id` is set:
  - If `targetExecutionTargetId` is provided: assert a primary exists for
    (project, target); else `throw new Error('No primary directory is set for "<project>" on "<target>". Set a primary directory before running.')`.
  - If `targetKind === 'any'` / no specific target: assert the project has at least
    one primary on a target the requester can reach (member-org ∩ project targets);
    else throw a similar error.
- Surface the thrown message in the web/desktop "Run" UI (it already renders action
  errors); no special UI work beyond confirming the message is shown.

---

## Phase 6 — Add-time ownership UX

### 6.1 Tests first

- Component/action tests: SSH target add form includes an "Organization-owned
  (anyone with project access can manage directories)" toggle; default is
  **personal (owner = me)**. `ensureAssociations` persists `owner_user_id`
  accordingly and **does not** overwrite ownership on conflict (ownership changes
  only via `setExecutionTargetOwnershipAction`).

### 6.2 Implementation

- `ensureAssociations` (`execution-targets.ts`): accept `ownerUserId?: string | null`;
  set on first insert; on conflict leave existing `owner_user_id` untouched.
- `upsertExecutionTargetFromProtocol` (self-registered laptop): default
  `ownerUserId = userId` (personal).
- `upsertSshExecutionTarget`: pass through the caller's ownership choice.
- UI: add the toggle to the SSH/target add form; show an "Owner: <user> / Organization"
  badge + a transfer/donate control (calls `setExecutionTargetOwnershipAction`,
  admin-or-owner only) on the target settings surface.
  `ProjectExecutionWorkspaceSelector.tsx` already renders the primary; ensure it
  reflects target-scoped primary and disables edit affordances when the current
  user lacks `canManagePrimary`.

---

## Out of scope (explicit)

- Backfilling/migrating historical `project_resource_directories` rows or the
  legacy device-implicit directories (objective: "Don't worry about legacy
  functionality").
- The prior review's Finding #1 ("add user_id to the primary index") — **reversed**;
  target-scoping is now the intended behavior.
- The prior review's Finding #7 (backfill row deletion) — legacy, out of scope.

## Test → Code ordering summary

Each phase lands its tests red first, then the implementation to green:
Phase 0 (schema/RLS) → 1 (helpers) → 2 (writes) → 3 (reads) → 4 (claim) →
5 (request error) → 6 (ownership UX). Phases 1–5 are the functional core; 0 gates
them; 6 is the UX surface for ownership.

## Open confirmations to resolve during implementation

- Exact role set for `has_project_edit_permission` on org-owned targets
  (proposed `['ADMIN','MANAGER']`) — reuse the project's existing edit gate if one exists. DECISION: Agree with proposed roles.
- Whether a target-agnostic (`any`) run should hard-error at request time, or only
  the specific-target run (proposed: error in both, but the `any` check is "no
  primary on *any* reachable target"). DECISION: Error in both.

---

## Implementation status (executed 2026-06-01)

All seven phases are implemented and tests-first where the harness can run them.

- **Phase 0** — Migrations `20260601100000_execution_target_ownership.sql`
  (nullable `owner_user_id` + partial index) and
  `20260601100100_resource_directory_ownership_rls.sql`
  (`can_manage_project_resource_directory` SQL helper, ownership-aware
  insert/update/delete policies, org-member SELECT). `owner_user_id` synced into
  `types/database.types.ts` by hand (no live Supabase to run `yarn generate`/
  `yarn seed:sync` — run both when a stack is available). RLS behavior covered by
  `tests/supabase/project-resource-directory-ownership-rls.test.ts` (runs against a
  live local stack).
- **Phase 1** — `lib/resource-directories/primary-resource.ts`: dropped the user
  filter; `targetHasPrimaryResourceDirectory` / `shouldAutoPrimary` /
  `resolveTargetOwnership` / `canManagePrimary` / `assertCanManagePrimary` /
  `clearTargetPrimary`. Unit-tested.
- **Phase 2** — Server action, REST add/update, edge MCP add/update (shared
  `supabase/functions/mcp/handlers/_resource-authority.ts`), and
  `syncSshRemoteResource` unified on the helpers; remove promotes the next
  directory; `setExecutionTargetOwnershipAction` added. Unit-tested.
- **Phase 3** — `getProjectUserLocalSettingsByProjectId` /
  `getProjectUserSshSettingsByProjectId` / `getProjectResourceDirectoriesAction` /
  `getProjectDevicesAction` / file-tree route resolve the target-scoped primary.
- **Phase 4** — `claim-execution` is org-agnostic (member-orgs ∩ target-sharing
  orgs), working-dir fallback is the (project, target) primary only, missing-primary
  records a `ticket_event` backstop; the CLI does a single org-agnostic poll when
  unpinned (`createClaimOrganizationScope`).
- **Phase 5** — `createExecutionRequest` throws at request time when no primary
  (names project + target for a specific target, project for `any`), skipped when an
  explicit working dir / ssh command / resource is supplied.
- **Phase 6** — `ensureAssociations` sets `owner_user_id` on first insert only;
  self-registered + SSH targets default personal; SSH form accepts
  `organizationOwned`; `getProjectDevicesAction` returns `ownerUserId` + `canManage`;
  `DeviceResourceList` shows a Personal/Org-owned badge and gates edit affordances on
  `canManage`. (A dedicated owner-transfer control in the UI calls
  `setExecutionTargetOwnershipAction` — the action and the per-device permission
  signal are in place; the explicit transfer button can be added on the target
  settings surface.)

## Launch-pipeline alignment (Codex review remediation, 2026-06-01)

`code-reviews/AGENT_LAUNCH_PIPELINE_REVIEW_2026-06-01.md` flagged where the
multi-org runner work left the launch lifecycle out of step with the
org-agnostic decision (G3). Resolved:

- **Finding #1 — post-claim lifecycle is now org-agnostic too.** The runner
  claims across every target-sharing member org, so `complete-execution-launch`
  and `fail-execution-launch` must not pin to the token's default org (a request
  claimed for org B would otherwise 404 and leave the row `claimed` until lease
  expiry, risking duplicate agents). New `findUserExecutionTargetByFingerprint`
  resolves the target by user only; both routes now match the request by `id` +
  `requested_by` + `claimed_by_execution_target_id` with **no** org filter.
- **Finding #2 — left as designed.** Claims are intentionally org-agnostic; the
  `--organization-id` pin remains a fan-out hint for list/clear only. No change.
- **Finding #3 — explicit `targetResourceId` is validated before it is trusted.**
  `createExecutionRequest` now asserts the resource exists, belongs to the
  ticket's project, and (when a target is pinned) lives on that target — closing
  the hole where a caller could point a project run at another project's checkout
  and skip the no-primary guard. `claim-execution`'s `resolveWorkingDirectory`
  also compares `project_id` as defense-in-depth.
- **Finding #4 — execution request id is threaded end-to-end.** `ovld protocol
  attach` reads `OVERLORD_EXECUTION_REQUEST_ID` (or `--execution-request-id`)
  into attach metadata, and the runner's terminal-profile launch script now
  exports it (the direct-spawn path already inherited it), so attach marks the
  exact request `launched` instead of falling back to objective matching.
- **Finding #5 — the missing-primary backstop no longer spams.** The G4
  claim-time backstop stamps `execution_requests.last_error` and emits the
  `ticket_event` only on the transition into the missing-primary state; a runner
  polling every few seconds no longer floods the activity feed. `last_error` is
  cleared on a successful claim, so a recurrence re-notifies.
