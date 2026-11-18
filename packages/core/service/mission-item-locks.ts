import { defaultAuthorizer, makeActor, PERMISSIONS, type Role } from '@overlord/auth';
import type { DatabaseClient } from '@overlord/database';

import type { ServiceContext } from './context.js';
import { projectAllowed } from './context.js';
import { lockMissionObjectiveQueue } from './objective-queue.js';
import { sqlPlaceholders } from './util.js';

export async function canCloseForeignItems(ctx: ServiceContext): Promise<boolean> {
  if (ctx.canUpdateMissionItems) return ctx.canUpdateMissionItems();
  // Non-HTTP callers have no token consent snapshot; never guess token authority.
  if (!ctx.actorWorkspaceUserId || ctx.actorTokenId) return false;
  const roles = await ctx.db.all<{ role_key: Role }>(
    `SELECT role_key FROM role_assignments
    WHERE workspace_id = ? AND workspace_user_id = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, ctx.actorWorkspaceUserId]
  );
  return defaultAuthorizer.can(
    makeActor(
      ctx.actorWorkspaceUserId,
      roles.map(r => r.role_key)
    ),
    PERMISSIONS.MISSION_UPDATE
  ).allowed;
}

class RetryMissionSet extends Error {}

/** Outer transaction boundary: discover, globally lock, then revalidate the entire set.
 * A new record-work source is private and is deliberately absent from this set.
 * Session linkage shares the source lock with standalone closes, preventing phantoms.
 */
export async function withMissionItemLocks<T>(
  ctx: ServiceContext,
  scope: {
    missionId?: string;
    projectId: string;
    sessionId?: string;
    itemIds: string[];
  },
  run: (tx: DatabaseClient) => Promise<T>
): Promise<T> {
  const targets = async (db: DatabaseClient): Promise<string[]> => {
    const ids = new Set(scope.missionId ? [scope.missionId] : []);
    if (!projectAllowed(scope.projectId, ctx.allowedProjectIds)) return [...ids];
    const predicates: string[] = [];
    const params: unknown[] = [ctx.workspace.id, scope.projectId, scope.projectId];
    if (scope.itemIds.length) {
      predicates.push(`mi.id IN (${sqlPlaceholders(scope.itemIds.length)})`);
      params.push(...scope.itemIds);
    }
    if (scope.sessionId) {
      predicates.push(`(mi.resolved_by_session_id = ? AND mi.resolved_by_mission_id = ?
        AND mi.resolved_by_kind = 'agent' AND mi.resolved_by_delivery_id IS NULL
        AND mi.status IN ('done', 'dismissed'))`);
      params.push(scope.sessionId, scope.missionId);
    }
    if (predicates.length) {
      const rows = await db.all<{ mission_id: string }>(
        `SELECT DISTINCT mi.mission_id
        FROM mission_items mi JOIN missions m ON m.id = mi.mission_id AND m.deleted_at IS NULL
        JOIN deliveries d ON d.id = mi.delivery_id AND d.deleted_at IS NULL
        WHERE mi.workspace_id = ? AND mi.project_id = ? AND m.project_id = ?
          AND (${predicates.join(' OR ')})`,
        params
      );
      for (const row of rows) ids.add(row.mission_id);
    }
    return [...ids].sort();
  };
  for (;;) {
    try {
      return await ctx.db.transaction(async tx => {
        const before = await targets(tx);
        for (const id of before) await lockMissionObjectiveQueue(tx, id);
        if (JSON.stringify(before) !== JSON.stringify(await targets(tx)))
          throw new RetryMissionSet();
        return run(tx);
      });
    } catch (error) {
      if (!(error instanceof RetryMissionSet)) throw error;
    }
  }
}
