import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-push-notifications-'));
const { bootstrapIntegrationTestDb, seedAuthenticatedOperator } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'push-notifications.sqlite')
});

const { requireDatabaseClient, setActiveProfileId, withRequestContextAsync } =
  await import('./db.ts');
const { createMission, createProject, updateMission } = await import('./repository.ts');
const {
  buildPushNotificationPresentation,
  getNotificationPreferences,
  registerDevicePushToken,
  resolveNotificationMode,
  revokeDevicePushToken,
  updateNotificationPreferences
} = await import('./push-notifications.ts');
const { __testables } = await import('./push-notification-dispatcher.ts');
const { enqueuePushNotificationForMission, pushNotificationDedupeKey } =
  await import('../packages/core/service/push-notification-jobs.ts');

const REGISTRATION = {
  deviceToken: 'aabbccdd11223344',
  environment: 'sandbox' as const,
  bundleId: 'io.cooperativ.overlord',
  appVersion: '0.1.0'
};

function queuedJobs(): Array<{ payload_json: string }> {
  return db
    .prepare(
      `SELECT payload_json FROM worker_jobs
        WHERE type = 'overlord.push_notification.dispatch.v1' AND status = 'queued'`
    )
    .all() as Array<{ payload_json: string }>;
}

test('registers, rotates, and revokes a device token privately', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await registerDevicePushToken(REGISTRATION);
    await registerDevicePushToken({
      ...REGISTRATION,
      environment: 'production',
      appVersion: '2.0'
    });
  });

  const rows = db
    .prepare(`SELECT profile_id, environment, app_version, platform FROM device_push_tokens`)
    .all() as Array<{
    profile_id: string;
    environment: string;
    app_version: string;
    platform: string;
  }>;
  assert.equal(rows.length, 1, 're-registering the same device must not create a second row');
  assert.equal(rows[0]?.environment, 'production');
  assert.equal(rows[0]?.app_version, '2.0');
  assert.equal(rows[0]?.platform, 'ios');

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await revokeDevicePushToken({ deviceToken: REGISTRATION.deviceToken });
    // Revocation is idempotent so a retried sign-out cannot fail.
    await revokeDevicePushToken({ deviceToken: REGISTRATION.deviceToken });
  });
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS count FROM device_push_tokens`).get() as { count: number })
      .count,
    0
  );
});

test('rejects malformed registrations', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await assert.rejects(() => registerDevicePushToken({ ...REGISTRATION, deviceToken: '  ' }), {
      status: 400
    });
    await assert.rejects(
      () => registerDevicePushToken({ ...REGISTRATION, environment: 'staging' }),
      { status: 400 }
    );
    await assert.rejects(() => registerDevicePushToken({ ...REGISTRATION, bundleId: '' }), {
      status: 400
    });
  });
});

test('reassigns a device token when another account signs in on the device', async () => {
  seedAuthenticatedOperator({
    db,
    profileId: 'second-user',
    workspaceUserId: 'second-workspace-user'
  });

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await registerDevicePushToken(REGISTRATION);
  });
  await withRequestContextAsync(async () => {
    setActiveProfileId('second-user');
    await registerDevicePushToken(REGISTRATION);
  });

  const rows = db.prepare(`SELECT profile_id FROM device_push_tokens`).all() as Array<{
    profile_id: string;
  }>;
  assert.deepEqual(
    rows.map(row => row.profile_id),
    ['second-user'],
    'a shared device must not keep delivering the previous account notifications'
  );

  // The previous owner revoking its (now reassigned) token must not steal the row.
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await revokeDevicePushToken({ deviceToken: REGISTRATION.deviceToken });
  });
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS count FROM device_push_tokens`).get() as { count: number })
      .count,
    1
  );
  db.prepare(`DELETE FROM device_push_tokens`).run();
});

test('defaults every category to alert and merges partial preference updates', async () => {
  const defaults = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return getNotificationPreferences();
  });
  assert.equal(defaults.enabled, true);
  assert.deepEqual(
    defaults.categories.map(entry => entry.mode),
    ['alert', 'alert', 'alert', 'alert']
  );

  const merged = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return updateNotificationPreferences({
      categories: [{ category: 'mission_complete', mode: 'silent' }]
    });
  });
  assert.equal(merged.enabled, true);
  assert.equal(
    merged.categories.find(entry => entry.category === 'mission_complete')?.mode,
    'silent'
  );
  assert.equal(
    merged.categories.find(entry => entry.category === 'agent_question')?.mode,
    'alert',
    'an omitted category keeps its stored value'
  );

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await assert.rejects(
      () => updateNotificationPreferences({ categories: [{ category: 'nope', mode: 'alert' }] }),
      { status: 400 }
    );
    await assert.rejects(
      () =>
        updateNotificationPreferences({
          categories: [{ category: 'agent_question', mode: 'vibrate' }]
        }),
      { status: 400 }
    );
    await assert.rejects(() => updateNotificationPreferences({ enabled: 'yes' }), { status: 400 });
  });
});

