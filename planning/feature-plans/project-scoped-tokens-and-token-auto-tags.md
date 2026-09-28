# Project Automation Tokens and Mission Attribution (coo:1093)

**Mission:** `coo:1093`  
**Status:** revised plan; no feature code implemented  
**Contract impact:** use the next available version when implementation starts. Version `150` is already assigned to coo:1098.  
**Components:** database, auth, core service, shared contract, REST backend, CLI, webapp. Protocol and hosted MCP keep their command/tool schemas; their authorization behavior changes for the new token preset.

## 1. Product goal and boundary

A user can create a token for an external automation, give it a meaningful label such as `Clear Comply feedback importer`, and select one or more Overlord projects. The automation can read the selected projects and create missions in them, including the initial objective instructions. Each mission it creates identifies the token that created it and shows the token's label, so the user can tell which automation filed it.

The existing `full` and `mission_lifecycle` token options, their grants, and their issuance behavior remain unchanged. OAuth approval continues to issue the same `mission_lifecycle` token with the same workspace consent flow. No OAuth project picker is part of this feature.

The new token does not edit existing missions or objectives, add objectives to an existing mission, launch or attach agents, create inbox items, create projects, manage tokens, or administer a workspace. It cannot read another project merely because that project shares a workspace with an allowed one.

This feature does not create project tags or objective tags. `user_tokens.label` already names the automation; mission creator provenance is the product surface for that name. Explicit tags and objective creator attribution can be considered separately if a later use case needs them.

## 2. Decisions

| Question | Decision |
| --- | --- |
| Token option | Add `project_automation` alongside `full` and `mission_lifecycle`. Only this new option accepts project selection. |
| Project selection | Require a nonempty list of project IDs at issuance. There is no "all projects" setting for this preset. Project selection and the preset are immutable; mint a new token to change either. |
| Read rights | Grant project-bound reads needed to inspect the project's missions, objectives, events, sessions, deliveries, artifacts, attachments, and execution requests. Every such read must enforce the project allowlist. Do not grant workspace-wide settings or account/admin reads merely to make a project read work. |
| Write rights | Grant `mission:create` for allowed projects. Initial objectives inserted atomically with a new mission are part of that create operation. No standalone `objective:create` permission or `objective:update` grant is needed. |
| Protocol behavior | Allow `create` with an allowed project. Deny `create --unassigned-to-project`, `prompt`, `record-work`, `add-objectives`, and session/launch commands for `project_automation`. Reject a disallowed command before it creates any rows. Existing presets retain their current behavior. |
| Attribution | Stamp the creating token ID and a snapshot of its label on a mission created by a direct `out_` bearer request. Expose the creator token label in the mission API and UI. A later token rename changes future snapshots, not past missions. |
| OAuth | No changes to OAuth token issuance, consent, or grants. OAuth tokens do not acquire the project allowlist. |

### Why a dedicated allowlist

`user_token_scopes.resource_type` and `resource_id` exist but the current authorizer evaluates permission names without resources. A `user_token_projects` table lets the new preset retain a simple grant list while recording the exact projects the user selected. Unlike the earlier proposal, no `all_projects` flag is needed: the allowlist applies only when `scope = project_automation`; existing presets remain unrestricted by this new dimension and continue to use their existing workspace consent rules.

The token's effective access is the intersection of its stored grants, the issuing user's **current** role permissions and membership, workspace consent, and the selected project IDs. Validate the user's ability to read and create in every selected project at issuance, then recheck live access on every request. If an allowed project is deleted or access is lost, the token loses access; an empty remaining allowlist never widens it.

## 3. Data and identity

```text
user_tokens
  scope                         full | mission_lifecycle | project_automation
  label                         existing editable display label

user_token_projects
  token_id, project_id, created_at
  unique(token_id, project_id)

missions
  created_by_token_id           nullable token ID; soft reference
  created_by_token_label        nullable label snapshot
```

