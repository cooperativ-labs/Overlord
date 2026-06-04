# Target-Scoped Resources and Multi-Org Runner

## Goals

The target-scoped resource and execution structure has four concrete goals:

**G1 — The runner finds the project's resource on its target.**  
The primary resource directory is keyed by **(project, execution_target)**. When a runner claims work on a given machine, `claim-execution` resolves "where does this project live here" from the single primary row for that (project, target) pair. No user identity is required to look it up.

**G2 — Primary is target-scoped, not user-scoped.**  
On a shared target there is exactly one primary per (project, execution_target). Who may change it depends on target ownership (see below), but the path itself is shared project topology — two teammates on the same project and target always use the same checkout directory.

**G3 — One runner serves all of a user's orgs on a target.**  
`ovld runner` is org-agnostic. `claim-execution` computes the intersection of (orgs the user is a member of) ∩ (orgs that share the claiming target) and polls queued work across all of them. The organization the API token was issued against is no longer used to scope the queue; the server is authoritative.

**G4 — No primary → hard error at request time.**  
If an execution is requested for a project/target pair that has no primary resource directory, `createExecutionRequest` throws immediately — naming the project and target — rather than queuing work that will silently fail at claim time. `claim-execution` also records a `ticket_event` backstop if a missing primary slips through to claim time.

---

## Data Model

```
execution_targets                   — canonical identity (fingerprint or SSH placeholder · host · port · transport)
  ↑
organization_execution_targets      — org-scoped label + owner_user_id (personal vs. org-owned)
user_execution_targets              — per-user access record
execution_target_ssh_credentials    — per-user SSH key path / auth method (metadata only)
project_execution_targets           — target enabled for this project
project_resource_directories        — directory_path · label · is_primary · execution_target_id
```

The unique constraint `(project_id, execution_target_id) WHERE is_primary` enforces at most one primary per (project, target). The `user_id` column on `project_resource_directories` is **audit-only** (`added_by`); it is no longer used to scope reads or writes.

---

## Target Ownership Model

A nullable `owner_user_id` on the `organization_execution_targets` join table distinguishes two modes:

| `owner_user_id` set | Personal target | Only the owner may add/remove directories or change the primary for any project on it (in that org). |
|---|---|---|
| `owner_user_id` null | Organization-owned target | Any user with project edit permission (ADMIN or MANAGER) may manage directories and set the primary. |

This lives on the org↔target join, not on `execution_targets` itself, so the same physical machine can be personal in one org and org-owned in another.

### Write authority predicate

```
can_manage_resource(user, project, target):
  oet = organization_execution_targets[project.org, target]
  if oet.owner_user_id is not null: return user == oet.owner_user_id
  else:                             return has_org_role(org, ['ADMIN','MANAGER'])
```

This predicate is enforced in two places:
- **Application code** (`assertCanManagePrimary` in `lib/resource-directories/primary-resource.ts`) — all three write surfaces (server action, REST protocol routes, edge MCP handlers) call this before any mutation.
- **RLS** — the `can_manage_project_resource_directory()` SQL helper mirrors the same logic as defense-in-depth.

### Setting ownership

- Self-registered targets (local `ovld runner` startup, `ovld protocol get-device`) default to `owner_user_id = userId` (personal).
- SSH targets added from the web app can be flagged as organization-owned at creation time; the form exposes an "Organization-owned" toggle.
- `setExecutionTargetOwnershipAction` (org ADMIN or current owner only) transfers or donates ownership after the fact.
- `ensureAssociations` sets `owner_user_id` on first insert only; subsequent upserts never overwrite an existing owner.

---

## Primary Resource Helpers

`lib/resource-directories/primary-resource.ts` is the single canonical module for all primary-related logic:

| Export | Purpose |
|---|---|
| `getPrimaryProjectResourceDirectoriesByProjectId` | Resolve the primary per (project, target) for a list of projects. No user filter. |
| `targetHasPrimaryResourceDirectory` | True if a primary already exists for (project, target). Used for auto-promotion. |
| `shouldAutoPrimary` | Returns true if no primary exists for (project, target), so the first directory auto-promotes and a "rows exist but none primary" state self-heals. |
| `resolveTargetOwnership` | Returns `owner_user_id` from `organization_execution_targets` for the given (org, target). |
| `canManagePrimary` | Non-throwing check of the write authority predicate. |
| `assertCanManagePrimary` | Throwing version — used on all write paths before any mutation. |
| `clearTargetPrimary` | Clears all `is_primary` flags for (project, target). Called before setting a new primary to avoid unique-constraint violations. |

All three write surfaces (server action in `lib/actions/resource-directories.ts`, REST routes in `apps/web/app/api/protocol/{add,update}-project-resource/route.ts`, edge MCP handlers in `supabase/functions/mcp/handlers/`) share these helpers so behavior cannot drift.

