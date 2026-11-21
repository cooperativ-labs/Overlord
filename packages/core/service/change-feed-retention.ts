import type { DatabaseClient } from '@overlord/database';

export const CHANGE_FEED_RETENTION_MS = 21 * 24 * 60 * 60 * 1000;
export const ERASED_EVERHOUR_ACTOR = '!overlord:erased-actor';
const MAX_BATCH = 1000;

/** Erase a deleted member's identifier while preserving a fail-closed marker. */
export async function eraseEverhourActorEvidence(
  db: DatabaseClient,
  actorId: string
): Promise<void> {
  if (actorId === ERASED_EVERHOUR_ACTOR) return;
  const insertion =
    db.dialect === 'postgres'
      ? `INSERT INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)`
      : `INSERT OR IGNORE INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)`;
  const conflict = db.dialect === 'postgres' ? ' ON CONFLICT DO NOTHING' : '';
  await db.run(
    `${insertion}
    SELECT connection_id, ? FROM ext_everhour_connection_attribution WHERE actor_workspace_user_id = ?
    UNION
    SELECT entity_id, ? FROM entity_changes WHERE entity_type = 'everhour:workspace_connection'
      AND operation IN ('insert', 'update') AND actor_workspace_user_id = ?${conflict}`,
    [ERASED_EVERHOUR_ACTOR, actorId, ERASED_EVERHOUR_ACTOR, actorId]
  );
  await db.run(
    `DELETE FROM ext_everhour_connection_attribution WHERE actor_workspace_user_id = ?`,
    [actorId]
  );
}

/** Delete one contiguous old prefix, preserving attribution and cursor boundary
 * in the same transaction. Call only after all clients support full recovery. */
export async function pruneChangeFeedBatch(
  db: DatabaseClient,
  options: { now?: Date; limit?: number } = {}
): Promise<{ deleted: number; retainedThrough: number }> {
  const limit = Math.max(1, Math.min(MAX_BATCH, Math.floor(options.limit ?? MAX_BATCH)));
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - CHANGE_FEED_RETENTION_MS
  ).toISOString();
  return db.transaction(async tx => {
    if (tx.dialect === 'postgres') {
      await tx.exec("SET LOCAL lock_timeout = '2s'");
      await tx.exec('LOCK TABLE entity_changes IN SHARE ROW EXCLUSIVE MODE');
    }
    const state = await tx.get<{ retained_through: number }>(
      `SELECT retained_through FROM entity_change_retention WHERE id = 1`
    );
    if (!state) throw new Error('Change-feed retention boundary is missing');
    const floor = Number(state.retained_through);
    const rows = await tx.all<{ seq: number; occurred_at: string }>(
      `SELECT seq, occurred_at FROM entity_changes WHERE seq > ? ORDER BY seq LIMIT ?`,
      [floor, limit]
    );
    let boundary = floor;
    for (const row of rows) {
      if (row.occurred_at >= cutoff) break;
      boundary = row.seq;
    }
    if (boundary === floor) return { deleted: 0, retainedThrough: floor };
    const insertion =
      tx.dialect === 'postgres'
        ? `INSERT INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)`
        : `INSERT OR IGNORE INTO ext_everhour_connection_attribution (connection_id, actor_workspace_user_id)`;
    const conflict = tx.dialect === 'postgres' ? ' ON CONFLICT DO NOTHING' : '';
    await tx.run(
      `${insertion}
      SELECT DISTINCT entity_id, actor_workspace_user_id FROM entity_changes
      WHERE seq > ? AND seq <= ? AND entity_type = 'everhour:workspace_connection'
        AND operation IN ('insert', 'update') AND actor_workspace_user_id IS NOT NULL${conflict}`,
      [floor, boundary]
    );
    const deleted = await tx.run(`DELETE FROM entity_changes WHERE seq > ? AND seq <= ?`, [
      floor,
      boundary
    ]);
    await tx.run(`UPDATE entity_change_retention SET retained_through = ? WHERE id = 1`, [
      boundary
    ]);
    return { deleted: deleted.changes, retainedThrough: boundary };
  });
}