Persist `scope` explicitly so the three presets remain distinguishable if their grant lists evolve. Backfill legacy tokens as `full` when they have no scope rows and `mission_lifecycle` when they have the existing scoped grants; verify that assumption against existing data before migration. `user_token_projects` must keep project and token within the same organization and workspace consent boundary, with equivalent SQLite and Postgres enforcement. A hard-deleted project removes its allowlist row; no replacement project is inferred.

The mission creator fields are written server-side in `createMissionWithObjectives` from the authenticated service context. Never accept a creator-token ID or label from the mission-create request. The ID is useful for audit and possible filtering; the label snapshot remains readable after token rename, revoke, or soft-delete. Avoid a foreign key that would erase or block mission history when a token is deleted. Apply the existing account-deletion policy to the snapshot so account erasure does not leave identifying label text behind.

Stamp direct token-authenticated mission creations, including REST, protocol `create`, and hosted MCP (which dispatches through protocol). A later `sess_` call does not inherit the original bearer token's identity; this preset cannot open a session anyway. Scheduled duplicates and other system-generated missions have their own creator provenance and must not copy the source mission's token ID or label. Existing `created_by_kind` and agent/session origin fields remain unchanged; the new fields answer the specific token-attribution question.

## 4. Authorization design

### 4.1 Preset grants

Define `PROJECT_AUTOMATION_GRANTS` in `auth/src/rbac/permissions.ts` from the audited project read surface. The intended maximum is:

```text
project:read
mission:read
mission:create
objective:read
event:read
session:read
artifact:read
attachment:read
execution_request:read
```

Include a read grant only after checking its routes can return project-bound data without workspace leakage. If a route currently needs `workspace:read`, `launch:read`, or another broad grant to return project data, add a project-bound authorization path rather than granting the automation access to unrelated workspace state. No update, delete, `project:create`, `objective:update`, `session:attach`, `event:create`, `execution_request:create`, `user_token:self:*`, or administration grants are included. The user's own roles can narrow these maximum grants.

### 4.2 One project-boundary rule across surfaces

At authentication, load the selected project IDs for `project_automation` into the immutable request authorization snapshot and copy them into the service context. An absent restriction means an existing preset or non-token session; an **empty** list means the automation token has no project access. Clear this context when switching away from token authentication.

Create one reusable project-scope check used by `requireProjectPermission`, `requireMissionPermission`, objective resolvers, and resource-specific reads. Unauthorized project, mission, objective, attachment, or other project-bearing IDs return `404` without revealing existence. The check must apply to UUID and display-ID lookup and run before ambiguity or detail responses can reveal another project. Authorization for a mission creation must check its target project and `mission:create`, including protocol `create`, whose current permission map uses a null gate. The inbox branch of that command is explicitly denied to the new preset.

The implementation audit must include direct workspace-level checks and raw SQL projections, not just callers of the project and mission helpers. In particular:

- Objective resolution in `packages/core/service/context.ts` and `backend/objective-ref.ts`, including REST by UUID/display ID.
- Objective attachment list/download and `/api/storage/attachments/:storageKey` in `backend/storage.ts`, where a known storage key currently reaches a workspace-level check.
- Mission-scoped and account-wide agent requests/session inputs in `backend/agent-session-routes.ts`.
- Project/mission REST detail routes, run queues, launch/read settings, deliveries, extension routes, and any read using `requireWorkspacePermission` or `actorCan` directly.
- Project, My Missions, Inbox missions, search, activity feed, protocol search/discovery, and other account-wide lists. Filter before pagination and totals so hidden projects do not influence counts or page contents. The retired Human Actions feed is not part of this inventory.
- Projectless surfaces such as inbox capture and workspace/account settings. Deny them unless a separate permission and resource rule genuinely permits them.

### 4.3 Realtime and revocation

Apply the same project predicate to `/sync/changes`, SSE catch-up, and **live** SSE broadcast from `/api/stream` and `/realtime`. `RealtimeHub` currently stores workspace IDs per client; it must also retain the project's allowlist and use it in `broadcastChanges`. Do not expose all `project_id IS NULL` rows: allow only individually audited non-project entity types that the preset may read. Reconnect streams when token authorization changes, and build a fresh snapshot on reconnect. Token revoke and label change must preserve normal token lifecycle behavior.

