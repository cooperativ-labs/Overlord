import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createServiceContext } from './context.js';
import { softDeleteDeviceIfOrphaned, softDeleteOrphanDevices } from './devices.js';
import { seedServiceOperator } from './test-helpers.js';
import { newId, nowIso } from './util.js';

async function setup() {
  const db = createSqliteClient(openInMemoryDatabase());
  await seedServiceOperator({ db });
  const ctx = await createServiceContext({ db, source: 'cli' });
  return { db, ctx };
}

describe('orphan device cleanup', () => {
  it('softDeleteOrphanDevices tombstones devices with no live execution target', async () => {
    const { ctx, db } = await setup();
    const now = nowIso();
    const orphanId = newId();
    const keptDeviceId = newId();
    const keptTargetId = newId();

    await db.run(
      `INSERT INTO devices
         (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, 'fp-orphan', 'orphan', 'linux', 'active', ?, '{}', ?, ?, 1)`,
      [orphanId, ctx.workspace.id, now, now, now]
    );
    await db.run(
      `INSERT INTO devices
         (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, 'fp-kept', 'kept', 'linux', 'active', ?, '{}', ?, ?, 1)`,
      [keptDeviceId, ctx.workspace.id, now, now, now]
    );
    await db.run(
      `INSERT INTO execution_targets
         (id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
          connection_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, 'local', 'kept', 'active', '{}', ?, ?, 1)`,
      [keptTargetId, ctx.workspace.id, keptDeviceId, ctx.actorWorkspaceUserId, now, now]
    );

    const deleted = await softDeleteOrphanDevices({ ctx });
    assert.equal(deleted, 1);

    const orphan = (await db.get(`SELECT deleted_at FROM devices WHERE id = ?`, [orphanId])) as {
      deleted_at: string | null;
    };
    const kept = (await db.get(`SELECT deleted_at FROM devices WHERE id = ?`, [keptDeviceId])) as {
      deleted_at: string | null;
    };
    assert.ok(orphan.deleted_at);
    assert.equal(kept.deleted_at, null);
  });

  it('softDeleteDeviceIfOrphaned only deletes when no live target remains', async () => {
    const { ctx, db } = await setup();
    const now = nowIso();
    const deviceId = newId();
    const targetId = newId();

    await db.run(
      `INSERT INTO devices
         (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
       VALUES (?, ?, 'fp-if-orphan', 'device', 'linux', 'active', ?, '{}', ?, ?, 1)`,
      [deviceId, ctx.workspace.id, now, now, now]
    );
    await db.run(
      `INSERT INTO execution_targets
         (id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
          connection_json, created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, 'local', 'target', 'active', '{}', ?, ?, 1)`,
      [targetId, ctx.workspace.id, deviceId, ctx.actorWorkspaceUserId, now, now]
    );

    assert.equal(await softDeleteDeviceIfOrphaned({ ctx, deviceId }), false);

    await db.run(`UPDATE execution_targets SET deleted_at = ? WHERE id = ?`, [now, targetId]);
    assert.equal(await softDeleteDeviceIfOrphaned({ ctx, deviceId }), true);

    const device = (await db.get(`SELECT deleted_at FROM devices WHERE id = ?`, [deviceId])) as {
      deleted_at: string | null;
    };
    assert.ok(device.deleted_at);
  });
});
