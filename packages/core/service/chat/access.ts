import {
  defaultAuthorizer,
  makeActor,
  type Permission,
  PERMISSIONS,
  type Role
} from '@overlord/auth';
import type { ChatSourceLocatorDto } from '@overlord/contract';
import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from '../context.js';
import { getProjectExecutionTargetSelection } from '../project-execution-target.js';

import type { ChatOwner, SourceChecker } from './store.js';

/** One live membership of the owner, in a workspace of the owner's organization. */
export interface ChatWorkspaceGrant {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  workspaceUserId: string;
}

/**
 * Live authorization for assistant reads (contract v152). A run executes in the
 * background, with no request snapshot, so every check resolves the thread owner's
 * current organization memberships and role grants from the database. Nothing a model
 * or tool result supplies can widen this: grants come only from `role_assignments`.
 */
export class ChatAccess {
  constructor(readonly db: DatabaseClient) {}

  async grants(owner: ChatOwner, permission: Permission): Promise<ChatWorkspaceGrant[]> {
    const rows = await this.db.all<{
      workspace_id: string;
      slug: string;
      name: string;
      workspace_user_id: string;
    }>(
      `SELECT w.id AS workspace_id, w.slug, w.name, wu.id AS workspace_user_id
         FROM workspace_users wu
         JOIN workspaces w ON w.id = wu.workspace_id
         JOIN organizations o ON o.id = w.organization_id
        WHERE wu.profile_id = ? AND w.organization_id = ? AND wu.status = 'active'
          AND wu.deleted_at IS NULL AND w.deleted_at IS NULL AND o.deleted_at IS NULL
        ORDER BY w.name, w.id`,
      [owner.profileId, owner.organizationId]
    );
    const out: ChatWorkspaceGrant[] = [];
    for (const row of rows) {
      const roles = await this.db.all<{ role_key: string }>(
        'SELECT role_key FROM role_assignments WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL',
        [row.workspace_id, row.workspace_user_id]
      );
      const actor = makeActor(
        row.workspace_user_id,
        roles.map(r => r.role_key as Role)
      );
      if (roles.length && defaultAuthorizer.can(actor, permission).allowed)
        out.push({
          workspaceId: row.workspace_id,
          workspaceSlug: row.slug,
          workspaceName: row.name,
          workspaceUserId: row.workspace_user_id
        });
    }
    return out;
  }

  /** The owner's grant in the workspace holding `projectId`, or null (existence is never revealed). */
  async projectGrant(
    owner: ChatOwner,
    projectId: string,
    permission: Permission = PERMISSIONS.PROJECT_READ
  ): Promise<{ grant: ChatWorkspaceGrant; project: { id: string; name: string } } | null> {
    if (typeof projectId !== 'string' || !projectId || projectId.length > 200) return null;
    const project = await this.db.get<{ id: string; name: string; workspace_id: string }>(
      'SELECT id, name, workspace_id FROM projects WHERE id = ? AND deleted_at IS NULL',
      [projectId]
    );
    if (!project) return null;
    const grant = (await this.grants(owner, permission)).find(
      g => g.workspaceId === project.workspace_id
    );
    return grant ? { grant, project: { id: project.id, name: project.name } } : null;
  }

  context(grant: ChatWorkspaceGrant): ServiceContext {
    return {
      db: this.db,
      workspace: { id: grant.workspaceId, slug: grant.workspaceSlug, name: grant.workspaceName },
      actorWorkspaceUserId: grant.workspaceUserId,
      // Reads only. The assistant acts with the owner's role grants, never a token.
      source: 'webapp',
      allowedProjectIds: null,
      clientDevice: null
    };
  }
}

const ENTITY_PROJECT_SQL: Record<
  Extract<ChatSourceLocatorDto, { kind: 'overlord' }>['entityType'],
  string
> = {
  project: 'SELECT id AS project_id FROM projects WHERE id = ? AND deleted_at IS NULL',
  resource: 'SELECT project_id FROM project_resources WHERE id = ? AND deleted_at IS NULL',
  mission: 'SELECT project_id FROM missions WHERE id = ? AND deleted_at IS NULL',
  objective: 'SELECT project_id FROM objectives WHERE id = ? AND deleted_at IS NULL',
  delivery: 'SELECT project_id FROM deliveries WHERE id = ? AND deleted_at IS NULL'
};

/**
 * Current access check for Overlord entities: the entity still exists and the owner
 * still holds the read permission in its project's workspace. A deleted entity or a
 * lost membership/role is `revoked`; any failure throws and the caller fails closed.
 */
export function overlordSourceChecker(db: DatabaseClient): SourceChecker {
  const access = new ChatAccess(db);
  return async (owner, source) => {
    if (source.kind !== 'overlord') return 'unknown';
    const sql = ENTITY_PROJECT_SQL[source.entityType];
    if (!sql) return 'unknown';
    const row = await db.get<{ project_id: string }>(sql, [source.entityId]);
    if (!row || (source.projectId && row.project_id !== source.projectId)) return 'revoked';
    const permission =
      source.entityType === 'project' || source.entityType === 'resource'
        ? PERMISSIONS.PROJECT_READ
        : PERMISSIONS.MISSION_READ;
    return (await access.projectGrant(owner, row.project_id, permission))
      ? 'authorized'
      : 'revoked';
  };
}

export type TargetEligibility = (
  ctx: ServiceContext,
  projectId: string,
  executionTargetId: string
) => Promise<boolean>;

const eligibleTarget: TargetEligibility = async (ctx, projectId, executionTargetId) =>
  (await getProjectExecutionTargetSelection({ ctx, projectId })).eligibleTargets.some(
    t => t.executionTargetId === executionTargetId
  );

/**
 * Current access check for repository observations: the owner still reads the project
 * and may still use the execution target for it. Reachability is not access, so an
 * offline target keeps its earlier observations (labelled with their time).
 */
export function repositorySourceChecker(
  db: DatabaseClient,
  eligible: TargetEligibility = eligibleTarget
): SourceChecker {
  const access = new ChatAccess(db);
  return async (owner, source) => {
    if (source.kind !== 'repository') return 'unknown';
    const scope = await access.projectGrant(owner, source.projectId);
    if (!scope) return 'revoked';
    return (await eligible(access.context(scope.grant), source.projectId, source.executionTargetId))
      ? 'authorized'
      : 'revoked';
  };
}