## 5. API and product surfaces

### REST and shared DTOs

- `CreateUserTokenBody`: add `projectIds?: string[]`; require at least one unique, valid ID when `scope = project_automation`, and reject `projectIds` for existing presets. Keep `label` and expiry behavior unchanged.
- `UserTokenDto`: add the selected projects with IDs and display names (or an empty list for an automation token whose projects were deleted); add `project_automation` to `TokenScope`. Keep existing token rows compatible.
- `MissionDto`: add nullable, read-only creator-token attribution (token ID and label snapshot, with a stable shape defined in the contract). Do not expose the token secret. Other mission DTO fields, `MissionDto.tags`, and `ObjectiveDto` stay unchanged.
- `POST /api/missions`: allow the new preset to create a mission and its initial objectives in a selected project. `POST /api/objectives` and existing-mission edits remain denied.

### CLI and settings

```text
ovld user-token create --label "Clear Comply feedback importer" \
  --scope project-automation --project <id-or-name> [--project <id-or-name> ...]
```

Resolve a project name only when it identifies one authorized project; ask for an ID when ambiguous. `ovld user-token list` and the settings token row show the preset and selected project names. The settings create form requires one or more selected projects for this preset. The existing token rename action changes the token label for future mission attribution; it does not rewrite historical snapshots. Mission detail and appropriate mission list cards show the creator label with a clear “Created via token” caption. No auto-tag input or token update command is added.

### OAuth and MCP

`backend/oauth.ts` and `OAuthApprovePage.tsx` retain their current consent and token preset behavior. Hosted MCP needs no new tool input schema: its mission-create tool uses the existing protocol create path. Its error handling and documentation must make clear that `project_automation` tokens can create missions only in selected projects and cannot use prompt/session tools.

## 6. Contract work before implementation

1. Read the current version in `CONTRACT.md` and `contract/components.yaml` when Phase 0 begins; increment to the next free version rather than reusing `150`. Add a change summary covering the new preset, required project allowlist, per-project read/creation rules, mission creator attribution, and OAuth compatibility.
2. Update `contract/components.yaml`, the relevant Auth/Core/REST interaction descriptions, and `database/docs/09-database-schema-contract.md` for `user_tokens.scope`, `user_token_projects`, and the two mission provenance columns.
3. Update `packages/contract` DTOs and auth documentation with exact validation, 404/403 behavior, and the meaning of a token label snapshot. Document that protocol `create` checks `mission:create` on its target and that the new preset cannot `prompt` or `record-work`.
4. Recheck conformance manifests and `contract/protocol-commands.yaml` against the changed permission behavior. No new protocol flag or MCP tool field is expected. Run `ovld contract check` before component implementation.

Contract impact by component: database stores the allowlist and provenance; auth resolves the token preset and grants; core carries project-bound context and stamps mission origin; REST/protocol/MCP enforce access on every route; CLI and webapp expose issuance and attribution. Desktop, runner, and mobile retain their existing behavior and need only additive DTO compatibility where they decode missions.

## 7. Implementation phases

### Phase 0 — Contract and inventory

- Make the contract and schema changes in §6 first.
- Inventory every route and service read available through the proposed grants. Classify each as project-bound, explicitly projectless and denied, or safe non-project metadata. Record that inventory in the implementation review so omissions are visible.

### Phase 1 — Token issuance and authorization

- Add matching SQLite and Postgres migrations for persisted preset and `user_token_projects`, plus Kysely type generation. Backfill and verify legacy token classifications. Enforce same-organization and workspace-consent consistency.
- Extend token creation, validation, listing, CLI and settings UI. Require nonempty project selection only for the new preset; keep existing token and OAuth paths unchanged.
- Load the allowlist into request/service contexts. Apply the project boundary to all direct and aggregate reads in §4.2, including storage-key access and agent requests. Fix protocol `create` to check `mission:create` for a target project and deny projectless creation. Deny `prompt` and `record-work` for this preset before any write.
- Filter sync, SSE catch-up, and live SSE; refresh authorization snapshots on reconnect.

