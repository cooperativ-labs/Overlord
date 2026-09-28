# `project_automation` token — read-surface inventory (Phase 0)

- Mission: coo:1093, Phase 0 (authorization audit)
- Date: 2026-09-28
- Contract: v151 (allowlist to be published per plan §9.1)
- Parent plan: `planning/feature-plans/project-scoped-tokens-and-token-auto-tags.md` §4, §9
- Method: every route in the extracted route list, every `SUBCOMMAND_PERMISSIONS` entry (including `runQueueSubcommandPermissions`), every hosted MCP tool, and the realtime/extension surfaces were traced from the Express handler into the service/repository function that performs the authorization check. Line numbers are as of the working tree on 2026-09-28.

## Preset grants and evaluation semantics

Grants (maximum; the owner's roles can only narrow them):

```text
project:read  mission:read  mission:create  objective:read  event:read
session:read  artifact:read  attachment:read  execution_request:read
```

How a check is evaluated today:

- `handle(fn, { requires })` (`backend/index.ts:533-556`) calls `requireAnyWorkspacePermission(requires)` (`backend/rbac.ts:157-198`): the request passes if **any** workspace in the immutable authorization snapshot grants the permission. It never narrows the read.
- `actorCan` (`backend/rbac.ts:62-91`) = role grants ∩ `tokenScopeAllows(tokenScopes, action)`. The preset carries no wildcard, so only the nine exact strings above pass; `workspace:read`, `launch:read`, `profile:self:*`, `user_token:self:*`, `webhook:*`, and every `*:update|create|delete|attach|claim|configure` fail.
- `requireWorkspacePermission` (`rbac.ts:115-146`) is **workspace-level**: it 404s a workspace outside the snapshot and 403s a missing permission, but never looks at a project.
- `requireProjectPermission` (`rbac.ts:216-236`) resolves `projects.workspace_id` then defers to `requireWorkspacePermission`; `requireMissionPermission` (`rbac.ts:240-279`) resolves by UUID **globally** (`rbac.ts:249-252`, no workspace predicate) or by display id inside the snapshot (`rbac.ts:259-265`) and then does the workspace check. Neither consults a project allowlist today; both are the natural single choke point for the §4.2 project predicate.
- Checks that bypass token scopes entirely: `actorIsAdmin` (`rbac.ts:41-52`), `isOrganizationAdmin` / `canViewOrganizationSettings` (`rbac.ts:327-357`), `requireWorkspaceMember/Admin/Manager` (`backend/workspaces.ts:165-199`), and the core `requirePermission` in `packages/core/service/storage.ts:106-118` (role grants only). Routes gated only by these pass for the preset whenever the token owner holds the role.
- Routes with **no** permission check pass for any authenticated token (listed in Findings F1).

Token consent (§9.2) already limits the snapshot to `user_token_workspaces` rows (`backend/auth.ts:176-186`), so every "workspace-level only" check below separates workspaces correctly and the missing piece is always the **project** predicate inside consented workspaces. Live-membership helpers that ignore the snapshot are called out explicitly because they also bypass consent.

## Classification legend

| Code | Meaning |
| --- | --- |
| `project-bound` | Reads/writes exactly one project or one mission/objective that belongs to one project. The notes say where the project id is resolved and that the current check is workspace-level, so the project predicate must be added there. |
| `projectless-denied` | Account/workspace/organization/token/webhook/inbox-capture/launch/session/agent surfaces the preset must not reach, regardless of whether the grant passes. |
| `safe-non-project-metadata` | Reads no project data (or only consent-filtered workspace identity). |
| `aggregate-project-filtered` | Account-wide list/search/sync that must filter by the project allowlist before pagination, totals and quotas. |

Column "Passes preset grants?" is evaluated against the grant list above, assuming the token owner holds every role grant (worst case). "On allowlist?" is the Phase 1 proposal; `excluded` means the guard 404s the route even where the grant would pass.

## 1. REST routes

### 1.0 Outside the `/api` guard (not part of the allowlist)

`backend/index.ts:386-595` (`/api/auth/desktop/*`, `/api/auth/browser/*`, `/api/auth/callback/github/repository`, `/api/auth-providers`, `/api/health`, `/.well-known/*`, `/oauth/*`, `GET /mcp`), `GET *` (`index.ts:2351`, SPA fallback) and the channel router `backend/agent-session-routes.ts:201-523` (mounted at `/api/agent-session-channels/v1` **before** `app.use('/api', requireAuthenticatedSession)` at `index.ts:619`, authenticated only by `osc_` channel credentials) are outside the human `/api` guard and are not reachable with a USER_TOKEN as a human credential. `POST /mcp` (`index.ts:595`) is authenticated inline by `requireAuthenticatedSession` and is covered in §3.

### 1.1 Meta, discovery, onboarding, organizations

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/meta` | none. `buildMeta` (`backend/http/meta.ts:19-32`) → `listOrganizationsForUser` (`organizations.ts:121-138`, live memberships) → `listWorkspacesForOrganization` (`workspaces.ts:275-290`, **live memberships, not the consent snapshot**) → `getDefaultProjectPreference` (`repository.ts:8246-8268`). | yes (no check) | safe-non-project-metadata (with caveat) | excluded | Returns every workspace of the org the owner belongs to, not just consented ones, and `defaultProjectId` can name a project outside the allowlist. Not needed by the automation (`auth-status`/`/api/authorized-workspaces` cover identity). If ever allowed, filter `workspaces` by snapshot and null `defaultProjectId` unless allowlisted. |
| `GET /api/authorized-workspaces` | none; `getAuthorizedWorkspaceDiscovery` (`backend/workspace-discovery.ts:33-59`) projects the snapshot only. | yes | safe-non-project-metadata | yes | Consent-filtered by construction (`auth.ts:176-186`). Returns roleKeys of the owner; acceptable. |
| `GET /api/diagnostics/execution-target-migration` | `requireWorkspacePermission(WORKSPACE_READ)` (`backend/execution/execution-target-migration.ts:10-12`) | no | projectless-denied | excluded | Workspace diagnostics. |
| `POST /api/onboarding` | none (`index.ts:689-700`); `createOrganizationOnboarding` refuses profiles with a membership. | yes (no check) | projectless-denied | excluded | Creates org/workspace. Must 404 for preset. |
| `GET /api/organizations` | none; `listOrganizationsForUser` (`organizations.ts:121`) | yes | projectless-denied | excluded | Org names/settings for every org the owner is in (bypasses consent). |
| `PATCH /api/organizations/:id` | `requireOrganizationAdmin` → `isOrganizationAdmin` (`organizations.ts:169`, `rbac.ts:327-338`) — role based, **ignores token scopes** | yes if owner is org admin | projectless-denied | excluded | F2. |
| `GET /api/organizations/:id/admins` | `requireOrganizationAdmin` (`organizations.ts:367`) | yes if owner is org admin | projectless-denied | excluded | F2. |
| `POST /api/organizations/:id/admins` | `requireOrganizationAdmin` (`organizations.ts:379+`) | yes if org admin | projectless-denied | excluded | F2. |
| `DELETE /api/organizations/:id/admins/:userId` | `requireOrganizationAdmin` (`organizations.ts:467+`) | yes if org admin | projectless-denied | excluded | F2. |

### 1.2 Workspaces, members, invitations, workspace settings

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/workspaces` | none; `listWorkspaces` (`workspaces.ts:255-268`, live memberships) | yes | projectless-denied | excluded | Leaks non-consented workspaces. |
| `POST /api/workspaces` | `requireAnyWorkspacePermission(WORKSPACE_CREATE)` only when `getActorWorkspaceUserId()` is set (`index.ts:756-757`; token auth sets it to `null`, `auth.ts:361-365`), then `canViewOrganizationSettings` (`workspaces.ts:355`, role based) | **yes if owner is admin of any org workspace** (scope check skipped) | projectless-denied | excluded | F2/F3: the route-level check is skipped for token auth. |
| `PATCH /api/workspaces/:id` | `requireWorkspaceManager` (`workspaces.ts:605`, `165-199`; role based, no token scope, live membership) | yes if manager/admin | projectless-denied | excluded | F2. |
| `DELETE /api/workspaces/:id` | `requireWorkspaceAdmin` (`workspaces.ts:685`) | yes if admin | projectless-denied | excluded | F2. |
| `GET /api/workspaces/:id/members` | `requireWorkspaceMember` (`workspaces.ts:761`, `165-171`: live membership only, **no snapshot, no permission**) | yes | projectless-denied | excluded | Bypasses consent entirely. |
| `DELETE /api/workspaces/:id/members/:workspaceUserId` | `requireWorkspaceManager` (`workspaces.ts:1397`) | yes if manager | projectless-denied | excluded | F2. |
| `PATCH /api/workspaces/:id/members/:workspaceUserId/role` | `requireWorkspaceManager` (`workspaces.ts:1324`) | yes if manager | projectless-denied | excluded | F2. |
| `GET /api/workspaces/:id/invitations` | `requireWorkspaceManager` (`workspaces.ts:1061`) | yes if manager | projectless-denied | excluded | F2. |
| `POST /api/workspaces/:id/invitations` | `requireWorkspaceManager` (`workspaces.ts:937+`) | yes if manager | projectless-denied | excluded | F2. |
| `DELETE /api/workspaces/:id/invitations/:invitationId` | `requireWorkspaceManager` (`workspaces.ts:1072+`) | yes if manager | projectless-denied | excluded | F2. |
| `POST /api/invitations/accept` | **none** (`index.ts:838-848`; the extracted `WORKSPACE_READ` belongs to the next route). Invitation token is the credential. | yes (no check) | projectless-denied | excluded | Grants the owner a new membership. |
| `GET /api/workspaces/:id/objectives.csv` | `requires: WORKSPACE_READ` (`index.ts:855`) + `requireWorkspaceAdmin` (`workspaces.ts:829`) | no | aggregate-project-filtered (workspace-wide export) | excluded | Would need `p.id IN (allowlist)` in the export SQL (`workspaces.ts:839+`); not needed. |
| `GET /api/workspaces/:id/projects` | `requireWorkspacePermission(PROJECT_READ)` (`repository.ts:2004-2009`) | yes | aggregate-project-filtered | excluded (use `GET /api/projects`) | Filter `selectProjectsSql` at `repository.ts:2011-2014` with `AND p.id IN (…)` if ever allowed. |
| `GET /api/workspaces/:id/project-statuses` | `requireWorkspacePermission(WORKSPACE_READ)` (`repository.ts:2167-2172`) | no | aggregate-project-filtered | excluded | Per-project statuses are available via `GET /api/projects/:id/statuses`; if ever allowed, add `AND ps.project_id IN (…)` at `repository.ts:2174-2181` and a project-bound grant path. |
| `GET /api/workspaces/:id/execution-targets` | `requireWorkspacePermission(WORKSPACE_READ)` (`project-execution-target.ts:78-80`) | no | projectless-denied | excluded | Launch/target settings. |
| `POST /api/workspaces/:id/execution-targets` | `requireWorkspacePermission(EXECUTION_REQUEST_CLAIM)` (`project-execution-target.ts:102-104`) | no | projectless-denied | excluded | |
| `PATCH /api/workspaces/:id/execution-targets/:targetId` | `WORKSPACE_UPDATE` (`project-execution-target.ts:157-159`) | no | projectless-denied | excluded | |
| `DELETE /api/workspaces/:id/execution-targets/:targetId` | `WORKSPACE_UPDATE` (`project-execution-target.ts:129-131`) | no | projectless-denied | excluded | |
| `GET /api/workspaces/:id/agent-catalog` | no `requires` (extraction picked up `/api/profile`'s); `getAgentCatalog` → `resolveCatalogWorkspaceId` → `requireWorkspacePermission(LAUNCH_READ)` (`launch.ts:197-213, 305-311`) | no | projectless-denied | excluded | Launch surface. |
| `PUT /api/workspaces/:id/agent-catalog` | `LAUNCH_CONFIGURE` (`launch.ts:429-437`) | no | projectless-denied | excluded | |
| `POST /api/workspaces/:id/agent-catalog/refresh` | `LAUNCH_CONFIGURE` (`launch.ts:326-331`) | no | projectless-denied | excluded | |

### 1.3 Profile, user tokens, webhooks, mobile, notifications

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/profile` | `requires: PROFILE_SELF_READ` (`index.ts:925`) | no | projectless-denied | excluded | |
| `PATCH /api/profile` | `PROFILE_SELF_UPDATE` (`index.ts:931`) | no | projectless-denied | excluded | |
| `GET /api/profile/default-project` | `PROFILE_SELF_READ` (`index.ts:936`) | no | projectless-denied | excluded | Would reveal a project outside the allowlist. |
| `PUT /api/profile/default-project` | `PROFILE_SELF_UPDATE` (`index.ts:940`) + `requireProjectPermission(PROJECT_READ)` (`repository.ts:8279-8283`) | no | projectless-denied | excluded | |
| `DELETE /api/profile/default-project` | `PROFILE_SELF_UPDATE` (`index.ts:948`) | no | projectless-denied | excluded | |
| `GET /api/user-tokens` | `USER_TOKEN_SELF_LIST` (`index.ts:962`) | no | projectless-denied | excluded | |
| `POST /api/user-tokens` | `USER_TOKEN_SELF_CREATE` (`index.ts:968`) | no | projectless-denied | excluded | Token must not mint tokens. |
| `PATCH /api/user-tokens/:id` | `USER_TOKEN_SELF_ROTATE` (`index.ts:975`) | no | projectless-denied | excluded | |
| `POST /api/user-tokens/:id/revoke` | `USER_TOKEN_SELF_REVOKE` (`index.ts:982`) | no | projectless-denied | excluded | |
| `DELETE /api/user-tokens/:id` | `USER_TOKEN_SELF_REVOKE` (`index.ts:995`) | no | projectless-denied | excluded | |
| `GET /api/webhooks` | `requireWorkspacePermission(WEBHOOK_READ)` (`webhooks.ts:188-193`) | no | projectless-denied | excluded | §9.4. |
| `POST /api/webhooks` | `WEBHOOK_CREATE` (`webhooks.ts:153-155`) | no | projectless-denied | excluded | |
| `PATCH /api/webhooks/:id` | `loadSubscriptionForUpdate(WEBHOOK_UPDATE)` (`webhooks.ts:277`, `162-179`) | no | projectless-denied | excluded | |
| `DELETE /api/webhooks/:id` | `WEBHOOK_DELETE` (`webhooks.ts:355`) | no | projectless-denied | excluded | |
| `POST /api/webhooks/:id/rotate-secret` | `WEBHOOK_UPDATE` (`webhooks.ts:376`) | no | projectless-denied | excluded | |
| `POST /api/webhooks/:id/test` | `WEBHOOK_UPDATE` (`webhooks.ts:414`) | no | projectless-denied | excluded | |
| `GET /api/webhooks/:id/deliveries` | `WEBHOOK_READ` (`webhooks.ts:503`) | no | projectless-denied | excluded | |
| `POST /api/webhooks/:id/deliveries/:outboxId/redeliver` | `WEBHOOK_UPDATE` (`webhooks.ts:553`) | no | projectless-denied | excluded | |
| `PUT /api/mobile/live-activities/:activityId/push-token` | none (profile-owned rows, `live-activities.ts:247+`) | yes (no check) | projectless-denied | excluded | Account credential surface. |
| `DELETE /api/mobile/live-activities/:activityId/push-token` | none (`live-activities.ts:398+`) | yes | projectless-denied | excluded | |
| `PUT /api/mobile/live-activities/start-token` | none (`live-activities.ts:327+`) | yes | projectless-denied | excluded | |
| `POST /api/mobile/live-activities/start-token/revoke` | none (`live-activities.ts:387+`) | yes | projectless-denied | excluded | |
| `PUT /api/mobile/push/device-token` | none (`push-notifications.ts:83+`) | yes | projectless-denied | excluded | |
| `POST /api/mobile/push/device-token/revoke` | none (`push-notifications.ts:130+`) | yes | projectless-denied | excluded | |
| `GET /api/profile/notification-preferences` | none beyond profile (`push-notifications.ts:203-208`) | yes | projectless-denied | excluded | |
| `PUT /api/profile/notification-preferences` | none beyond profile (`push-notifications.ts:218+`) | yes | projectless-denied | excluded | |
| `GET /api/notifications` | none beyond profile; SQL joins `missions` for every notification of the profile (`notifications.ts:100-113`) | yes | projectless-denied | excluded | Would reveal mission titles/display ids from every project the owner is notified about. |
| `PATCH /api/notifications/:id/read` | profile ownership (`notifications.ts:117+`) | yes | projectless-denied | excluded | |
| `DELETE /api/notifications/:id` | profile ownership (`notifications.ts:148+`) | yes | projectless-denied | excluded | |

### 1.4 Uploads, storage, realtime

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/uploads/:bucketKey` | per bucket: `USER_IMAGE_SELF_CREATE` / `WORKSPACE_IMAGE_CREATE` / `ORGANIZATION_IMAGE_CREATE` via `requireWorkspacePermission` or `requireAnyWorkspacePermission` (`index.ts:1069-1082, 1105-1117`) | no | projectless-denied | excluded | |
| `GET /api/storage/:bucketKey/:storageKey` | `STORAGE_READ_PERMISSIONS[bucket]` (`index.ts:1084-1089`): `attachments`→`ATTACHMENT_READ` passes; `user-images`/`workspace-images`/`organization-images` fail. `resolveStoredObject` (`storage.ts:786-859`) looks the row up by `storage_key` **across all workspaces** (`storage.ts:813-818`) then `requireWorkspacePermission(row.workspace_id)` (`storage.ts:843-847`) — workspace-level only. | yes for `attachments` only | project-bound | yes, pattern narrowed to `GET /api/storage/attachments/:storageKey` | Project id: `attachments.project_id` is not selected at `storage.ts:813-818`; add `project_id` to the projection and apply the allowlist predicate before/at `storage.ts:843` (404 on mismatch). This is the §4.2 "known storage key reaches a workspace-level check" risk (R1). |
| `GET /api/stream` | `readableChangeFeedWorkspaceIds` → `actorCan(PROJECT_READ)` per snapshot workspace (`realtime.ts:74-87`, `index.ts:1204-1210`) | yes | aggregate-project-filtered | yes | Live broadcast filters by `client.workspaceIds` only (`realtime.ts:246-255`); `RealtimeClient` (`realtime.ts:124-127`) must also carry the project allowlist and `broadcastChanges` must apply `row.project_id IN allowlist OR (row.project_id IS NULL AND entity_type IN AUDITED_NON_PROJECT_TYPES)`. Catch-up (`sendCatchUp`, `realtime.ts:264-278`) goes through `readChangesAfter` (below). See §4. |
| `GET /realtime` | same as `/api/stream` (`index.ts:1232`) | yes | aggregate-project-filtered | yes | Same fix. |
| `GET /sync/changes` | same gate (`index.ts:1233-1252`); `readChangesAfter` filters `workspace_id IN (…)` only (`realtime.ts:107-115`) | yes | aggregate-project-filtered | yes | Add the project predicate to the SQL at `realtime.ts:111` before `LIMIT`, so `hasMore`/`cursor` are computed over visible rows only. |

### 1.5 Projects, statuses, run queues, tags, resources, repository

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/projects` | `callerAuthorizedWorkspaceScopes(PROJECT_READ)` → `actorCan` per snapshot workspace (`repository.ts:1951-1972`) | yes | aggregate-project-filtered | yes | Filter in the per-workspace SQL at `repository.ts:1975-1980` (`AND p.id IN (…)`) before the merge/sort. |
| `POST /api/projects` | `requireWorkspacePermission(PROJECT_CREATE)` (`repository.ts:3252-3254`) | no | projectless-denied | excluded | |
| `POST /api/projects/initialize` | `requireWorkspacePermission(PROJECT_CREATE)` (`repository.ts:3406-3410`) | no | projectless-denied | excluded | |
| `PATCH /api/projects/reorder` | `requireWorkspacePermission(PROJECT_UPDATE)` (`repository.ts:2058-2062`) | no | aggregate (write) | excluded | |
| `GET /api/projects/:id` | `requireProjectPermission(PROJECT_READ)` (`repository.ts:2023-2027`) | yes | project-bound | yes | Project id = `:id`; predicate belongs inside `requireProjectPermission` (`rbac.ts:225-235`) so every caller inherits it. |
| `PATCH /api/projects/:id` | `requireProjectPermission(PROJECT_UPDATE)` (`repository.ts:3538`) | no | project-bound (write) | excluded | |
| `DELETE /api/projects/:id` | `requireProjectPermission(PROJECT_DELETE)` (`repository.ts:3651`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/run-queues` | `authorize(projectId, OBJECTIVE_READ)` → `requireProjectPermission` (`backend/run-queue.ts:42-47`) | **yes** | project-bound | excluded (run queue) | F4: grant passes; guard must 404. |
| `POST /api/projects/:id/run-queues` | `PROJECT_UPDATE` (`run-queue.ts:55`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/run-queues/order` | `PROJECT_UPDATE` (`run-queue.ts:69`) | no | project-bound (write) | excluded | |
| `POST /api/projects/:id/run-queues/entries` | `EXECUTION_REQUEST_CREATE` (`run-queue.ts:89`) | no | project-bound (write) | excluded | |
| `PATCH /api/run-queues/:queueId` | `PROJECT_UPDATE` (`run-queue.ts:75`) | no | project-bound (write) | excluded | |
| `DELETE /api/run-queues/:queueId` | `PROJECT_UPDATE` (`run-queue.ts:81`) | no | project-bound (write) | excluded | |
| `PATCH /api/run-queues/:queueId/order` | `EXECUTION_REQUEST_CREATE` (`run-queue.ts:156`) | no | project-bound (write) | excluded | |
| `PATCH /api/run-queues/entries/:entryId` | `EXECUTION_REQUEST_CREATE` (`run-queue.ts:106`) | no | project-bound (write) | excluded | |
| `DELETE /api/run-queues/entries/:entryId` | `EXECUTION_REQUEST_CREATE` (`run-queue.ts:127`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/statuses` | `requireProjectPermission(PROJECT_READ)` (`repository.ts:2159`) | yes | project-bound | yes | Predicate via `requireProjectPermission`. `selectProjectStatuses` (`repository.ts:2141-2153`) filters by `project_id` only, which is correct once the project is authorized. |
| `POST /api/projects/:id/statuses` | `resolveStatusProjectScope` → `PROJECT_UPDATE` (`repository.ts:2185-2193`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/statuses/reorder` | `PROJECT_UPDATE` (`repository.ts:2379+` via `resolveStatusProjectScope`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/statuses/:statusId` | `PROJECT_UPDATE` (`repository.ts:2270+`) | no | project-bound (write) | excluded | |
| `DELETE /api/projects/:id/statuses/:statusId` | `PROJECT_UPDATE` (`repository.ts:2335+`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/tags` | `getProject(PROJECT_READ)` (`repository.ts:2448` → `2023`) | yes | project-bound | excluded (not needed; safe to add later) | Predicate via `requireProjectPermission`. |
| `POST /api/projects/:id/tags` | `getProject(…, PROJECT_UPDATE)` (`repository.ts:2471`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/tags/:tagId` | `getProjectTagRow(…, PROJECT_UPDATE)` (`repository.ts:2522`) | no | project-bound (write) | excluded | |
| `DELETE /api/projects/:id/tags/:tagId` | `PROJECT_UPDATE` (`repository.ts:2575`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/resources` | `getProject(PROJECT_READ)` + `requireWorkspacePermission(PROJECT_READ)` (`repository.ts:2600-2608`) | yes | project-bound | excluded (local checkout paths; not needed) | Predicate via `requireProjectPermission`. |
| `POST /api/projects/:id/resources` | `PROJECT_UPDATE` (`repository.ts:2814`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/resources/:resourceId` | `PROJECT_UPDATE` (`repository.ts:2844`) | no | project-bound (write) | excluded | |
| `DELETE /api/projects/:id/resources/:resourceId` | `PROJECT_UPDATE` (`repository.ts:2939`) | no | project-bound (write) | excluded | |
| `DELETE /api/projects/:id/resources/:resourceId/sources/:sourceId` | `PROJECT_UPDATE` (`repository.ts:2985`) | no | project-bound (write) | excluded | |
| `PATCH /api/projects/:id/resources/:resourceId/sources/:sourceId` | `PROJECT_UPDATE` (`repository.ts:3035`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/repository` | `getProject(PROJECT_READ)` (`repository.ts:3150`), then a local checkout scan | yes | project-bound | excluded (local filesystem surface) | Predicate via `requireProjectPermission`. |
| `POST /api/local-target/invoke` | `requires: PROJECT_READ` (`index.ts:1620`); `invokeLocalTargetOnServer` (`local-target-invoke.ts:43-60`) has no resource check | **yes** | projectless-denied (dev-only in-process local target bridge) | excluded | F4. |
| `GET /api/projects/:id/missions` | `requireProjectPermission(MISSION_READ)` and, with `?includeObjectives`, `OBJECTIVE_READ` (`repository.ts:3884-3890`) | yes | project-bound | yes | Predicate via `requireProjectPermission`; `selectMissionsSql` filters by workspace + `t.project_id = ?` (`repository.ts:3795, 3897`). |
| `PATCH /api/projects/:id/board/reorder` | `requireProjectPermission(MISSION_UPDATE)` (`repository.ts:6133-6135`) | no | project-bound (write) | excluded | |
| `GET /api/projects/:id/launch-preference` | `requireProjectPermission(LAUNCH_READ)` (`launch.ts:739-742`) | no | projectless-denied (launch) | excluded | |
| `PUT /api/projects/:id/launch-preference` | `LAUNCH_CONFIGURE` (`launch.ts:760-762`) | no | projectless-denied | excluded | |
| `GET /api/projects/:id/execution-target` | `projectServiceContext(LAUNCH_READ)` (`project-execution-target.ts:34, 63`) | no | projectless-denied | excluded | |
| `PUT /api/projects/:id/execution-target` | `LAUNCH_CONFIGURE` (`project-execution-target.ts:194`) | no | projectless-denied | excluded | |

### 1.6 Organization aggregates: My Missions, activity feed, inbox missions, deferred work

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/workspace/my-missions` | **no `requires`** (`index.ts:1353-1364`; the extracted `MISSION_UPDATE` belongs to the PATCH below). `listWorkspaceMyMissions` → `actorCan(MISSION_READ)` per snapshot membership (`repository.ts:6804-6818`). | yes | aggregate-project-filtered | excluded | Answer (c): it does **not** require `MISSION_UPDATE`. If ever allowed, add `AND t.project_id IN (…)` inside `selectMyMissionsSql` (`repository.ts:6744+`) before ordering/limit. Semantics ("assigned to the token owner") are not useful to an automation. |
| `PATCH /api/workspace/my-missions/order` | `requires: MISSION_UPDATE` (`index.ts:1369`) | no | aggregate (write) | excluded | |
| `GET /api/activity-feed` | `readableWorkspaceIds` → `requireWorkspacePermission(MISSION_READ)` per membership (`activity-feed.ts:190-208`) | yes | aggregate-project-filtered | excluded | `loadRuns`/`loadQuestions`/`loadDeliveredPage` select by `workspace_id IN (…)` via `CONTEXT_JOIN` (`activity-feed.ts:211-215, 673-720`); a predicate on `o.project_id`/`m.project_id` would be needed before the `MISSION_LIMIT` slice and the `counts`. Not needed by the automation. |
| `PUT /api/deliveries/:deliveryId/deferred-work/:actionId/resolution` | `requireWorkspacePermission(MISSION_UPDATE)` (`deferred-work-resolutions.ts:71-73`) | no | project-bound (write) | excluded | |
| `DELETE /api/deliveries/:deliveryId/deferred-work/:actionId/resolution` | same (`deferred-work-resolutions.ts:71-73`) | no | project-bound (write) | excluded | |
| `GET /api/inbox/missions` | `actorCan(MISSION_READ)` per snapshot membership (`repository.ts:6937-6950`) | yes | aggregate-project-filtered | excluded | `selectInboxMissionsSql` filters by `workspace_id IN` only (`repository.ts:6873+`, `6966-6975`); predicate `t.project_id IN (…)` needed on each slice before its `LIMIT`. |

### 1.7 Inbox capture (projectless items)

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/inbox` | profile ownership only (`repository.ts:5474-5483`) | yes (no RBAC) | projectless-denied | excluded | Inbox capture is explicitly denied (§4.2). |
| `POST /api/inbox` | profile only (`repository.ts:5490+`) | yes | projectless-denied | excluded | |
| `GET /api/inbox/:id` | profile ownership (`repository.ts:5485-5488`) | yes | projectless-denied | excluded | |
| `PATCH /api/inbox/:id` | profile ownership (`repository.ts:5512+`) | yes | projectless-denied | excluded | |
| `DELETE /api/inbox/:id` | profile ownership (`repository.ts:5550+`) | yes | projectless-denied | excluded | |
| `POST /api/inbox/:id/promote` | profile ownership + `createMissionTx` → `requireProjectPermission(MISSION_CREATE)` (`repository.ts:5557-5570, 5212-5216`) | **yes** | projectless-denied (inbox) | excluded | F4. |

### 1.8 Mission search

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/missions/search` (v1) | with `projectId`: `requireProjectPermission(MISSION_READ)` (`repository.ts:3996-4000`); without: `callerAuthorizedWorkspaceScopes(MISSION_READ)` fan-out (`repository.ts:4020-4045`) | yes | aggregate-project-filtered | excluded (v3 is the supported search) | `searchMissionsInWorkspace` passes `projectIds` to `searchWorkspaceMissions` (`repository.ts:3960-3972`); the allowlist must be intersected with the requested `projectIds` (or injected when absent) before `allocateWorkspaceSearchLimits` so quotas/limits are computed over visible projects. |
| `GET /api/missions/search/v2` | single project: `requireProjectPermission(MISSION_READ)` (`repository.ts:4091-4095`); otherwise `callerAuthorizedWorkspaceScopes(MISSION_READ)` (`repository.ts:4110+`) | yes | aggregate-project-filtered | excluded | Same fix. |
| `GET /api/search/v3` | single project: `requireProjectPermission(MISSION_READ)` (`repository.ts:4189-4193`); otherwise `callerAuthorizedWorkspaceScopes(MISSION_READ)` + `allocateWorkspaceSearchLimits` + `mergeWorkspaceSearchV3` (`repository.ts:4197-4212`) | yes | aggregate-project-filtered | yes | Inject/intersect `projects` with the allowlist at `repository.ts:4162-4163` (before `searchInWorkspace`), reject a requested project outside the allowlist with 404, and compute quotas over workspaces that still have ≥1 allowlisted project. `searchWorkspaceMissionsV3` (`packages/core/service/mission-search.ts:1430`) already accepts `projectIds`. |

### 1.9 Missions

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/missions` | `createMissionTx` → `requireProjectPermission(MISSION_CREATE)` on `body.projectId` (`repository.ts:5212-5216`) | yes | project-bound (create) | yes | Target project checked via `requireProjectPermission`; §9.3 unassigned-by-default semantics land in `createMissionTx`/`resolveAssignedWorkspaceUserId` (`repository.ts:5612`). Returns `getMissionDetail` (below). |
| `GET /api/missions/:id` | `markMissionStatusesSeen` (writes `mission_status_seen`, `repository.ts:4347-4400`) then `getMissionDetail` → `getMissionRow` → `requireMissionPermission(MISSION_READ)` (`repository.ts:4321-4331, 4425`) | yes | project-bound | yes | Project id: `missions.project_id` from the row; predicate belongs in `requireMissionPermission` (`rbac.ts:249-278`) — note UUID lookup is global (`rbac.ts:249-252`), display-id lookup spans the snapshot (`rbac.ts:259-265`) and can 409 on ambiguity before authorization (R2). Detail embeds `listObjectives` (`OBJECTIVE_READ`), `selectProjectStatuses`, `listMissionExecutionRequests` (`launch.ts:904-916`, no own check), `listMissionTerminalSessions` (`latch-sessions.ts:38-77`, no own check), `missionBranchDto`, `missionCreatedFromDto` (`repository.ts:4401-4423`, workspace-scoped). Side effect: a read-only preset writes `mission_status_seen` + an entity_changes `mission` row (`repository.ts:4366`). Consider skipping `markMissionStatusesSeen` for token actors. |
| `PATCH /api/missions/:id` | `patchMissionFieldsTx` → `getMissionRow(MISSION_UPDATE)` (`repository.ts:5633`) | no | project-bound (write) | excluded | |
| `DELETE /api/missions/:id` | `deleteMissions` → `getMissionRow(MISSION_DELETE)` (`repository.ts:6000`) | no | project-bound (write) | excluded | |
| `POST /api/missions/:id/generate-title` | `getMissionDetail` → `MISSION_READ` only (`repository.ts:5588`), then persists a title | **yes** | project-bound (write with read gate) | excluded | F4: a read grant triggers a title write; guard must 404. |
| `POST /api/missions/:id/generate-commit-message` | `loadBranchActionContext` → `getMissionRow(MISSION_UPDATE)` (`repository.ts:1370`) | no | project-bound | excluded | |
| `GET /api/missions/:id/objectives` | `requireMissionPermission(OBJECTIVE_READ)` (`repository.ts:7245-7249`) | yes | project-bound | yes | Predicate via `requireMissionPermission`. |
| `PATCH /api/missions/:id/objectives/reorder` | `requireMissionPermission(OBJECTIVE_UPDATE)` (`repository.ts:7379-7383`) | no | project-bound (write) | excluded | |
| `POST /api/missions/:id/session-channel` | none; always 410 (`agent-session-routes.ts:1043-1050`) | yes (410) | projectless-denied | excluded | |
| `POST /api/missions/:id/terminal-sessions/forget` | no `requires` (extraction wrong); `requireMissionPermission(SESSION_READ)` (`latch-sessions.ts:81-83`) | **yes** | project-bound (write) | excluded | F4: `session:read` gates a write. |
| `GET /api/missions/:id/events` | **no `requires`** (`index.ts:1906-1909`; extracted `MISSION_UPDATE` belongs to `PUT …/context`). `listMissionEvents` → `getMissionRow(EVENT_READ)` (`repository.ts:4469`) | yes | project-bound | yes | Answer (b): no `MISSION_UPDATE`; gate is `event:read`, which the preset has. Predicate via `requireMissionPermission`. |
| `GET /api/missions/:id/deliveries` | no `requires`; `getMissionRow(MISSION_READ)` (`repository.ts:4564`) | yes | project-bound | yes | Answer (b). Predicate via `requireMissionPermission`. |
| `GET /api/missions/:id/artifacts` | no `requires`; `getMissionRow(ARTIFACT_READ)` (`repository.ts:4786`) | yes | project-bound | yes | Answer (b). |
| `GET /api/missions/:id/context` | no `requires`; `getMissionRow(MISSION_READ)` (`repository.ts:4832`) | yes | project-bound | yes | Answer (b). Shared-context read; include (agents read it via `load-context` anyway). |
| `PUT /api/missions/:id/context` | `requires: MISSION_UPDATE` (`index.ts:1926`) | no | project-bound (write) | excluded | |
| `POST /api/missions/:id/artifacts` | `requires: ARTIFACT_CREATE` (`index.ts:1933`) | no | project-bound (write) | excluded | |
| `PATCH /api/missions/:id/artifacts/:artifactId` | `requires: MISSION_UPDATE` (`index.ts:1940`) | no | project-bound (write) | excluded | |
| `GET /api/missions/:id/file-changes` | no `requires` (extracted `MISSION_READ` belongs to `schedule/preview`); `getMissionRow(MISSION_READ)` (`repository.ts:4668`) | yes | project-bound | yes (optional; delivery evidence) | Predicate via `requireMissionPermission`. |
| `POST /api/missions/schedule/preview` | `requires: MISSION_READ` (`index.ts:1949`); pure computation (`repository.ts:6347`) | yes | safe-non-project-metadata | excluded (not needed) | Reads no data. |
| `GET /api/missions/:id/schedule` | `getMissionRow(MISSION_READ)` (`repository.ts:6354`) | yes | project-bound | excluded (not needed) | Safe to add later; predicate via `requireMissionPermission`. |
| `PUT /api/missions/:id/schedule` | `getMissionRow(MISSION_UPDATE)` (`repository.ts:6379`) | no | project-bound (write) | excluded | |
| `DELETE /api/missions/:id/schedule` | `getMissionRow(MISSION_UPDATE)` (`repository.ts:6469`) | no | project-bound (write) | excluded | |
| `POST /api/missions/:id/branch-prepared` | **none** — `recordBranchPrepared` only checks live membership via `callerWorkspaceMemberships` and mission existence (`runner.ts:645-673`) | yes (no check) | project-bound (runner write) | excluded | F1: unauthenticated-by-RBAC write. |
| `POST /api/missions/:id/branch/action` | no `requires` (extracted `PROJECT_READ` belongs to `/api/worktrees`); `loadBranchActionContext` → `getMissionRow(MISSION_UPDATE)` (`repository.ts:1370, 1523`) | no | project-bound (write) | excluded | |
| `GET /api/missions/:id/branches` | no `requires`; `getMissionRow(MISSION_READ)` (`repository.ts:1613-1617`) | yes | project-bound | excluded (not needed) | |

### 1.10 Objectives and attachments

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/objectives` | `createObjectiveTx` → `requireMissionPermission(OBJECTIVE_UPDATE)` (`repository.ts:7509-7513`) | no | project-bound (write) | excluded | |
| `PATCH /api/objectives/:id` | `updateObjectiveTx` → `requireObjectivePermission(OBJECTIVE_UPDATE)` (`repository.ts:8025-8027`, `7635-7656`) | no | project-bound (write) | excluded | |
| `DELETE /api/objectives/:id` | `deleteObjectives` → `requireObjectivePermission(OBJECTIVE_UPDATE)` (`repository.ts:6055-6057`) | no | project-bound (write) | excluded | |
| `POST /api/objectives/:id/launch` | `resolveObjectiveIdForRest` + `actorCan(EXECUTION_REQUEST_CREATE)` (`launch.ts:1072, 1107-1116`) | no | project-bound (launch) | excluded | |
| `GET /api/objectives/:id/prompt` | `resolveObjectiveIdForRest` (`objective-ref.ts:40-88`, snapshot-bounded) then `actorCan(OBJECTIVE_READ)` on the objective's workspace via **live membership** `findActiveMembershipId` (`launch.ts:1315-1352`) | yes | project-bound | excluded (launch prompt; not needed) | Project id available as `o.project_id` but not selected (`launch.ts:1331-1336`); if allowed, predicate goes after the row load. |
| `GET /api/objectives/:id/launch-command` | same pattern, `actorCan(OBJECTIVE_READ)` (`launch.ts:1475-1507`) | yes | projectless-denied (launch config) | excluded | F4: passes but is launch configuration. |
| `GET /api/objectives/:id/effective-launch-config` | same pattern, `actorCan(OBJECTIVE_READ)` (`launch.ts:1405-1432`) | yes | projectless-denied (launch config) | excluded | F4. |
| `GET /api/objectives/:id/attachments` | `listObjectiveAttachments` → `resolveObjectiveScope(…, ATTACHMENT_READ)` → `resolveObjectiveIdForRest` + `requireWorkspacePermission(ATTACHMENT_READ)` on `objectives.workspace_id` (`storage.ts:420-440, 592-603`) | yes | project-bound | yes | Answer (a): exact permission is `attachment:read` (default of `resolveObjectiveScope`, `storage.ts:423`). Workspace-level only; `row.project_id` is already selected at `storage.ts:426-428` — apply the allowlist there (404). Also `resolveObjectiveIdForRest` (`objective-ref.ts:62-81`) resolves UUID/display id across the whole snapshot and 409s on ambiguity before any permission check (R2). |
| `POST /api/objectives/:id/attachments` | `resolveObjectiveScope(…, ATTACHMENT_CREATE)` (`storage.ts:508-511`) | no | project-bound (write) | excluded | |
| `DELETE /api/objectives/:id/attachments/:attachmentId` | `resolveObjectiveScope(…, ATTACHMENT_DELETE)` (`storage.ts:616`) | no | project-bound (write) | excluded | |

### 1.11 Agent requests / session inputs (human routers)

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/agent-requests` (mission-scoped, `?missionId`/display-id objective) | `missionScopedRequests`: mission looked up inside **live memberships** (`agent-session-routes.ts:708-717`), then `requireWorkspacePermission(SESSION_READ)` (`719-724`) | yes | project-bound | excluded | Session surface (§4.2 "session" denied). `agent_requests.project_id` is projected (`REQUEST_COLUMNS_FOR_ROUTE`, `1032`) — predicate would go after the mission lookup. |
| `GET /api/agent-requests` (unfiltered) | per live membership `requireWorkspacePermission(SESSION_READ)` (`agent-session-routes.ts:771-784`), then `SELECT … WHERE workspace_id IN (…) LIMIT 200` (`788-793`) | yes | aggregate-project-filtered | excluded | Account-wide request inbox across all consented workspaces; would need `AND project_id IN (…)` before `LIMIT 200`. |
| `POST /api/agent-requests/:id/resolve` | `requireWorkspacePermission(SESSION_ATTACH)` (`agent-session-routes.ts:822-827`) | no | project-bound (write) | excluded | |
| `POST /api/agent-requests/:id/release` | none; always 410 (`agent-session-routes.ts:882-885`) | yes (410) | projectless-denied | excluded | |
| `GET /api/agent-session-inputs` | mission looked up in live memberships (`agent-session-routes.ts:941-950`), then `requireWorkspacePermission(SESSION_READ)` (`952-957`); also returns the latest `agent_session_channels` row (`979-995`) | yes | project-bound | excluded | Session surface. |
| `POST /api/agent-session-inputs` | none; 410 (`1020-1023`) | yes (410) | projectless-denied | excluded | |
| `POST /api/agent-session-inputs/:id/cancel` | none; 410 (`1025-1028`) | yes (410) | projectless-denied | excluded | |

### 1.12 Agent catalog, launch settings, execution targets

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/agent-catalog` | `resolveCatalogWorkspaceId(LAUNCH_READ)` (`launch.ts:305-311`); without `workspaceId` it falls back to the implicit workspace (`launch.ts:202-205`), which is `null` for tokens → 400 | no | projectless-denied | excluded | |
| `POST /api/agent-catalog/refresh` | `LAUNCH_CONFIGURE` (`launch.ts:326-331`) | no | projectless-denied | excluded | |
| `PUT /api/agent-catalog` | `LAUNCH_CONFIGURE` (`launch.ts:429-437`) | no | projectless-denied | excluded | |
| `GET /api/launch-settings` | `resolveLaunchSettingsScope(LAUNCH_READ)` (`launch.ts:596-598`) | no | projectless-denied | excluded | |
| `PATCH /api/launch-settings/agents/:agentKey` | `LAUNCH_CONFIGURE` (`launch.ts:612`) | no | projectless-denied | excluded | |
| `PATCH /api/launch-settings/terminal-profile` | `LAUNCH_CONFIGURE` (`launch.ts:647`) | no | projectless-denied | excluded | |
| `PATCH /api/launch-settings/session-defaults` | `LAUNCH_CONFIGURE` (`launch.ts:682`) | no | projectless-denied | excluded | |
| `PATCH /api/launch-settings/worktree-branch-automation` | `updateWorktreeBranchAutomation` (`launch.ts:707-733`) delegates to the same `LAUNCH_CONFIGURE` scope path as session defaults | no | projectless-denied | excluded | |
| `GET /api/workspaces/:id/launch-settings` | `LAUNCH_READ` (`launch.ts:596-598, 267-272`) | no | projectless-denied | excluded | |
| `PATCH /api/workspaces/:id/launch-settings/agents/:agentKey` | `LAUNCH_CONFIGURE` (`launch.ts:612`) | no | projectless-denied | excluded | |
| `PATCH /api/workspaces/:id/launch-settings/terminal-profile` | `LAUNCH_CONFIGURE` (`launch.ts:647`) | no | projectless-denied | excluded | |
| `PATCH /api/workspaces/:id/launch-settings/session-defaults` | `LAUNCH_CONFIGURE` (`launch.ts:682`) | no | projectless-denied | excluded | |
| `PATCH /api/workspaces/:id/launch-settings/worktree-branch-automation` | `LAUNCH_CONFIGURE` (as above) | no | projectless-denied | excluded | |
| `POST /api/execution-targets/:id/observations` | `requireExecutionTargetObservationContext`: live membership + `actorCan(LAUNCH_CONFIGURE) || actorCan(EXECUTION_REQUEST_CLAIM)` (`branching/execution-target-observation-scope.ts:12-36`) | no | projectless-denied | excluded | |
| `POST /api/execution-targets/:id/mission-branch-observations` | same (`execution-target-observation-scope.ts:12-36`) | no | projectless-denied | excluded | |

### 1.13 Protocol dispatcher, runner, worktrees

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/protocol/:subcommand` | per subcommand via `SUBCOMMAND_PERMISSIONS` inside `buildProtocolContext` (`protocol.ts:1663-1704, 1719-1741, 279-323`) | per §2 | per §2 | yes, restricted to the subcommands in §2 marked allowed | The guard must match `:subcommand` against the protocol allowlist (and the `search` alias, `protocol.ts:1717`). |
| `GET /api/runner/status` | **none** — `resolveRunnerScopes` uses `callerWorkspaceMemberships` (live memberships, `runner.ts:120-129`) and core `listExecutionRequests` has no RBAC (`packages/core/service/execution-requests.ts:646-660`) | yes (no check) | aggregate-project-filtered (execution requests across all memberships) | excluded | F1. Leaks queue contents of every workspace/project the owner belongs to, even non-consented ones. |
| `POST /api/runner/claim` | **none** in the adapter (`runner.ts:237-358`, only `resolveRunnerScopes` at 255) and none in core | yes (no check) | projectless-denied (runner) | excluded | F1. |
| `POST /api/runner/clear` | **none** (`runner.ts:674-690`, `clearExecutionRequests` core has no RBAC) | yes (no check) | projectless-denied (runner write) | excluded | F1. |
| `POST /api/runner/requests/:id/launching` | `requestRunnerContext` → `requireWorkspacePermission(EXECUTION_REQUEST_CLAIM)` (`runner.ts:88-104`) | no | projectless-denied | excluded | |
| `POST /api/runner/requests/:id/launched` | same (`runner.ts:97-101`) | no | projectless-denied | excluded | |
| `POST /api/runner/requests/:id/failed` | same | no | projectless-denied | excluded | |
| `POST /api/runner/requests/:id/completed` | same | no | projectless-denied | excluded | |
| `GET /api/worktrees` | `requires: PROJECT_READ` (`index.ts:2329`); returns `[]` (`repository.ts:1624-1626`) | yes | safe-non-project-metadata (empty) | excluded | Local-only surface. |
| `POST /api/worktrees/remove` | `requires: PROJECT_UPDATE` + `requireProjectPermission` (`index.ts:2334`, `repository.ts:1649`) | no | project-bound (write) | excluded | |
| `POST /api/worktrees/purge-merged` | `PROJECT_UPDATE` (`index.ts:2342`, `repository.ts:1701`) | no | project-bound (write) | excluded | |

## 2. Protocol subcommands (`POST /api/protocol/:subcommand`, `backend/protocol.ts:1663-1704`)

Context building (`buildProtocolContext`, `protocol.ts:279-323`): `protocolWorkspaceId` derives the workspace from `--execution-request-id`, `--session-key`, `--objective-id`, `--mission-id` or `--project-id` by searching **`callerWorkspaceMemberships()`** (live memberships, `protocol.ts:203-278`), then, when the permission is non-null, `requireWorkspacePermission` (snapshot + `actorCan`). When the permission is **null** (`create`, `delete-*`, `auth-status`, `create-project`, `register-target`) and a workspace was derived, the membership is taken straight from `callerWorkspaceMemberships` (`protocol.ts:312-315`) with **no snapshot/consent check** (R4). Entity resolution inside a handler is workspace-scoped through `resolveMissionId`/`resolveProjectId`/`resolveObjectiveRef` (`packages/core/service/context.ts:96-150, 179-295`) — never project-scoped.

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `attach` | `SESSION_ATTACH` (`protocol.ts:1664`) | no | projectless-denied (session) | excluded | |
| `update` | `EVENT_CREATE` (`1665`) | no | project-bound (write) | excluded | |
| `sync-changes` | `EVENT_CREATE` (`1666`) | no | project-bound (write) | excluded | |
| `heartbeat` | `EVENT_CREATE` (`1667`) | no | session | excluded | |
| `ask` | `EVENT_CREATE` (`1668`) | no | session | excluded | |
| `deliver` | `EVENT_CREATE` (`1669`) | no | project-bound (write) | excluded | |
| `hook-event` | `EVENT_CREATE` (`1670`) | no | session | excluded | |
| `resume-follow-up` | `SESSION_ATTACH` (`1671`) | no | session | excluded | |
| `create` | **null** (`1672`). Handler: `--unassigned-to-project`/`--inbox` → `createInboxItem` (profile only, `protocol.ts:1225-1243`); else `protocolCreate` → `resolveProjectId(ctx, …)` (workspace-scoped) → `createMissionWithObjectives` with **no RBAC check** (`packages/core/service/protocol.ts:2795-2834`, `missions.ts:601-700`) | **yes (no check at all)** | project-bound (create) / inbox branch projectless | yes for the project branch only | F5: Phase 1 must (a) gate `create` on `mission:create` against the resolved project's workspace (`requireProjectPermission`-equivalent after `resolveProjectId`), (b) apply the project allowlist, (c) reject the inbox branch (`--unassigned-to-project`, `--inbox`) with 404 for the preset, (d) stop relying on the null-permission membership path (R4). |
| `prompt` | `MISSION_CREATE` (`1673`); `protocolPrompt` creates the mission **and attaches a session** (`core/protocol.ts:2836+`) | **yes** | project-bound (create + session) | excluded | F4: grant passes but the command opens a session. |
| `load-context` | `MISSION_READ` (`1674`); `loadMissionContext` → `getMissionSummary`/`resolveMissionId` workspace-scoped (`core/protocol.ts:622-655`, `missions.ts:754`) | yes | project-bound | yes | Project id: `mission.projectId` from `resolveMissionId` (`context.ts:96-125`); add the allowlist check right after resolution (404). Also `resolveProtocolExecutionTargetId` reads execution-target rows for the workspace — acceptable once the mission is authorized. |
| `list-deliveries` | `MISSION_READ` (`1675`); handler calls the REST `listMissionDeliveries` → `getMissionRow(MISSION_READ)` (`protocol.ts:1292`, `repository.ts:4564`) | yes | project-bound | yes | Predicate via `requireMissionPermission`. |
| `launch-objective` | `EXECUTION_REQUEST_CREATE` (`1676`) | no | launch | excluded | |
| `reorder-future-objectives` | `OBJECTIVE_UPDATE` (`1677`) | no | write | excluded | |
| `queue-objective` | `EXECUTION_REQUEST_CREATE` (`run-queue.ts:460`) | no | run queue | excluded | |
| `dequeue-objective` | `EXECUTION_REQUEST_CREATE` (`461`) | no | run queue | excluded | |
| `retry-queue-entry` | `EXECUTION_REQUEST_CREATE` (`462`) | no | run queue | excluded | |
| `reorder-run-queue` | `EXECUTION_REQUEST_CREATE` (`463`) | no | run queue | excluded | |
| `create-run-queue` | `PROJECT_UPDATE` (`467`) | no | run queue | excluded | |
| `update-run-queue` | `PROJECT_UPDATE` (`468`) | no | run queue | excluded | |
| `delete-run-queue` | `PROJECT_UPDATE` (`469`) | no | run queue | excluded | |
| `reorder-project-run-queues` | `PROJECT_UPDATE` (`470`) | no | run queue | excluded | |
| `run-queue` (list) | `OBJECTIVE_READ` (`471`); project via `runQueueProjectIdFromProtocol` (`run-queue.ts:82-108`, workspace-scoped resolvers) | **yes** | project-bound (run queue read) | excluded | F4. |
| `connect` | `SESSION_ATTACH` (`1679`) | no | session | excluded | |
| `search-missions` / `search` | `MISSION_READ` for v1 (`1680`); **null** for `--response-version 2|3` (`protocol.ts:1726-1738`, authorization happens inside `searchMissionsAcrossWorkspacesV2/V3`). v1 path: core `searchMissions` on the single derived workspace (`missions.ts:888`). Project ref resolution for v2/v3: `resolveV2SearchProjectId` → `callerMembershipsInActiveOrganization` (snapshot when present) (`protocol.ts:771-785`) | yes | aggregate-project-filtered | yes (v3 only; v1/v2 should be rejected for the preset or routed to the same filter) | Same predicate as `GET /api/search/v3` (`repository.ts:4162-4212`); `resolveV2SearchProjectId` must 404 a ref that resolves outside the allowlist and must not return `project_selection_required` listing hidden projects (`resolveProjectRefChoices`). |
| `discuss-objective` | `OBJECTIVE_SUBMIT` (`1681`) | no | write | excluded | |
| `add-objectives` | `OBJECTIVE_UPDATE` (`1682`) | no | write | excluded | |
| `update-objective` | `OBJECTIVE_UPDATE` (`1683`) | no | write | excluded | |
| `delete-missions` | null (`1687`); per-target `getMissionRow(MISSION_DELETE)` (`repository.ts:6000`) | no | write | excluded | |
| `delete-objectives` | null (`1688`); per-target `requireObjectivePermission(OBJECTIVE_UPDATE)` (`repository.ts:6055`) | no | write | excluded | |
| `record-work` | `MISSION_CREATE` (`1689`); creates a mission + delivery + artifacts (`protocol.ts:1442+`) | **yes** | project-bound (create + delivery write) | excluded | F4: `mission:create` also unlocks record-work; exclude via the guard. |
| `read-context` | `MISSION_READ` (`1690`); `listSharedContext` → `resolveMissionId` (`missions.ts:1237-1250`) | yes | project-bound | excluded (covered by `GET /api/missions/:id/context`; add later if agents need it) | Predicate after `resolveMissionId`. |
| `write-context` | `MISSION_UPDATE` (`1691`) | no | write | excluded | |
| `add-artifact` | `ARTIFACT_CREATE` (`1692`) | no | write | excluded | |
| `update-artifact` | `MISSION_UPDATE` (`1693`) | no | write | excluded | |
| `attachment-list` | `ARTIFACT_READ` (`1694`); core `listAttachments` (`missions.ts:1477-1520`) → `resolveMissionId` (workspace-scoped), **no `attachment:read` check** and the SQL has no `workspace_id` predicate (mission id is workspace-resolved, so this is safe) | yes | project-bound | yes | Predicate after `resolveMissionId`. Gate is `artifact:read`, not `attachment:read` (harmless for this preset since both are granted, but the contract should say so). |
| `attachment-download-url` | `ARTIFACT_READ` (`1695`); same `listAttachments` then builds `/api/storage/attachments/<key>` (`protocol.ts:1600-1617`) | yes | project-bound | yes | Predicate after `resolveMissionId`; the download itself is gated by §1.4. |
| `auth-status` | null (`1696`); returns `ctx.workspace` id/name and actor (`core/protocol.ts:3121-3134`) | yes | safe-non-project-metadata | yes | With no addressing flags the anchor workspace is the lexicographically first snapshot workspace (`protocol.ts:287-289`); it reveals nothing beyond consent. |
| `discover-project` | `PROJECT_READ` (`1697`); `discoverProject` → `resolveProjectId`/`getProject`/`listProjectResources` workspace-scoped (`core/projects.ts:918-947`); directory mode reads `.overlord/project.json` on the **server** filesystem (`949-1010`) | yes | project-bound | yes (`--project-id` form); directory form should 404 for the preset | Predicate after `resolveProjectId` (`projects.ts:928`). Project-ref ambiguity in `protocolWorkspaceId` returns `project_selection_required` with project names from `resolveProjectRefChoices` (`protocol.ts:268-277`) — must be filtered to allowlisted projects (R3). |
| `statuses` | `PROJECT_READ` (`1698`); core `listProjectStatuses` → `resolveProjectId` (`projects.ts:325-333`) | yes | project-bound | yes | Predicate after `resolveProjectId`. |
| `create-project` | null (`1701`); handler does its own `requireWorkspacePermission(PROJECT_CREATE)` | no | projectless-denied | excluded | |
| `register-target` | null (`1702`) | no (`EXECUTION_REQUEST_CLAIM` inside) | projectless-denied | excluded | |
| `list-organizations` | `PROJECT_READ` (`1703`); returns the anchor workspace (`protocol.ts:1652-1654`) | yes | safe-non-project-metadata | excluded (redundant with `auth-status`) | |

## 3. Hosted MCP tools (`mcp/tool-catalog.ts`, dispatched by `mcp/server.ts:304-680` through `runProtocolSubcommand`)

`POST /mcp` (`backend/index.ts:595-605`) is authenticated by `requireAuthenticatedSession` and inherits the token snapshot/scopes; every tool is a thin mapping onto a protocol subcommand, so the §2 row governs. The MCP dispatcher must apply the same subcommand allowlist (a tool whose subcommand is not allowed returns a tool error / `tools/list` omits it).

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `overlord_resolve_project` → `discover-project` (`server.ts:305-319`) | `PROJECT_READ` | yes | project-bound | yes (projectId form) | Directory form must 404 for the preset. |
| `overlord_create_project` → `create-project` (`320-333`) | `PROJECT_CREATE` in handler | no | projectless-denied | excluded | |
| `overlord_list_project_statuses` → `statuses` (`334-343`) | `PROJECT_READ` | yes | project-bound | yes | |
| `overlord_search_missions` → `search --response-version 3` (`344-383`) | aggregate (null gate; MISSION_READ inside) | yes | aggregate-project-filtered | yes | Same fix as v3. |
| `overlord_create_mission` → `create --project-id` (`384-407`); `unassignedToProject: true` maps to the inbox branch | none today (F5) | yes | project-bound (create) | yes, with `unassignedToProject` rejected | |
| `overlord_create_inbox_item` → `create --unassigned-to-project` (`408-416`) | none (profile inbox) | yes | projectless-denied (inbox capture) | excluded | |
| `overlord_load_mission_context` → `load-context` (`417-426`) | `MISSION_READ` | yes | project-bound | yes | |
| `overlord_list_deliveries` → `list-deliveries` (`427-428`) | `MISSION_READ` | yes | project-bound | yes | |
| `overlord_launch_objective` → `launch-objective` (`429-441`) | `EXECUTION_REQUEST_CREATE` | no | launch | excluded | |
| `overlord_reorder_future_objectives` → `reorder-future-objectives` (`442-453`) | `OBJECTIVE_UPDATE` | no | write | excluded | |
| `overlord_add_objectives` → `add-objectives` (`454-464`) | `OBJECTIVE_UPDATE` | no | write | excluded | |
| `overlord_update_objective` → `update-objective` (`465-481`) | `OBJECTIVE_UPDATE` | no | write | excluded | |
| `overlord_delete_missions` → `delete-missions` (`482-493`) | `MISSION_DELETE` per target | no | write | excluded | |
| `overlord_delete_objectives` → `delete-objectives` (`494-508`) | `OBJECTIVE_UPDATE` per target | no | write | excluded | |
| `overlord_list_run_queues` → `run-queue` (`509-516`) | `OBJECTIVE_READ` | **yes** | run queue read | excluded | F4. |
| `overlord_reorder_run_queue` → `reorder-run-queue` (`517-520`) | `EXECUTION_REQUEST_CREATE` | no | run queue | excluded | |
| `overlord_queue_objective` → `queue-objective` / `dequeue-objective` (`521-524`) | `EXECUTION_REQUEST_CREATE` | no | run queue | excluded | |
| `overlord_manage_run_queue` → `create/update/delete-run-queue`, `retry-queue-entry`, `reorder-project-run-queues` (`525-528`) | `PROJECT_UPDATE` / `EXECUTION_REQUEST_CREATE` | no | run queue | excluded | |
| `overlord_attach_session` → `attach` (`529-541`) | `SESSION_ATTACH` | no | session | excluded | |
| `overlord_update_session` → `update` (`542-557`) | `EVENT_CREATE` | no | write | excluded | |
| `overlord_deliver_session` → `deliver` (`558-606`) | `EVENT_CREATE` | no | write | excluded | |
| `overlord_add_artifact` → `add-artifact` (`607-626`) | `ARTIFACT_CREATE` | no | write | excluded | |
| `overlord_update_artifact` → `update-artifact` (`627-650`) | `MISSION_UPDATE` | no | write | excluded | |
| `overlord_record_work` → `record-work` (`651-668`) | `MISSION_CREATE` | **yes** | create + delivery write | excluded | F4. |

## 4. Realtime and sync

| Surface | Enforced permission (file:line) | Passes? | Classification | On allowlist? | Predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/stream`, `GET /realtime` (live SSE) | `readableChangeFeedWorkspaceIds` → `actorCan(PROJECT_READ)` per snapshot workspace (`realtime.ts:74-87`) | yes | aggregate-project-filtered | yes | `RealtimeHub.addClient` stores only `workspaceIds` (`realtime.ts:158-175`); add `projectIds: Set<string> | null` and `allowedNonProjectEntityTypes` to `RealtimeClient` and filter in `broadcastChanges` (`realtime.ts:246-255`). `reconnectClientsForAuthorizationChange` (`realtime.ts:257-262`) already ends streams on `AUTHORIZATION_CHANGE_ENTITY_TYPES` (`realtime.ts:10-16`); add a `user_token_project` (or whatever the selection table is called) entity type so a project-selection change reconnects and rebuilds the snapshot (§4.3). |
| SSE catch-up (`Last-Event-ID` / `?after`) | same gate; `sendCatchUp` → `readChangesAfter(cursor, client.workspaceIds)` (`realtime.ts:264-278`) | yes | aggregate-project-filtered | yes | Pass the project allowlist through to `readChangesAfter`. |
| `GET /sync/changes` | same gate (`index.ts:1233-1252`); `readChangesAfter` SQL `WHERE seq > ? AND seq <= ? AND workspace_id IN (…)` (`realtime.ts:107-115`) | yes | aggregate-project-filtered | yes | Add `AND (project_id IN (…) OR (project_id IS NULL AND entity_type IN (…)))` before `LIMIT` so `hasMore` and `cursor` are computed over visible rows. |
| Row-level exposure | `entityChangeDtoFromRow` (`realtime.ts:51-64`) exposes `workspaceId, entityType, entityId, operation, projectId, missionId, objectiveId, changedFields` | n/a | n/a | n/a | No payload beyond ids/field names, but ids of hidden projects/missions must not leak; the predicate above is sufficient. |

## 5. Extension routes (`/ext/everhour`, `/ext/github`; mounted `index.ts:1642-1646` behind `requireAuthenticatedSession`)

`projectRoute`/`missionRoute` (`backend/ext/resource-routes.ts:8-20`) call `requireProjectPermission`/`requireMissionPermission` with the named permission and therefore inherit the project predicate once it lives in `rbac.ts`. None of these routes are needed by the automation; the guard must 404 the whole `/ext` prefix for the preset (note the guard is on `/api`; `/ext/*` needs the same treatment or its own guard).

| Route/command | Enforced permission (file:line) | Passes preset grants? | Classification | On allowlist? | Project predicate location / notes |
| --- | --- | --- | --- | --- | --- |
| `GET /ext/everhour/user-connection` | none beyond profile (`everhour/service.ts:438-450`, `readActorUserConnection` 361) | yes | projectless-denied | excluded | Account integration. |
| `PUT /ext/everhour/user-connection` | none beyond profile (`453`) | yes | projectless-denied | excluded | Stores an API key. |
| `DELETE /ext/everhour/user-connection` | none beyond profile (`466`) | yes | projectless-denied | excluded | |
| `GET /ext/everhour/integration` (alias) | as above | yes | projectless-denied | excluded | |
| `PUT /ext/everhour/integration` (alias) | as above | yes | projectless-denied | excluded | |
| `DELETE /ext/everhour/integration` (alias) | as above | yes | projectless-denied | excluded | |
| `PUT /ext/everhour/projects/:projectId/link` | `projectRoute(PROJECT_UPDATE)` (`everhour/routes.ts:62`) | no | project-bound (write) | excluded | |
| `GET /ext/everhour/projects/:projectId/link` | `projectRoute(PROJECT_READ)` (`routes.ts:71`); service `assertProjectExists` is existence-only (`service.ts:488-497`) | yes | project-bound | excluded | |
| `GET /ext/everhour/projects/:projectId` | `projectRoute(PROJECT_READ)` (`routes.ts:77`) | yes | project-bound | excluded | Reads the owner's Everhour records. |
| `POST /ext/everhour/projects/:projectId/timer/start` | `PROJECT_UPDATE` (`routes.ts:83`) | no | write | excluded | |
| `POST /ext/everhour/projects/:projectId/timer/stop` | `PROJECT_UPDATE` (`routes.ts:92`) | no | write | excluded | |
| `POST /ext/everhour/projects/:projectId/time` | `PROJECT_UPDATE` (`routes.ts:101`) | no | write | excluded | |
| `PATCH /ext/everhour/projects/:projectId/time/:recordId` | `PROJECT_UPDATE` (`routes.ts:112`) | no | write | excluded | |
| `DELETE /ext/everhour/projects/:projectId/time/:recordId` | `PROJECT_UPDATE` (`routes.ts:121`) | no | write | excluded | |
| `GET /ext/everhour/missions/:missionId` | `missionRoute(MISSION_READ)` (`routes.ts:130`) + `getMissionRow(MISSION_READ)` (`service.ts:1077`) | yes | project-bound | excluded | |
| `POST /ext/everhour/missions/:missionId/timer/start` | `MISSION_UPDATE` (`routes.ts:136`) | no | write | excluded | |
| `POST /ext/everhour/missions/:missionId/timer/stop` | `MISSION_UPDATE` (`routes.ts:145`) | no | write | excluded | |
| `POST /ext/everhour/missions/:missionId/time` | `MISSION_UPDATE` (`routes.ts:154`) | no | write | excluded | |
| `PATCH /ext/everhour/missions/:missionId/time/:recordId` | `MISSION_UPDATE` (`routes.ts:165`) | no | write | excluded | |
| `DELETE /ext/everhour/missions/:missionId/time/:recordId` | `MISSION_UPDATE` (`routes.ts:174`) | no | write | excluded | |
| `GET /ext/github/user-connection` | none beyond profile (`github/user-oauth.ts:213-217`) | yes | projectless-denied | excluded | |
| `POST /ext/github/user-connection/authorize` | none beyond profile (`user-oauth.ts:253+`) | yes | projectless-denied | excluded | Starts OAuth. |
| `DELETE /ext/github/user-connection` | no `requires` (extraction picked up `/callback`'s); profile only (`user-oauth.ts:743`) | yes | projectless-denied | excluded | |
| `GET /ext/github/repository-owners` | no `requires`; profile connection (`user-oauth.ts:606-612`) | yes | projectless-denied | excluded | Calls GitHub with the owner's token. |
| `GET /ext/github/integration` | no `requires`; `requireWorkspacePermission(WORKSPACE_READ)` (`github/service.ts:216-218`) | no | projectless-denied | excluded | |
| `POST /ext/github/install` | `WORKSPACE_UPDATE` (`service.ts:236-238`) | no | projectless-denied | excluded | |
| `GET /ext/github/callback` | `requires: WORKSPACE_UPDATE` (`routes.ts:84`) + `WORKSPACE_UPDATE` (`service.ts:254-256`) | no | projectless-denied | excluded | |
| `DELETE /ext/github/integration` | `WORKSPACE_UPDATE` (`service.ts:331-333`) | no | projectless-denied | excluded | |
| `GET /ext/github/repos` | `requireWorkspacePermission(PROJECT_READ)` on `?workspaceId` (`service.ts:368-370`) | **yes** | projectless-denied (workspace GitHub installation repos) | excluded | F4. |
| `GET /ext/github/projects/:projectId/link` | `projectRoute(PROJECT_READ)` (`routes.ts:100`); service `assertProject` existence-only (`service.ts:393-397`) | yes | project-bound | excluded | |
| `PUT /ext/github/projects/:projectId/link` | `PROJECT_UPDATE` (`routes.ts:106`) | no | write | excluded | |
| `GET /ext/github/missions/:missionId/pull-request` | `missionRoute(MISSION_READ)` (`routes.ts:117`); service does a raw `SELECT workspace_id FROM missions WHERE id = ?` with no further check (`service.ts:516-525`) | yes | project-bound | excluded | Only the route wrapper authorizes; if the service is ever called from elsewhere it is unguarded. |
| `POST /ext/github/missions/:missionId/pull-request` | `MISSION_UPDATE` (`routes.ts:125`) | no | write | excluded | |

## 6. Findings

### F1. Routes with no RBAC gate at all (pass for any authenticated token today; must 404 via the guard)

| Route | Evidence |
| --- | --- |
| `GET /api/runner/status` | `resolveRunnerScopes` → `callerWorkspaceMemberships` (live memberships, `runner.ts:120-129`); core `listExecutionRequests` has no permission check (`packages/core/service/execution-requests.ts:646-660`). Returns every active execution request in every workspace the owner belongs to, including non-consented ones. |
| `POST /api/runner/claim` | `runner.ts:237-358` (only `resolveRunnerScopes` at 255); no RBAC in core. |
| `POST /api/runner/clear` | `runner.ts:674-690`; `clearExecutionRequests` (`execution-requests.ts:1098`) has no RBAC. |
| `POST /api/missions/:id/branch-prepared` | `recordBranchPrepared` checks only live membership + mission existence (`runner.ts:645-673`). |
| `POST /api/onboarding` | by design (`index.ts:689-700`). |
| `POST /api/invitations/accept` | by design (`index.ts:838-848`). |
| `GET /api/workspaces/:id/members` | `requireWorkspaceMember` = live membership, no snapshot, no permission (`workspaces.ts:761, 165-171`). |
| `GET /api/workspaces`, `GET /api/organizations`, `GET /api/meta` | live-membership lists (`workspaces.ts:255-268`, `organizations.ts:121-138`, `meta.ts:19-32`) — bypass token consent. |
| Inbox capture (`/api/inbox*`), mobile tokens, notification preferences, `GET/PATCH/DELETE /api/notifications`, Everhour user-connection, GitHub user-connection/repository-owners | profile-ownership only (§1.3, §1.7, §5). |
| Protocol `create` (project branch) | `protocolCreate` → `createMissionWithObjectives` with no `requirePermission` (`core/protocol.ts:2795-2834`, `missions.ts:601-700`); `buildProtocolContext` with a null permission takes the membership from `callerWorkspaceMemberships` without the snapshot (`protocol.ts:312-315`). |

### F2. Role-based gates that ignore token scopes

`actorIsAdmin` (`rbac.ts:41-52`), `isOrganizationAdmin`/`canViewOrganizationSettings` (`rbac.ts:302-357`), `requireWorkspaceAdmin`/`requireWorkspaceManager` (`workspaces.ts:173-199`) and the core `requirePermission` (`packages/core/service/storage.ts:106-118`) evaluate role grants only, so a scoped token whose owner is ADMIN/MANAGER passes organization and workspace administration routes (§1.1, §1.2). `POST /api/workspaces` additionally skips its route-level scope check for token auth because `getActorWorkspaceUserId()` is null (`index.ts:756-757`, `auth.ts:361-365`). The allowlist makes these fail closed for the preset; a follow-up should thread `tokenScopeAllows` through these helpers for all presets.

### F3. Grant passes today but the route/command must be excluded (guard-only protection)

| Surface | Passing grant | Why excluded |
| --- | --- | --- |
| `GET /api/projects/:id/run-queues`, protocol `run-queue`, `overlord_list_run_queues` | `objective:read` (`run-queue.ts:47, 471`) | run queue surface |
| `POST /api/local-target/invoke` | `project:read` (`index.ts:1620`) | dev-only local-target bridge, no resource check |
| `POST /api/inbox/:id/promote` | `mission:create` (`repository.ts:5212`) | inbox capture |
| `POST /api/missions/:id/generate-title` | `mission:read` (`repository.ts:5588`) | write behind a read gate |
| `POST /api/missions/:id/terminal-sessions/forget` | `session:read` (`latch-sessions.ts:81-83`) | session write behind a read gate |
| `GET /api/objectives/:id/prompt`, `…/launch-command`, `…/effective-launch-config` | `objective:read` (`launch.ts:1346, 1426, 1501`) | launch configuration; also authorize via live membership (`findActiveMembershipId`) rather than the snapshot |
| `GET /api/agent-requests`, `GET /api/agent-session-inputs` | `session:read` (`agent-session-routes.ts:776, 954`) | session surfaces; mission lookup via live memberships |
| protocol `prompt`, `record-work`, `overlord_record_work` | `mission:create` (`protocol.ts:1673, 1689`) | open a session / write deliveries |
| `GET /api/workspace/my-missions`, `GET /api/inbox/missions`, `GET /api/activity-feed`, `GET /api/missions/search`, `GET /api/missions/search/v2`, protocol `search-missions` v1/v2 | `mission:read` | org aggregates not needed; would each need their own project filter |
| `GET /api/workspaces/:id/projects` | `project:read` (`repository.ts:2004`) | redundant with filtered `GET /api/projects` |
| `GET /ext/github/repos` | `project:read` (`github/service.ts:368-370`) | workspace-level GitHub installation data |
| `GET /ext/everhour/projects/:projectId(/link)`, `GET /ext/everhour/missions/:missionId`, `GET /ext/github/projects/:projectId/link`, `GET /ext/github/missions/:missionId/pull-request` | `project:read` / `mission:read` | extension data, not needed; `/ext` needs the guard too |
| `GET /api/projects/:id/tags|resources|repository`, `GET /api/missions/:id/schedule|branches`, protocol `read-context`, `list-organizations`, `POST /api/missions/schedule/preview`, `GET /api/worktrees`, `GET /api/meta` | various reads | not needed now; safe to add later once the predicate exists |

### F4. Reads the automation needs whose gate is stricter than (or different from) the preset grants

Contrary to the route extraction, **none** of the needed reads require `mission:update`: `GET /api/missions/:id/events|deliveries|artifacts|context|file-changes` and `GET /api/workspace/my-missions` carry no `requires` (the extractor attributed the next route's option to them). Their real gates are `event:read`, `mission:read`, `artifact:read`, `mission:read`, `mission:read` respectively (`repository.ts:4469, 4564, 4786, 4832, 4668`) — all granted. Remaining mismatches:

| Read | Current gate | Preset grant | Action |
| --- | --- | --- | --- |
| `GET /api/workspaces/:id/project-statuses` | `workspace:read` (`repository.ts:2167`) | not granted | Not needed; use `GET /api/projects/:id/statuses` / protocol `statuses` (`project:read`). |
| `GET /api/workspaces/:id/projects` | `project:read` per workspace | granted | Not needed; use filtered `GET /api/projects`. |
| protocol `attachment-list` / `attachment-download-url` | `artifact:read` (`protocol.ts:1694-1695`) | granted (and `attachment:read` also granted) | Document that the protocol gate is `artifact:read`; the storage download uses `attachment:read` (`index.ts:1088`). |
| protocol `create` | none (null gate) | `mission:create` | Add the `mission:create` + project-allowlist gate (F1). |
| protocol `search-missions` v3 | null route gate; `mission:read` per workspace inside | granted | Add project filter. |
| `GET /api/meta` | none | n/a | Excluded; `/api/authorized-workspaces` + `auth-status` replace it. |

No new grant is required for the proposed allowlist; the nine grants cover every allowed route once the project predicate exists.

### F5. Specific leak risks inside workspace-level checks (must be fixed inside the allowlisted surface)

| Id | Location | Risk |
| --- | --- | --- |
| R1 | `backend/storage.ts:786-859` `resolveStoredObject` | Lookup by `storage_key` across all workspaces (813-818), then `requireWorkspacePermission` only (843-847). `attachments.project_id` is not selected. A guessed/known storage key in the same workspace downloads another project's attachment. Fix: select `project_id`, apply the allowlist, 404 otherwise. |
| R2 | `backend/rbac.ts:240-279` `requireMissionPermission`; `backend/objective-ref.ts:40-88` `resolveObjectiveIdForRest`; `packages/core/service/context.ts:96-150, 179-295` | UUID lookups are global or workspace-scoped, display-id lookups span the snapshot, and a display-id match in two consented workspaces returns **409 "ambiguous"** (`rbac.ts:266-268`, `objective-ref.ts:78-80`, `protocol.ts:258-260`) before any permission check — revealing existence of a mission/objective in a hidden project. Fix: apply the project predicate to the candidate set before the ambiguity test, and return 404 when zero candidates remain. |
| R3 | `backend/protocol.ts:268-277, 771-785` (`resolveProjectRefChoices` → `ProjectSelectionRequiredError`) | The `project_selection_required` response lists every matching project (id, name, workspace) across the snapshot (`protocol.ts:1743-1755`). Filter the choices to the allowlist first; a single remaining choice proceeds, zero → 404. |
| R4 | `backend/protocol.ts:203-278, 312-315` | `protocolWorkspaceId` derives the workspace from **live memberships**, and null-permission subcommands take `workspaceUserId` from `callerWorkspaceMemberships` without the snapshot. For `create` this means no consent check at all today. Fix: derive from `getResourceLookupWorkspaceIds()` (snapshot) and always run the permission gate. |
| R5 | `backend/realtime.ts:107-115, 246-255, 264-278` | Workspace-only filtering of change rows (see §4). Every entity_changes row of a hidden project in a consented workspace (mission/objective ids, changed field names) is streamed. |
| R6 | `backend/repository.ts:4425-4441` `getMissionDetail` | Once the mission is authorized the embedded sub-reads are safe, but `GET /api/missions/:id` **writes** `mission_status_seen` and a `mission` change row (`repository.ts:4347-4400`) for a read-only preset. Skip `markMissionStatusesSeen` when the actor is a token or at least for this preset. |
| R7 | `backend/repository.ts:4162-4212` (v3 search), `3996-4045` (v1), `4091-4110` (v2) | Multi-workspace fan-out computes quotas (`allocateWorkspaceSearchLimits`) and merges over all consented workspaces; a requested `projectIds` outside the allowlist is honoured today. Intersect/inject the allowlist before quota allocation and 404 out-of-scope ids. |
| R8 | `backend/repository.ts:1965-1985` `listProjects`; `1999-2016` `listProjectsForWorkspace`; `2163-2181` `listWorkspaceProjectStatuses` | Workspace-wide projections with no project predicate; `listProjects` is on the allowlist and must filter `p.id IN (…)` in SQL. |
| R9 | `backend/repository.ts:6804-6835, 6937-7030`; `backend/activity-feed.ts:190-208, 673-740`; `backend/agent-session-routes.ts:771-808` | Aggregates filtered by `workspace_id IN (…)` only (my-missions, inbox missions, activity feed, unfiltered agent-requests). Excluded from the allowlist; if ever added each needs `project_id IN (…)` before its `LIMIT`/counts. |
| R10 | `backend/execution/launch.ts:1315-1352, 1405-1432, 1475-1507`; `backend/branching/execution-target-observation-scope.ts:23-27`; `backend/execution/runner.ts:120-129, 645-673`; `backend/agent-session-routes.ts:708-717, 941-950` | Authorization via `findActiveMembershipId`/`callerWorkspaceMemberships` (live memberships) instead of the snapshot — these bypass token consent. All are excluded from the allowlist; flagged for the follow-up that threads the snapshot through. |
| R11 | `backend/ext/github/service.ts:516-525`, `backend/ext/everhour/service.ts:488-497, 528-536` | Service functions authorize only through the route wrapper; the services themselves are existence-only. Excluded. |
| R12 | `backend/http/meta.ts:24-29`, `backend/repository.ts:8246-8268` | `/api/meta` returns non-consented workspaces and a `defaultProjectId` that may be outside the allowlist. Excluded. |

## 7. Non-project `entity_changes` entity types (`project_id IS NULL` at the writer)

Derived from every `recordChange`/`insertEntityChange` call site (`backend/db.ts:818-855`, `packages/core/service/change-feed.ts:72-104`, `backend/notifications.ts:131, 162`, `backend/notification-dispatcher.ts:110`). Types whose writers **never** set `projectId`:

- `workspace` (`workspaces.ts:409, 562, 651, 700`)
- `workspace_user` (`workspaces.ts:421, 448, 573, 1187, 1435`; `organizations.ts:431`; `account-deletion.ts:140`)
- `workspace_invitation` (`workspaces.ts:1024, 1094, 1147, 1242`)
- `role_assignment` (`workspaces.ts:1365`; `organizations.ts:217`)
- `organization` (`workspaces.ts:551`; `organizations.ts:245`)
- `profile` (`repository.ts:8452`; `core/execution-targets.ts:843`)
- `user_token` (`repository.ts:8754, 8791, 8827, 8867, 8915`; `account-deletion.ts:81`) — plus `user_token_workspace` in `AUTHORIZATION_CHANGE_ENTITY_TYPES` (`realtime.ts:10-16`)
- `user_image` (`storage.ts:267`; `core/storage.ts:404, 485, 533`; `account-deletion.ts:116`)
- `workspace_image` (`storage.ts:337`; `core/storage.ts:247, 313, 347`)
- `device` (`core/devices.ts:47, 95, 145, 168`; `core/execution-targets.ts:362, 380`)
- `execution_target` (`core/execution-targets.ts:414, 448`; `core/project-execution-target.ts:1002, 1052, 1089`)
- `execution_target_runner_registration` (`core/execution-target-runners.ts:297, 344`)
- `user_execution_target_preference` (`core/execution-targets.ts:109, 746`)
- `workspace_user_execution_target` (`core/execution-targets.ts:481`)
- `webhook_subscription` (`webhooks.ts:337, 361, 384`; `250` sets `body.projectId ?? null`, so project-bound subscriptions carry a project id and workspace-wide ones are NULL)
- `github:installation` (`ext/github/service.ts:287, 314, 349`), `github:project_link` (`448, 476` — NULL despite being project-scoped), `everhour:workspace_connection` (`ext/everhour/service.ts:346`), `everhour:project_link` (`513, 573, 605, 639` — NULL despite being project-scoped)

Project-scoped types whose writers **sometimes** omit `projectId` (rows appear with NULL and would be hidden by a strict predicate; Phase 1 should backfill the writer rather than whitelist the type):

- `project` (`repository.ts:3436` initializeProject)
- `project_status` (`repository.ts:2253, 2318, 2364, 2410` — all four sites)
- `project_tag` (`repository.ts:2498, 2555, 2585` — all three)
- `project_resource` (`repository.ts:2903, 2954, 3006, 3089`)
- `mission` (`repository.ts:6184` reorderBoardColumn)
- `objective` (`repository.ts:7340, 7590, 7613`; `core/missions.ts:561, 580`)
- `agent_session` (`launch.ts:1011`), `agent_session_channel` (`core/agent-session/channels.ts:196, 373`), `change_rationale` (`core/protocol.ts:2310`)
- `attachment` (`core/storage.ts:592, 675, 719` use `?? null`)

Types that always carry `projectId`: `artifact`, `delivery`, `mission_event`, `execution_request`, `changed_file`, `shared_context_entry`, `human_action_resolution`, `agent_request`, `agent_session_event`, `agent_session_input`, `notification` (via `existing.project_id`, may still be NULL when the mission row lacks one).

Recommendation for §4.3: the preset's realtime predicate should be `project_id IN (allowlist)`; **no** `project_id IS NULL` type is required by the automation, so the audited non-project list may start empty. If `project_status`/`project_tag`/`project_resource` invalidations are wanted, fix their writers (above) instead of exposing NULL rows.

## 8. Proposed allowlist for `project_automation` (final, as published in CONTRACT.md Version 151)

The contract publishes the list below. It adopts every exclusion from the findings above and adds one project-bound read the audit marked "safe to add later": `GET /api/projects/:id/tags`, because `MissionDto.tags` and `CreateMissionBody.tagIds` are part of the mission surface an automation reads and writes, and the route already resolves through `requireProjectPermission`.

```text
REST (everything else under /api, /ext, /sync, /realtime → 404 before any handler)
GET  /api/authorized-workspaces
GET  /api/projects                          (filter p.id IN allowlist before projection)
GET  /api/projects/:id
GET  /api/projects/:id/statuses
GET  /api/projects/:id/tags
GET  /api/projects/:id/missions
POST /api/missions                          (mission:create in a selected project; unassigned when assignedWorkspaceUserId omitted)
GET  /api/missions/:id                      (skip markMissionStatusesSeen for this preset)
GET  /api/missions/:id/objectives
GET  /api/missions/:id/events
GET  /api/missions/:id/deliveries
GET  /api/missions/:id/artifacts
GET  /api/missions/:id/context
GET  /api/missions/:id/file-changes
GET  /api/search/v3                         (workspace fan-out and projectIds intersected with the allowlist before quotas/totals)
GET  /api/objectives/:id/attachments
GET  /api/storage/attachments/:storageKey   (attachments bucket only; resolve project via objective → mission before the workspace check)
GET  /api/stream, GET /realtime, GET /sync/changes   (project predicate on every row; no project_id IS NULL rows)
GET  /mcp, POST /mcp                        (tool calls dispatch to the protocol subcommands below)
POST /api/protocol/:subcommand              (only the subcommands below)

Protocol subcommands
auth-status
discover-project           (--project-id form only; cwd form and project_selection_required lists are denied)
statuses
search-missions / search
create                     (--project-id in the allowlist; --unassigned-to-project / --inbox → denied before any write)
load-context
list-deliveries
attachment-list
attachment-download-url

Hosted MCP tools (same outcome as their subcommand)
overlord_resolve_project, overlord_list_project_statuses, overlord_search_missions,
overlord_create_mission (unassignedToProject rejected), overlord_load_mission_context, overlord_list_deliveries
```

Explicitly excluded even though the grant passes today: run-queue reads, `record-work`, `prompt`, `read-context`, `list-organizations`, `generate-title`, `terminal-sessions/forget`, objective prompt/launch-command/effective-launch-config, `GET /api/agent-requests` and `GET /api/agent-session-inputs`, My Missions, inbox missions, activity feed, search v1/v2, `GET /api/meta`, `GET /api/workspaces/:id/projects`, project resources/repository, mission schedule/branches, and every `/ext/*` route. Any of these may be added later only once the project predicate is applied inside it. The audited list of `project_id IS NULL` entity-change types this preset may receive starts empty (see §7); fix the NULL-writing project-scoped call sites instead of admitting them.