---

## How the Runner Works

### Device identity

`ovld runner` generates a UUID stored in `~/.ovld/device.json` on first run. Every protocol call sends this fingerprint as `deviceFingerprint`. `upsertDeviceFromProtocol` maps it to a canonical `execution_targets` row (creating one on first contact or reconciling a placeholder).

### Org-agnostic claim (G3)

```
POST /api/protocol/claim-execution
  deviceFingerprint → executionTargetId
  userId → memberOrgIds  (all orgs the user belongs to)
  executionTargetId → targetOrgIds (orgs that share this target)
  allowedOrgIds = memberOrgIds ∩ targetOrgIds
  query: execution_requests WHERE organization_id IN allowedOrgIds AND requested_by = userId
```

The runner token identifies a user, not an org. The server computes `allowedOrgIds` from the intersection above and polls all qualifying rows. The CLI does not send `x-organization-id` for claim polls; the server is authoritative.

### Working directory resolution

For each candidate row:

1. **Explicit `workingDirectory` in `launch_params`** — used as-is (SSH command flows).
2. **`target_resource_id` set** — looks up the directory from `project_resource_directories` and verifies `execution_target_id === executionTargetId`.
3. **Fallback: (project, target) primary** — selects the `is_primary = true` row for `(project_id, execution_target_id)`. No `user_id` filter.
4. **No primary found** — records a `ticket_event` ("No primary directory for <project> on this target") and skips the request (fail-closed backstop for G4).

### Claim lifecycle

| Status | Meaning |
|---|---|
| `queued` | Waiting for a runner that matches the target. |
| `claimed` | Leased by a device fingerprint; runner is building the launch command. |
| `launching` | Runner spawned `ovld launch`, but no agent has attached yet. Stale `launching` rows are reclaimable once the lease expires. |
| `launched` | Agent attached and created its session; `launched_session_id` recorded. |
| `failed` | Spawn error recorded in `last_error`. |

A stale `claimed` or `launching` row (lease expired) is reclaimable by any runner that can see the target — ensuring work is not permanently stuck if a runner crashes mid-flight.

### Launch sequence

1. `ovld runner start` polls `POST /api/protocol/claim-execution` every 3 s (default).
2. On a successful claim, the runner builds `ovld launch <agent> --session-key …` arguments from the claim payload and spawns it as a child process (`stdio: inherit`).
3. On `spawn`, the runner calls `complete-execution-launch`; the row moves to `launching`.
4. The new agent process calls `ovld protocol attach`. Attach is the authoritative source of truth for a successful launch; the `launched_session_id` is written and the row becomes `launched`.

---

## Request-Time Error (G4)

`createExecutionRequest` in `lib/overlord/execution-requests.ts` checks for a primary before inserting a queue row:

- **Specific target requested** — asserts a primary exists for (project, target); throws `'No primary directory is set for "<project>" on "<target>". Set a primary directory before running.'` if not.
- **Any target (`targetKind = 'any'`)** — asserts the project has at least one primary on a target the requester can reach (member-org ∩ project targets); throws similarly if not.
- **Skipped** when an explicit `workingDirectory`, SSH command, or `targetResourceId` is supplied in the request params (those callers have already resolved the path).

The error surfaces in the web/desktop "Run" UI, which already renders action errors.

---

## Write Path Summary

Every directory mutation follows the same sequence regardless of surface:

```
1. assertCanManagePrimary(supabase, { userId, projectId, executionTargetId })
2. If setting primary: clearTargetPrimary(supabase, projectId, executionTargetId)
3. Insert/update/delete project_resource_directories
4. If auto-promoting (first directory): shouldAutoPrimary → set is_primary = true
5. If removing primary: promote oldest remaining row for (project, target)
```

The edge MCP handlers share a Deno module `_resource-authority.ts` that mirrors `primary-resource.ts` for the Supabase edge runtime.

---

## Related

- `lib/resource-directories/primary-resource.ts` — canonical helper module
- `lib/actions/resource-directories.ts` — server action write path
- `apps/web/app/api/protocol/add-project-resource/route.ts` — REST write path
- `apps/web/app/api/protocol/create-project/route.ts` — create a project, optionally registering a primary resource directory in one step
- `lib/overlord/project-provisioning.ts` — shared project + primary-resource provisioning helpers
- `apps/web/app/api/protocol/claim-execution/route.ts` — org-agnostic claim
- `lib/overlord/execution-requests.ts` — G4 request-time check
- `supabase/functions/mcp/handlers/_resource-authority.ts` — edge MCP authority mirror
- `supabase/migrations/20260601100000_execution_target_ownership.sql` — `owner_user_id` column
- `supabase/migrations/20260601100100_resource_directory_ownership_rls.sql` — RLS helper + policies