### Phase 2 — Mission creator attribution

- Add `missions.created_by_token_id` and `missions.created_by_token_label` in both database adapters and generated types. Stamp them in `createMissionWithObjectives` for direct token-authenticated creates.
- Add the read-only MissionDto projection and creator label in mission detail/list UI. Keep token rename, revoke, delete, account deletion, and scheduled-copy behavior consistent with §3.
- Document token-based mission creation and attribution for automations.

### Phase 3 — End-to-end verification

- With project P selected and project Q in the **same workspace**, verify the token can read P's project, missions, objectives, events, sessions, deliveries, artifacts, attachments, and change feed, and create a mission with initial objectives in P through REST, protocol, CLI client, and hosted MCP.
- Verify Q is absent from lists, search, pagination/totals, sync, SSE catch-up, and live SSE. Known Q IDs, display IDs, attachment storage keys, and agent request IDs return 404. A second workspace also remains inaccessible unless a selected project is there.
- Verify `prompt`, `record-work`, standalone objective creation, edits, inbox capture, launches, session attachment, project creation, token management, and workspace administration are denied without partial writes.
- Verify the created mission records the right token ID and label snapshot, token rename affects only later missions, revoked/soft-deleted tokens leave readable attribution, scheduled copies do not claim the original token, and existing `full`, `mission_lifecycle`, and OAuth flows pass regression tests.
- Run both SQLite and Postgres tests for allowlist constraints and the relevant contract/conformance checks.

## 8. Acceptance criteria

1. A user can create a `project_automation` token only with at least one selected project; existing token presets and OAuth behave as before.
2. The token can read project-bound data and create a mission with initial objectives in selected projects, subject to the user's live role permissions. It cannot view another project in the same workspace through any API, protocol/MCP tool, storage key, aggregate query, sync result, or SSE event.
3. The token cannot change existing work or start agent execution. Disallowed creation commands fail before inserting a mission.
4. Every directly token-created mission exposes the creating token's ID and label at creation; the label remains stable on that mission after token rename, revoke, or soft-delete.
5. The next available contract version documents the feature before implementation, and contract and database conformance checks pass on both editions.

## 9. Second-review amendments (2026-09-28)

The second review confirmed the plan matches the product goal. These amendments apply on top of §1–§8 and change no table or DTO shape already described.

1. **Default-deny route allowlist for `project_automation`.** When a request is authenticated by this preset, the `/api` guard checks an explicit allowlist of route patterns (project detail and statuses, project missions list, mission detail, objectives, events, sessions, deliveries, artifacts, attachments, search, sync and stream, protocol `create`, `load-context`, `search-missions`, `discover-project`, hosted MCP). Any other route returns 404 before a handler runs. The per-route project predicate in §4.2 still applies inside the allowlist; the allowlist makes audit omissions fail closed. Publish the allowlist in the contract.
2. **Workspace consent derived from selected projects.** At issuance, write `user_token_workspaces` rows for exactly the workspaces that own the selected projects and leave `all_workspaces` false, instead of the self-issued default of all organization workspaces. Existing consent enforcement then hides every other workspace, and the project predicate only separates projects inside consented workspaces.
3. **Creation semantics.** For this preset a mission with no `assignedWorkspaceUserId` in the body is created unassigned rather than assigned to the token owner. `created_by_kind` keeps its existing user value; the label snapshot is the "Created via token" display. `statusId` stays optional with the project default. The settings form and CLI surface the expiry choice prominently for this preset and document `--no-expiry`, since a silently expiring automation token breaks the integration.
4. **Webhooks excluded.** The preset has no `webhook:*` grants and cannot create or manage subscriptions; the user creates subscriptions from the web app as today. The dispatcher's owner-permission check is unchanged.
5. **Duplicate protection deferred.** An idempotency key or external reference on mission create (unique per project and token) is a separate follow-up mission. Until then automations read before creating, and may use objective `resourceKey` as an external reference.
