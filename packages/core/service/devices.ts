import { createHash } from 'node:crypto';
import { hostname, platform } from 'node:os';

import { recordChange } from './change-feed.js';
import type { ServiceContext } from './context.js';
import { newId, nowIso } from './util.js';

function deviceFingerprint(): string {
  return createHash('sha256').update(`${hostname()}:${platform()}`).digest('hex').slice(0, 32);
}

/** Stable fingerprint for the process host (read-only; does not touch the database). */
export function callerDeviceFingerprint(): string {
  return deviceFingerprint();
}

/**
 * Soft-delete every live device in the workspace that has no live execution target.
 * Returns the number of devices tombstoned.
 */
export async function softDeleteOrphanDevices({ ctx }: { ctx: ServiceContext }): Promise<number> {
  const orphans = (await ctx.db.all(
    `SELECT d.id
       FROM devices d
      WHERE d.workspace_id = ?
        AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
            FROM execution_targets et
           WHERE et.device_id = d.id
             AND et.workspace_id = d.workspace_id
             AND et.deleted_at IS NULL
        )`,
    [ctx.workspace.id]
  )) as Array<{ id: string }>;

  if (orphans.length === 0) return 0;

  const now = nowIso();
  for (const orphan of orphans) {
    await ctx.db.run(
      `UPDATE devices
          SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
      [now, now, orphan.id, ctx.workspace.id]
    );
    await recordChange({
      ctx,
      entityType: 'device',
      entityId: orphan.id,
      operation: 'delete',
      entityRevision: null,
      changedFields: ['deleted_at']
    });
  }
  return orphans.length;
}

/**
 * Soft-delete `deviceId` when it has no remaining live execution target.
 * No-op when the device is missing, already deleted, or still referenced.
 */
export async function softDeleteDeviceIfOrphaned({
  ctx,
  deviceId
}: {
  ctx: ServiceContext;
  deviceId: string | null | undefined;
}): Promise<boolean> {
  const id = deviceId?.trim();
  if (!id) return false;

  const liveTarget = (await ctx.db.get(
    `SELECT id FROM execution_targets
        WHERE workspace_id = ? AND device_id = ? AND deleted_at IS NULL
        LIMIT 1`,
    [ctx.workspace.id, id]
  )) as { id: string } | undefined;
  if (liveTarget) return false;

  const device = (await ctx.db.get(
    `SELECT id FROM devices
        WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [id, ctx.workspace.id]
  )) as { id: string } | undefined;
  if (!device) return false;

  const now = nowIso();
  await ctx.db.run(
    `UPDATE devices
        SET deleted_at = ?, updated_at = ?, revision = revision + 1
      WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [now, now, id, ctx.workspace.id]
  );
  await recordChange({
    ctx,
    entityType: 'device',
    entityId: id,
    operation: 'delete',
    entityRevision: null,
    changedFields: ['deleted_at']
  });
  return true;
}

export async function getDevice({ ctx }: { ctx: ServiceContext }): Promise<{
  id: string;
  label: string;
  fingerprint: string;
  platform: string | null;
}> {
  const fingerprint = deviceFingerprint();
  const existing = (await ctx.db.get(
    `SELECT id, label, fingerprint, platform FROM devices
       WHERE workspace_id = ? AND fingerprint = ? AND deleted_at IS NULL`,
    [ctx.workspace.id, fingerprint]
  )) as { id: string; label: string; fingerprint: string; platform: string | null } | undefined;

  if (existing) {
    await ctx.db.run(
      `UPDATE devices SET last_seen_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ?`,
      [nowIso(), nowIso(), existing.id]
    );
    return existing;
  }

  // Unique (workspace_id, fingerprint) covers tombstones — revive rather than insert.
  const tombstoned = (await ctx.db.get(
    `SELECT id, label, fingerprint, platform FROM devices
       WHERE workspace_id = ? AND fingerprint = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC
       LIMIT 1`,
    [ctx.workspace.id, fingerprint]
  )) as { id: string; label: string; fingerprint: string; platform: string | null } | undefined;

  if (tombstoned) {
    const now = nowIso();
    await ctx.db.run(
      `UPDATE devices
          SET deleted_at = NULL, status = 'active', last_seen_at = ?, updated_at = ?,
              revision = revision + 1
        WHERE id = ?`,
      [now, now, tombstoned.id]
    );
    await recordChange({
      ctx,
      entityType: 'device',
      entityId: tombstoned.id,
      operation: 'update',
      entityRevision: null,
      changedFields: ['deleted_at', 'status', 'last_seen_at']
    });
    return tombstoned;
  }

  const now = nowIso();
  const id = newId();
  const label = hostname();

  await ctx.db.run(
    `INSERT INTO devices
         (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, 'active', ?, '{}', ?, ?, 1)`,
    [id, ctx.workspace.id, fingerprint, label, platform(), now, now, now]
  );

  await recordChange({
    ctx,
    entityType: 'device',
    entityId: id,
    operation: 'insert',
    entityRevision: 1
  });

  return { id, label, fingerprint, platform: platform() };
}

export async function updateDevice({
  ctx,
  deviceId,
  label
}: {
  ctx: ServiceContext;
  deviceId: string;
  label: string;
}): Promise<{ id: string; label: string }> {
  const trimmed = label.trim();
  if (!trimmed) {
    throw new Error('Device label is required');
  }

  const now = nowIso();
  await ctx.db.run(
    `UPDATE devices SET label = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [trimmed, now, deviceId, ctx.workspace.id]
  );

  return { id: deviceId, label: trimmed };
}
