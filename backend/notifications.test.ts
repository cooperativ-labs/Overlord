import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-notifications-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'notifications.sqlite')
});

const { requireDatabaseClient, setActiveProfileId, withRequestContextAsync } =
  await import('./db.ts');
const { createMission, createProject } = await import('./repository.ts');
const { __testables } = await import('./notification-dispatcher.ts');
const { dismissNotification, listNotifications, markNotificationRead } =
  await import('./notifications.ts');
const { updateNotificationPreferences } = await import('./push-notifications.ts');
const { emitNotification } =
  await import('../packages/core/service/notifications/notifications.ts');

let projectSequence = 0;

async function createAssignedMission() {
  projectSequence += 1;
  const project = await createProject({ name: `Notification Project ${projectSequence}` });
  return createMission({ projectId: project.id, firstObjective: 'Deliver this' });
}

test('emits one durable row and one notification dispatch job for an assignee', async () => {
  const mission = await createAssignedMission();
  const emitted = await emitNotification({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id,
    type: 'agent_question'
  });
  assert.equal(emitted.emitted, true);
  assert.ok(emitted.notificationId);

  const notification = db
    .prepare(
      `SELECT recipient_profile_id, type, mission_id, revision FROM notifications WHERE id = ?`
    )
    .get(emitted.notificationId) as {
    recipient_profile_id: string;
    type: string;
    mission_id: string;
    revision: number;
  };
  assert.deepEqual(notification, {
    recipient_profile_id: 'operator-user',
    type: 'agent_question',
    mission_id: mission.id,
    revision: 1
  });

  const job = db
    .prepare(
      `SELECT payload_json FROM worker_jobs
        WHERE type = 'overlord.notification.dispatch.v1' AND status = 'queued' ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { payload_json: string };
  assert.deepEqual(JSON.parse(job.payload_json), { notificationId: emitted.notificationId });
});

test('unassigned missions produce neither notification rows nor jobs', async () => {
  const project = await createProject({ name: 'Unassigned notification project' });
  const mission = await createMission({
    projectId: project.id,
    assignedWorkspaceUserId: null,
    firstObjective: 'Stay quiet'
  });
  const emitted = await emitNotification({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id,
    type: 'mission_failed'
  });
  assert.deepEqual(emitted, { notificationId: null, emitted: false });
});

test('dispatcher emits a notification change and profile history supports read and dismiss CAS', async () => {
  const mission = await createAssignedMission();
  const { notificationId } = await emitNotification({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id,
    type: 'agent_started'
  });
  assert.ok(notificationId);

  const dispatcher = new __testables.NotificationDispatcher();
  // Earlier tests intentionally leave their durable jobs queued; one poll claims
  // one job, so drain this tiny fixture queue before asserting this row's change.
  for (let index = 0; index < 3; index += 1) {
    dispatcher.pollNow();
    await new Promise(resolve => setTimeout(resolve, 30));
  }

  const change = db
    .prepare(`SELECT entity_type, entity_id, operation FROM entity_changes WHERE entity_id = ?`)
    .get(notificationId) as { entity_type: string; entity_id: string; operation: string };
  assert.deepEqual(change, {
    entity_type: 'notification',
    entity_id: notificationId,
    operation: 'insert'
  });

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    const listed = await listNotifications();
    const notification = listed.find(item => item.id === notificationId);
    assert.ok(notification);
    assert.match(notification.presentation.body, /started working$/);
    const read = await markNotificationRead(notificationId, {
      expectedRevision: notification.revision
    });
    assert.ok(read.readAt);
    assert.equal(read.revision, notification.revision + 1);
    await dismissNotification(notificationId, { expectedRevision: read.revision });
    assert.equal(
      (await listNotifications()).some(item => item.id === notificationId),
      false
    );
  });
});

test('realtime off suppresses the renderer transport while keeping durable history', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await updateNotificationPreferences({
      preferences: [{ type: 'agent_question', transport: 'realtime', mode: 'off' }]
    });
  });
  const mission = await createAssignedMission();
  const { notificationId } = await emitNotification({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id,
    type: 'agent_question'
  });
  assert.ok(notificationId);

  const dispatcher = new __testables.NotificationDispatcher();
  for (let index = 0; index < 3; index += 1) {
    dispatcher.pollNow();
    await new Promise(resolve => setTimeout(resolve, 30));
  }

  const change = db
    .prepare(`SELECT id FROM entity_changes WHERE entity_type = 'notification' AND entity_id = ?`)
    .get(notificationId);
  assert.equal(change, undefined);
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    assert.ok((await listNotifications()).some(notification => notification.id === notificationId));
    await updateNotificationPreferences({
      preferences: [{ type: 'agent_question', transport: 'realtime', mode: 'alert' }]
    });
  });
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));