test('uses catalog type and transport pairs as the canonical preference shape', async () => {
  const defaults = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return getNotificationPreferences();
  });
  assert.equal(defaults.preferences.length, 16);
  assert.deepEqual(
    defaults.preferences.find(
      entry => entry.type === 'agent_started' && entry.transport === 'realtime'
    ),
    { type: 'agent_started', transport: 'realtime', mode: 'silent' }
  );

  const updated = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return updateNotificationPreferences({
      preferences: [
        { type: 'agent_question', transport: 'realtime', mode: 'silent' },
        { type: 'agent_started', transport: 'realtime', mode: 'alert' }
      ]
    });
  });
  assert.equal(
    updated.preferences.find(
      entry => entry.type === 'agent_question' && entry.transport === 'realtime'
    )?.mode,
    'silent'
  );
  assert.equal(
    updated.preferences.find(entry => entry.type === 'agent_question' && entry.transport === 'apns')
      ?.mode,
    'alert',
    'transport-specific updates must not overwrite another transport'
  );

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await assert.rejects(
      () =>
        updateNotificationPreferences({
          preferences: [{ type: 'unknown', transport: 'realtime', mode: 'alert' }]
        }),
      { status: 400 }
    );
    await assert.rejects(
      () =>
        updateNotificationPreferences({
          preferences: [{ type: 'agent_started', transport: 'apns', mode: 'alert' }]
        }),
      { status: 400 }
    );
    await assert.rejects(
      () =>
        updateNotificationPreferences({
          preferences: [{ type: 'agent_question', transport: 'realtime', mode: 'vibrate' }]
        }),
      { status: 400 }
    );
  });
});

test('the master switch suppresses every category without touching stored modes', async () => {
  const client = requireDatabaseClient();
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await updateNotificationPreferences({ enabled: false });
  });

  assert.equal(
    await resolveNotificationMode(client, 'operator-user', 'agent_question', 'apns'),
    'off'
  );
  assert.equal(
    await resolveNotificationMode(client, 'operator-user', 'mission_complete', 'apns'),
    'off'
  );

  const restored = await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    return updateNotificationPreferences({ enabled: true });
  });
  assert.equal(restored.enabled, true);
  assert.equal(
    restored.categories.find(entry => entry.category === 'mission_complete')?.mode,
    'silent',
    'the master switch must not overwrite per-category modes'
  );
  assert.equal(
    await resolveNotificationMode(client, 'operator-user', 'mission_complete', 'apns'),
    'silent'
  );
});

test('builds a bounded, allowlisted payload snapshot', async () => {
  const project = await createProject({
    name: 'A Very Long Project Name That Exceeds The Forty Character Payload Bound',
    color: '#123456'
  });
  const mission = await createMission({
    projectId: project.id,
    title: '**Ship** [the thing](https://example.com/secret-url)',
    firstObjective: 'Do not leak this instruction text'
  });

  const presentation = await buildPushNotificationPresentation({
    db: requireDatabaseClient(),
    profileId: 'operator-user',
    missionId: mission.id,
    category: 'mission_awaiting_review'
  });
  assert.ok(presentation);
  assert.equal(presentation.title.length, 40, 'project name is bounded to the payload limit');
  assert.match(presentation.body, /Ship the thing is ready for review$/);
  assert.doesNotMatch(presentation.body, /example\.com/, 'markdown link targets are stripped');
  assert.doesNotMatch(
    JSON.stringify(presentation),
    /Do not leak this instruction text/,
    'objective instruction text is never part of a payload'
  );
  assert.equal(presentation.deepLink, `overlord://missions/${mission.id}`);
  assert.deepEqual(Object.keys(presentation).sort(), [
    'badge',
    'body',
    'category',
    'deepLink',
    'missionId',
    'title'
  ]);

  const foreign = await buildPushNotificationPresentation({
    db: requireDatabaseClient(),
    profileId: 'second-user',
    missionId: mission.id,
    category: 'mission_awaiting_review'
  });
  assert.equal(foreign, null, 'a profile that is not the assignee never gets a snapshot');
});

