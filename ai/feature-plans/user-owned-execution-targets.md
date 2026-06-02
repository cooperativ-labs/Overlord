# User-Owned vs Org-Owned Execution Targets — Goal Review & Complications

**Ticket:** 1:1324 — "Allow users to own execution targets"

## Stated goal

> Users should be able to set whole `execution_targets` as user-owned vs
> org-owned (currently this is done per project). Example: my laptop is still my
> laptop for all projects. Default should be user-owned; the user can then set it
> org-owned. Admins can claim org-owned targets as user-owned.

## TL;DR — the goal is already largely implemented

The premise that ownership "is done per project" is **stale**. The ownership
model was moved off the project layer in the `20260601*` migrations and now lives
at the **(organization, target)** level, which is exactly what the goal asks for.
The full stack already exists:

- **Schema** — `organization_execution_targets.owner_user_id`
  (`supabase/migrations/20260601100000_execution_target_ownership.sql`). Comment:
  set → personal target (only owner manages); null → org-owned (any project
  editor manages).
- **Authorization** — `can_manage_project_resource_directory(project, target)`
  RLS function + policies
  (`20260601100100_resource_directory_ownership_rls.sql`), mirrored in app code.
- **Server actions** — `setExecutionTargetOwnershipAction` /
  `claimExecutionTargetAction` (`lib/actions/resource-directories.ts:498-560`),
  ownership defaults in `lib/overlord/execution-targets.ts`
  (`ensureAssociations`, `upsertExecutionTargetFromProtocol`,
  `upsertSshExecutionTarget`).
- **UI** — `DeviceResourceList.tsx` already shows a "Personal" / "Org-owned"
  badge and a **Claim** / **Make org-owned** button gated by `canManage`.
- **New-target defaults** — self-registered laptops (protocol) and SSH targets
  default to **personal** (owner = registrant), per the goal.

So this ticket is best treated as a **verification + gap-closing** task, not a
greenfield build. The complications below are the gaps between the current
implementation and the goal as literally stated.

## Complications & gaps

### 1. Ownership is per-org, not truly "whole target" (by design)
`owner_user_id` lives on the *org↔target join*, so a target shared across two
orgs can be personal in org A and org-owned in org B. The migration header
defends this ("my laptop is mine in both my orgs; a shared server is org-owned").
But the goal's phrasing — "my laptop is still my laptop **for all projects**" —
implies a single, global ownership flag. **Decision needed:** keep per-org
ownership (current) or add a target-global owner. Per-org is more flexible and
already shipped; recommend keeping it and confirming the wording with the PM
rather than refactoring to a global column.

### 2. Legacy targets defaulted to org-owned, contradicting "default user-owned"
The ownership migration only `ADD COLUMN ... owner_user_id` with **no backfill**,
and the earlier target backfill (`20260523133000`) predates the column. Result:
**every pre-existing target is `owner_user_id = NULL` → org-owned.** New targets
default to personal, but existing users' laptops silently became org-owned after
the migration. To honor "default should be user-owned" we likely need a
**one-time backfill**: for targets with exactly one `user_execution_targets` row
(a clear single user), set `owner_user_id` to that user. Targets with multiple
users should stay org-owned. This needs a deliberate data migration.

### 3. `execution_targets` SELECT policy excludes non-admin project editors
`execution_targets_select_accessible` (`20260523133000...:362`) grants SELECT
only to users in `user_execution_targets` **or org ADMINs**. But management of
org-owned targets is allowed for **ADMIN or MANAGER**. A MANAGER who never
registered on the target can *manage* its directories yet **cannot SELECT the
target row**, so `getProjectDevicesAction` (user-scoped client) renders it as
"Unknown device" with null host/platform. Fix: broaden the select policy to org
members (matching the directories policy in `...100100`), or add MANAGER/the
`can_manage` predicate.

### 4. Flipping personal → org-owned does not grant other editors connectivity
Per-user state (SSH credentials in `execution_target_ssh_credentials`,
`agent_flags` in `user_execution_targets`) is keyed by user, not by target. When
an owner donates a personal target to the org, other editors gain *management
rights* but still have **no `user_execution_targets` row, no credentials, and no
agent flags** for it — so they can't actually run on it. "Org-owned" currently
means "anyone may edit directories," not "anyone may execute." The goal should
clarify whether org-owned implies shared executability, and if so we need to
provision/seed per-user rows (or move launch config to a target-level fallback).

### 5. Orphaned ownership when an owner leaves the org
`owner_user_id` is `ON DELETE SET NULL` (auth user deletion → target becomes
org-owned, fine). But **removing a user from an org** (deleting the `members`
row) does not touch `owner_user_id`. A personal target then stays pinned to a
non-member: no one but that ghost owner can manage it until an admin claims it.
Consider clearing/transferring ownership on org membership removal.

### 6. Dual enforcement (RLS + app code) can drift
The RLS comment states the app code is "the real gate since write paths use the
service-role client." Ownership rules are therefore encoded twice — in
`can_manage_project_resource_directory` (SQL) and in `getProjectDevicesAction`'s
`canManage` / the action guards (TS). They currently agree, but any future change
to the ownership rule must be made in both places or they silently diverge.

### 7. "Admin claim" semantics are correct but asymmetric — confirm intent
`setExecutionTargetOwnershipAction` allows **admin OR current owner**. For an
org-owned target (owner null) `isCurrentOwner` is false, so only an **admin** can
claim it — matching "admins can claim org-owned targets." But note: a regular
member **cannot** claim an org-owned target for themselves, and a non-admin owner
*can* both donate to the org and reclaim. Worth confirming this matches the PM's
mental model (e.g., should any member be able to claim an unowned target?).

### 8. Minor: `project_execution_targets` is now just attach/visibility
With ownership at the org level, the per-project join only controls *which
projects a target is attached to* (insert gated to project ADMIN). An admin can
attach a user's **personal** target to a project, but only the owner can manage
its directories — and the owner may not be a project admin. This split is
workable but is the most likely source of "why can't I edit this?" confusion;
worth a UI affordance explaining who owns/can-manage a given attached target.

## Recommended next steps
1. Confirm with PM: per-org ownership (keep) vs. global ownership (refactor) — #1.
2. Ship a backfill migration to set single-user targets to personal — #2.
3. Broaden the `execution_targets` SELECT policy to org members — #3.
4. Decide whether org-owned implies shared executability; if yes, provision
   per-user credentials/flags or add target-level launch defaults — #4.
5. Clear/transfer ownership on org-membership removal — #5.
