import {
  defaultAuthorizer,
  makeActor,
  type Permission,
  Role,
  type Role as RoleType,
  tokenScopeAllows
} from '@overlord/auth';
import { type DatabaseClient } from '@overlord/database';

import { projectAllowed } from '../packages/core/service/context.ts';

import {
  findActiveMembershipId,
  getActiveTokenId,
  getActiveTokenProjectIds,
  getActiveTokenScopes,
  getAuthorizedWorkspace,
  getAuthorizedWorkspacesContext,
  getImplicitWorkspaceIdOrNull,
  getResourceLookupWorkspaceIds,
  requireDatabaseClient,
  resolveActiveProfileId,
  setResolvedWorkspaceId,
  type WorkspaceActorScope
} from './db.ts';
import { ApiError } from './errors.ts';
import { resolveObjectiveIdForRest } from './objective-ref.ts';

export async function loadActorRoles({
  workspaceId,
  workspaceUserId
}: {
  workspaceId: string;
  workspaceUserId?: string | null;
}): Promise<RoleType[]> {
  if (!workspaceUserId) return [];
  const rows = await requireDatabaseClient().all<{ role_key: string }>(
    `SELECT role_key FROM role_assignments
       WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [workspaceId, workspaceUserId]
  );
  return rows.map(row => row.role_key as RoleType);
}

export async function actorIsAdmin({
  workspaceId,
  workspaceUserId
}: {
  workspaceId: string;
  workspaceUserId?: string | null;
}): Promise<boolean> {
  const roles = await loadActorRoles({ workspaceId, workspaceUserId });
  if (roles.length === 0) return false;
  const actor = makeActor(workspaceUserId ?? 'anonymous', roles);
  return defaultAuthorizer.can(actor, '*').allowed || roles.includes(Role.ADMIN);
}

/**
 * Whether the current request's actor may perform `action`. The decision is the
 * actor's role grants **intersected with** the authenticating token's scope
 * (`getActiveTokenScopes()`): a session or loopback-trusted operator has `null`
 * scopes (role grants only), while a scoped `USER_TOKEN` is further restricted to
 * its grant patterns. Returns `true`/`false`; callers needing a hard gate use
 * `requirePermission`.
 */
export async function actorCan(
  action: Permission,
  {
    workspaceId,
    workspaceUserId,
    tokenScopes = getActiveTokenScopes()
  }: {
    workspaceId: string;
    workspaceUserId?: string | null;
    tokenScopes?: string[] | null;
  }
): Promise<boolean> {
  if (!workspaceUserId) return false;
  const authorizedWorkspace = getAuthorizedWorkspace(workspaceId);
  // Auth has already loaded roles for an authenticated request. Re-querying
  // membership/roles here would let individual services reinterpret a snapshot
  // that must remain immutable for the request.
  if (
    getAuthorizedWorkspacesContext() &&
    authorizedWorkspace?.workspaceUserId !== workspaceUserId
  ) {
    return false;
  }
  const roles = authorizedWorkspace
    ? (authorizedWorkspace.roleKeys as RoleType[])
    : await loadActorRoles({ workspaceId, workspaceUserId });
  if (roles.length === 0) return false;
  const actor = makeActor(workspaceUserId, roles);
  return defaultAuthorizer.can(actor, action).allowed && tokenScopeAllows(tokenScopes, action);
}

/**
 * Hard RBAC gate for a route/handler. Throws `ApiError(403)` when the current
 * actor (resolved from the request's auth method) cannot perform `action`,
 * accounting for both role grants and any token scope restriction.
 */
export async function requirePermission(
  action: Permission,
  scope: { workspaceId: string; workspaceUserId?: string | null }
): Promise<void> {
  if (!(await actorCan(action, scope))) {
    throw new ApiError(403, `Permission denied: ${action}`);
  }
}

/**
 * Per-target-workspace gate (coo:96/coo:135 pattern): the caller must be an
 * active member of `workspaceId` — independent of which workspace is currently
 * active — and hold `permission` there. Returns the caller's membership id in
 * that workspace. Non-membership reads as `notFoundMessage` (404) so foreign
 * workspace/resource ids don't leak existence; permission denial inside a real
 * membership is an honest 403 (`deniedMessage` when given).
 *
 * `permission` may be a list, in which case holding any one of them suffices.
 */
export async function requireWorkspacePermission({
  workspaceId,
  permission,
  db = requireDatabaseClient(),
  notFoundMessage = 'Workspace not found',
  deniedMessage
}: {
  workspaceId: string;
  permission: Permission | readonly Permission[];
  db?: DatabaseClient;
  notFoundMessage?: string;
  deniedMessage?: string;
}): Promise<string> {
  const permissions: readonly Permission[] =
    typeof permission === 'string' ? [permission] : permission;
  const denied = () =>
    new ApiError(403, deniedMessage ?? `Permission denied: ${permissions.join(' | ')}`);
  const canAny = async (workspaceUserId: string): Promise<boolean> => {
    for (const candidate of permissions) {
      if (await actorCan(candidate, { workspaceId, workspaceUserId })) return true;
    }
    return false;
  };

  const authorized = getAuthorizedWorkspace(workspaceId);
  if (getAuthorizedWorkspacesContext()) {
    if (!authorized) throw new ApiError(404, notFoundMessage);
    if (!(await canAny(authorized.workspaceUserId))) throw denied();
    setResolvedWorkspaceId(workspaceId);
    return authorized.workspaceUserId;
  }
  const profileId = await resolveActiveProfileId(db);
  if (!profileId) throw new ApiError(401, 'Authentication required');
  const membershipId = await findActiveMembershipId(workspaceId, profileId, db);
  if (!membershipId) throw new ApiError(404, notFoundMessage);
  if (!(await canAny(membershipId))) throw denied();
  setResolvedWorkspaceId(workspaceId);
  return membershipId;
}

/**
 * Resolves an objective to its owning workspace and checks permission there
 * (coo:135). UUIDs are globally unique and unscoped by the caller's active
 * workspace; display ids (`coo:756.k7xm`) resolve in the active workspace.
 * Non-membership reads as 404 'Objective not found'; a member lacking
 * `permission` gets 403. Pass `db: tx` to run inside a transaction.
 */
export async function requireObjectivePermission({
  objectiveId,
  permission,
  db = requireDatabaseClient()
}: {
  objectiveId: string;
  permission: Permission;
  db?: DatabaseClient;
}): Promise<{ workspaceId: string; workspaceUserId: string; objectiveId: string }> {
  const resolved = await resolveObjectiveIdForRest({ ref: objectiveId, db });
  const workspaceUserId = await requireWorkspacePermission({
    workspaceId: resolved.workspaceId,
    permission,
    db,
    notFoundMessage: 'Objective not found'
  });
  return {
    workspaceId: resolved.workspaceId,
    workspaceUserId,
    objectiveId: resolved.id
  };
}

export type AuthorizedWorkspaceScope = WorkspaceActorScope & { workspaceUserId: string };

/**
 * Gate an account-owned or organization-aggregate operation without inventing
 * an ambient workspace. Authorization succeeds when at least one entry in the
 * immutable organization snapshot grants the permission. The returned scope is
 * deterministic and may be used only for audit attribution, never to narrow an
 * aggregate read.
 */
export async function requireAnyWorkspacePermission(
  permission: Permission
): Promise<AuthorizedWorkspaceScope> {
  const authorized = getAuthorizedWorkspacesContext();
  if (authorized) {
    const candidates = [...authorized.workspaces].sort((a, b) =>
      a.workspaceId.localeCompare(b.workspaceId)
    );
    for (const candidate of candidates) {
      if (
        await actorCan(permission, {
          workspaceId: candidate.workspaceId,
          workspaceUserId: candidate.workspaceUserId
        })
      ) {
        return {
          workspaceId: candidate.workspaceId,
          workspaceUserId: candidate.workspaceUserId
        };
      }
    }
    throw new ApiError(403, `Permission denied: ${permission}`);
  }

  // Bootstrap/direct-service tests and the loopback local operator do not have
  // an authenticated request snapshot. Preserve that non-HTTP compatibility
  // path without allowing it to participate in Cloud request scoping. Prefer
  // the per-request active workspace (e.g. after onboarding switched this
  // request) and fall back to the process default only when they still agree.
  const workspaceId = getImplicitWorkspaceIdOrNull();
  const profileId = await resolveActiveProfileId();
  const workspaceUserId =
    workspaceId && profileId ? await findActiveMembershipId(workspaceId, profileId) : null;
  if (
    !workspaceId ||
    !workspaceUserId ||
    !(await actorCan(permission, { workspaceId, workspaceUserId }))
  ) {
    throw new ApiError(403, `Permission denied: ${permission}`);
  }
  return { workspaceId, workspaceUserId };
}

/**
 * Bound a `USER_TOKEN` request on an operation whose role requirement is
 * derived from membership (workspace member, manager or admin) rather than a
 * single role grant. The token's authorization snapshot (organization binding
 * and workspace consent) must contain `workspaceId` — otherwise the workspace
 * reads as `notFoundMessage` — and its scope must cover `permission` (403).
 * The caller still applies its own membership/role check; sessions and the
 * loopback local operator carry no token and are unaffected.
 */
export function requireTokenWorkspaceGrant({
  workspaceId,
  permission,
  notFoundMessage
}: {
  workspaceId: string;
  permission: Permission;
  notFoundMessage: string;
}): void {
  if (getActiveTokenId() === null) return;
  if (getAuthorizedWorkspacesContext() && !getAuthorizedWorkspace(workspaceId)) {
    throw new ApiError(404, notFoundMessage);
  }
  if (!tokenScopeAllows(getActiveTokenScopes(), permission)) {
    throw new ApiError(403, `Permission denied: ${permission}`);
  }
}

/**
 * The organization-level counterpart of {@link requireTokenWorkspaceGrant}. A
 * token request must be bound to `organizationId` (otherwise 404
 * `Organization not found`) and its scope must cover `permission`. With
 * `everyWorkspace`, the token must also consent to every live workspace of the
 * organization, because organization administration acts on all of them.
 */
export async function requireTokenOrganizationGrant({
  organizationId,
  permission,
  everyWorkspace,
  client = requireDatabaseClient()
}: {
  organizationId: string;
  permission: Permission;
  everyWorkspace: boolean;
  client?: DatabaseClient;
}): Promise<void> {
  if (getActiveTokenId() === null) return;
  const snapshot = getAuthorizedWorkspacesContext();
  if (snapshot && snapshot.organizationId !== organizationId) {
    throw new ApiError(404, 'Organization not found');
  }
  if (!tokenScopeAllows(getActiveTokenScopes(), permission)) {
    throw new ApiError(403, `Permission denied: ${permission}`);
  }
  if (everyWorkspace && snapshot) {
    for (const workspaceId of await liveOrganizationWorkspaceIds(organizationId, client)) {
      if (!getAuthorizedWorkspace(workspaceId)) {
        throw new ApiError(403, 'Organization admin required');
      }
    }
  }
}

/**
 * Whether a token request's snapshot admits `workspaceId`. Lists use this to
 * narrow to the token's organization and consented workspaces, as
 * `GET /api/authorized-workspaces` does; sessions and loopback are unaffected.
 */
export function tokenSnapshotAdmitsWorkspace(workspaceId: string): boolean {
  if (getActiveTokenId() === null) return true;
  const snapshot = getAuthorizedWorkspacesContext();
  return !snapshot || getAuthorizedWorkspace(workspaceId) !== null;
}

/** Organization counterpart of {@link tokenSnapshotAdmitsWorkspace}. */
export function tokenSnapshotAdmitsOrganization(organizationId: string): boolean {
  if (getActiveTokenId() === null) return true;
  const snapshot = getAuthorizedWorkspacesContext();
  return !snapshot || snapshot.organizationId === organizationId;
}

/** Resolve and authorize a workspace together with the caller membership that belongs to it. */
export async function requireWorkspaceScope(args: {
  workspaceId: string;
  permission: Permission;
  db?: DatabaseClient;
  notFoundMessage?: string;
}): Promise<AuthorizedWorkspaceScope> {
  const workspaceUserId = await requireWorkspacePermission(args);
  return { workspaceId: args.workspaceId, workspaceUserId };
}

/**
 * Resolves a project to its owning workspace and checks `permission` there via
 * `requireWorkspacePermission`, so a project in a secondary workspace resolves
 * even when a different workspace is active (coo:135).
 */
export async function requireProjectPermission({
  projectId,
  permission,
  db = requireDatabaseClient()
}: {
  projectId: string;
  permission: Permission;
  db?: DatabaseClient;
}): Promise<AuthorizedWorkspaceScope> {
  const project = (await db.get(
    `SELECT workspace_id FROM projects WHERE id = ? AND deleted_at IS NULL`,
    [projectId]
  )) as { workspace_id: string } | undefined;
  if (!project) throw new ApiError(404, 'Project not found');
  if (!projectAllowed(projectId, getActiveTokenProjectIds()))
    throw new ApiError(404, 'Project not found');
  return requireWorkspaceScope({
    workspaceId: project.workspace_id,
    permission,
    db,
    notFoundMessage: 'Project not found'
  });
}

/** Resolve a mission's owning workspace and authorize it there, independent of
 * the caller's active workspace. */
export async function requireMissionPermission({
  missionRef,
  permission,
  db = requireDatabaseClient()
}: {
  missionRef: string;
  permission: Permission;
  db?: DatabaseClient;
}): Promise<AuthorizedWorkspaceScope & { missionId: string }> {
  const mission = (await db.get(
    `SELECT id, workspace_id, project_id FROM missions WHERE id = ? AND deleted_at IS NULL`,
    [missionRef]
  )) as { id: string; workspace_id: string; project_id: string } | undefined;
  let resolved = mission;
  if (!resolved) {
    const workspaceIds = await getResourceLookupWorkspaceIds(db);
    if (workspaceIds.length === 0) {
      throw new ApiError(404, 'Mission not found');
    }
    const rows = await db.all<{ id: string; workspace_id: string; project_id: string }>(
      `SELECT id, workspace_id, project_id FROM missions
        WHERE display_id = ?
          AND workspace_id IN (${workspaceIds.map(() => '?').join(', ')})
          AND deleted_at IS NULL`,
      [missionRef, ...workspaceIds]
    );
    const visibleRows = rows.filter(row =>
      projectAllowed(row.project_id, getActiveTokenProjectIds())
    );
    if (visibleRows.length > 1) {
      throw new ApiError(409, `Mission reference is ambiguous in this organization: ${missionRef}`);
    }
    resolved = visibleRows[0];
  }
  if (!resolved) throw new ApiError(404, 'Mission not found');
  if (!projectAllowed(resolved.project_id, getActiveTokenProjectIds()))
    throw new ApiError(404, 'Mission not found');
  const scope = await requireWorkspaceScope({
    workspaceId: resolved.workspace_id,
    permission,
    db,
    notFoundMessage: 'Mission not found'
  });
  return { ...scope, missionId: resolved.id };
}

// ---- Organization admin (derived, not a stored role) ----------------------
//
// "Organization admin" has no row of its own: it is ADMIN of every live
// constituent workspace of the organization (Q2 in
// planning/feature-plans/organization-workspace-hierarchy.md). Any workspace
// admin may *view* org settings; only a full org admin may mutate them —
// otherwise a single-workspace ADMIN could add themselves as org admin and
// escalate to every workspace in the org (R1).

/** Ids of an organization's live (non-deleted) constituent workspaces. */
export async function liveOrganizationWorkspaceIds(
  organizationId: string,
  client: DatabaseClient
): Promise<string[]> {
  const rows = await client.all<{ id: string }>(
    `SELECT id FROM workspaces WHERE organization_id = ? AND deleted_at IS NULL`,
    [organizationId]
  );
  return rows.map(row => row.id);
}

async function profileIsWorkspaceAdmin(
  profileId: string,
  workspaceId: string,
  client: DatabaseClient
): Promise<boolean> {
  const row = await client.get<{ id: string }>(
    `SELECT ra.id
       FROM workspace_users wu
       JOIN role_assignments ra
         ON ra.workspace_id = wu.workspace_id AND ra.workspace_user_id = wu.id
        AND ra.role_key = 'ADMIN' AND ra.deleted_at IS NULL
      WHERE wu.workspace_id = ? AND wu.profile_id = ?
        AND wu.status = 'active' AND wu.deleted_at IS NULL
      LIMIT 1`,
    [workspaceId, profileId]
  );
  return !!row;
}

/**
 * Whether `profileId` is an "organization admin" of `organizationId`: an
 * active `ADMIN` role assignment in **every** live constituent workspace.
 * `false` for an organization with zero live workspaces (it should already be
 * gone — see `deleteOrganizationIfEmpty`).
 */
export async function isOrganizationAdmin(
  profileId: string,
  organizationId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<boolean> {
  const workspaceIds = await liveOrganizationWorkspaceIds(organizationId, client);
  if (workspaceIds.length === 0) return false;
  for (const workspaceId of workspaceIds) {
    if (!(await profileIsWorkspaceAdmin(profileId, workspaceId, client))) return false;
  }
  return true;
}

/**
 * Whether `profileId` may *view* `organizationId`'s settings: an active
 * `ADMIN` role assignment in at least one live constituent workspace. Viewing
 * is intentionally broader than mutating (`isOrganizationAdmin`) so a
 * partial-admin state (an artifact of a bug, or an org mid-repair) is still
 * visible to someone who can help fix it.
 */
export async function canViewOrganizationSettings(
  profileId: string,
  organizationId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<boolean> {
  const workspaceIds = await liveOrganizationWorkspaceIds(organizationId, client);
  for (const workspaceId of workspaceIds) {
    if (await profileIsWorkspaceAdmin(profileId, workspaceId, client)) return true;
  }
  return false;
}

/**
 * The full set of "organization admins" of `organizationId`: profile ids with
 * an active `ADMIN` role assignment in **every** live constituent workspace.
 * Shared by `backend/organizations.ts` (listing/adding/removing org admins)
 * and `backend/workspaces.ts` (auto-granting `ADMIN` to every current org
 * admin when a new workspace is created under the org, Q3) so both stay
 * derived from the same invariant instead of drifting.
 */
export async function listOrganizationAdminProfileIds(
  organizationId: string,
  client: DatabaseClient = requireDatabaseClient()
): Promise<string[]> {
  const rows = await client.all<{ profile_id: string }>(
    `SELECT wu.profile_id
       FROM workspace_users wu
       JOIN role_assignments ra
         ON ra.workspace_id = wu.workspace_id AND ra.workspace_user_id = wu.id
        AND ra.role_key = 'ADMIN' AND ra.deleted_at IS NULL
       JOIN workspaces w ON w.id = wu.workspace_id AND w.deleted_at IS NULL
      WHERE w.organization_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
      GROUP BY wu.profile_id
     HAVING COUNT(DISTINCT wu.workspace_id) = (
       SELECT COUNT(*) FROM workspaces WHERE organization_id = ? AND deleted_at IS NULL
     )`,
    [organizationId, organizationId]
  );
  return rows.map(row => row.profile_id);
}