test('alert and silent payloads carry only the allowlisted APNs fields', () => {
  const presentation = {
    title: 'Overlord',
    body: 'coo:1: Ship it is ready for review',
    badge: 3,
    missionId: 'mission-1',
    category: 'mission_awaiting_review' as const,
    deepLink: 'overlord://missions/mission-1'
  };

  const alert = JSON.parse(__testables.apnsBody(presentation, 'alert').body) as {
    aps: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.deepEqual(alert.aps.alert, { title: 'Overlord', body: presentation.body });
  assert.equal(alert.aps.sound, 'default');
  assert.equal(alert.aps.badge, 3);
  assert.equal(alert.aps['thread-id'], 'mission-1');
  assert.deepEqual(alert.data, {
    missionId: 'mission-1',
    category: 'mission_awaiting_review',
    deepLink: 'overlord://missions/mission-1'
  });

  const silent = JSON.parse(__testables.apnsBody(presentation, 'silent').body) as {
    aps: Record<string, unknown>;
  };
  assert.equal(silent.aps['content-available'], 1);
  assert.equal(silent.aps.alert, undefined, 'a silent push must not carry a visible alert');
  assert.equal(silent.aps.sound, undefined);
});

test('enqueues one deduped job per mission and category', async () => {
  db.prepare(`DELETE FROM worker_jobs WHERE type = 'overlord.push_notification.dispatch.v1'`).run();
  const project = await createProject({ name: 'Dedupe Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
  const client = requireDatabaseClient();

  const first = await enqueuePushNotificationForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id,
    category: 'agent_question'
  });
  const duplicate = await enqueuePushNotificationForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id,
    category: 'agent_question'
  });
  const otherCategory = await enqueuePushNotificationForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id,
    category: 'mission_failed'
  });

  assert.equal(first, true);
  assert.equal(duplicate, false, 'a queued notification for the same mission is not re-enqueued');
  assert.equal(otherCategory, true, 'distinct categories never collapse into each other');

  const payloads = queuedJobs().map(row => JSON.parse(row.payload_json) as Record<string, unknown>);
  assert.equal(payloads.length, 2);
  assert.deepEqual(payloads[0], {
    profileId: 'operator-user',
    missionId: mission.id,
    objectiveId: null,
    category: 'agent_question',
    dedupeKey: pushNotificationDedupeKey({
      profileId: 'operator-user',
      category: 'agent_question',
      missionId: mission.id
    })
  });
});

test('a mission with no assignee produces no standard push', async () => {
  db.prepare(`DELETE FROM worker_jobs WHERE type = 'overlord.push_notification.dispatch.v1'`).run();
  const project = await createProject({ name: 'Unassigned Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
  db.prepare(`UPDATE missions SET assigned_workspace_user_id = NULL WHERE id = ?`).run(mission.id);

  const enqueued = await enqueuePushNotificationForMission({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id,
    category: 'mission_awaiting_review'
  });
  assert.equal(enqueued, false, 'standard push is addressed, never broadcast to a workspace');
  assert.equal(queuedJobs().length, 0);
});

test('closing a mission emits mission_complete exactly once', async () => {
  db.prepare(`DELETE FROM worker_jobs WHERE type = 'overlord.notification.dispatch.v1'`).run();
  db.prepare(`DELETE FROM notifications`).run();
  const project = await createProject({ name: 'Completion Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });

  await updateMission(mission.id, { statusId: 'local-workspace-done' });
  await updateMission(mission.id, { statusId: 'local-workspace-done' });

  const notifications = db
    .prepare(`SELECT type FROM notifications WHERE mission_id = ? ORDER BY created_at ASC`)
    .all(mission.id) as Array<{ type: string }>;
  assert.deepEqual(
    notifications.map(notification => notification.type),
    ['mission_complete'],
    're-saving the same status must not emit a second notification'
  );
});

test('the dispatcher drops jobs the recipient turned off and no-ops without APNs credentials', async () => {
  db.prepare(`DELETE FROM worker_jobs WHERE type = 'overlord.push_notification.dispatch.v1'`).run();
  delete process.env.OVERLORD_APNS_TEAM_ID;
  const project = await createProject({ name: 'Dispatch Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
  const client = requireDatabaseClient();

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await registerDevicePushToken(REGISTRATION);
    await updateNotificationPreferences({
      categories: [{ category: 'agent_question', mode: 'off' }]
    });
  });
  await enqueuePushNotificationForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id,
    category: 'agent_question'
  });

  const dispatcher = new __testables.PushNotificationDispatcher();
  dispatcher.pollNow();
  await new Promise(resolve => setTimeout(resolve, 50));

  const job = db
    .prepare(
      `SELECT status, last_error FROM worker_jobs
        WHERE type = 'overlord.push_notification.dispatch.v1' ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { status: string; last_error: string | null };
  assert.equal(job.status, 'succeeded', 'an off category is completed, not retried forever');
  assert.equal(job.last_error, null);
  assert.equal(
    (
      db.prepare(`SELECT last_sent_at FROM device_push_tokens LIMIT 1`).get() as {
        last_sent_at: string | null;
      }
    ).last_sent_at,
    null,
    'no APNs request is attempted without credentials'
  );
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));
