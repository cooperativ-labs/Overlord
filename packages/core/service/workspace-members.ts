import type { ServiceContext } from './context.js';
import { ServiceError } from './errors.js';

const ASSIGNEE_NOT_MEMBER = 'Assignee is not a member of this workspace';

type MemberRow = { id: string };

/**
 * Resolve a workspace member reference to `workspace_users.id`.
 *
 * Accepts, in order: `workspace_users.id`, profile UUID, `orgid:username`
 * (also matching `member_key` and `workspace:handle`), bare username
 * (`profiles.handle`), and email. Unknown members throw the same message REST
 * uses — never silently fall through to unassigned.
 */
export async function resolveWorkspaceMemberId({
  ctx,
  member
}: {
  ctx: ServiceContext;
  member: string;
}): Promise<string> {
  const trimmed = member.trim();
  if (!trimmed) {
    throw new ServiceError(ASSIGNEE_NOT_MEMBER, 'validation_error');
  }

  const byWorkspaceUserId = await ctx.db.get<MemberRow>(
    `SELECT id FROM workspace_users
        WHERE id = ? AND workspace_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [trimmed, ctx.workspace.id]
  );
  if (byWorkspaceUserId) return byWorkspaceUserId.id;

  const byProfileId = await ctx.db.get<MemberRow>(
    `SELECT id FROM workspace_users
        WHERE profile_id = ? AND workspace_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [trimmed, ctx.workspace.id]
  );
  if (byProfileId) return byProfileId.id;

  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const byMemberKey = await ctx.db.get<MemberRow>(
      `SELECT id FROM workspace_users
          WHERE workspace_id = ? AND status = 'active' AND deleted_at IS NULL
            AND lower(member_key) = lower(?)`,
      [ctx.workspace.id, trimmed]
    );
    if (byMemberKey) return byMemberKey.id;

    const left = trimmed.slice(0, colon);
    const username = trimmed.slice(colon + 1).trim();
    if (username) {
      const byOrgAndHandle = await ctx.db.get<MemberRow>(
        `SELECT wu.id
           FROM workspace_users wu
           JOIN profiles p ON p.id = wu.profile_id AND p.deleted_at IS NULL
           JOIN workspaces w ON w.id = wu.workspace_id AND w.deleted_at IS NULL
          WHERE wu.workspace_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
            AND lower(p.handle) = lower(?)
            AND (w.organization_id = ? OR w.id = ? OR lower(w.slug) = lower(?))`,
        [ctx.workspace.id, username, left, left, left]
      );
      if (byOrgAndHandle) return byOrgAndHandle.id;
    }

    throw new ServiceError(ASSIGNEE_NOT_MEMBER, 'validation_error');
  }

  const byHandle = await ctx.db.get<MemberRow>(
    `SELECT wu.id
       FROM workspace_users wu
       JOIN profiles p ON p.id = wu.profile_id AND p.deleted_at IS NULL
      WHERE wu.workspace_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
        AND lower(p.handle) = lower(?)`,
    [ctx.workspace.id, trimmed]
  );
  if (byHandle) return byHandle.id;

  const byEmail = await ctx.db.get<MemberRow>(
    `SELECT wu.id
       FROM workspace_users wu
       JOIN profiles p ON p.id = wu.profile_id AND p.deleted_at IS NULL
      WHERE wu.workspace_id = ? AND wu.status = 'active' AND wu.deleted_at IS NULL
        AND lower(p.email) = lower(?)`,
    [ctx.workspace.id, trimmed]
  );
  if (byEmail) return byEmail.id;

  throw new ServiceError(ASSIGNEE_NOT_MEMBER, 'validation_error');
}

/**
 * Default assignee for agent-created missions (plan §7.1):
 * explicit `--assigned-to` → parent mission assignee (via session) → parent
 * creator → token workspace user → null only when nothing resolves.
 */
export async function resolveAgentMissionAssignee({
  ctx,
  assignedTo
}: {
  ctx: ServiceContext;
  assignedTo?: string | null;
}): Promise<string | null> {
  if (assignedTo !== undefined && assignedTo !== null) {
    return resolveWorkspaceMemberId({ ctx, member: assignedTo });
  }

  const sessionId = ctx.origin?.sessionId ?? null;
  if (sessionId) {
    const parent = await ctx.db.get<{
      assigned_workspace_user_id: string | null;
      created_by_workspace_user_id: string | null;
    }>(
      `SELECT m.assigned_workspace_user_id, m.created_by_workspace_user_id
         FROM agent_sessions s
         JOIN missions m ON m.id = s.mission_id AND m.deleted_at IS NULL
        WHERE s.id = ? AND s.workspace_id = ? AND s.deleted_at IS NULL`,
      [sessionId, ctx.workspace.id]
    );
    if (parent?.assigned_workspace_user_id) {
      return parent.assigned_workspace_user_id;
    }
    if (parent?.created_by_workspace_user_id) {
      return parent.created_by_workspace_user_id;
    }
  }

  return ctx.actorWorkspaceUserId;
}
