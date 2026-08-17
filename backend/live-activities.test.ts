import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-live-activities-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'live-activities.sqlite') });

const { db, requireDatabaseClient, setActiveProfileId, withRequestContextAsync } =
  await import('./db.ts');
const { createMission, createObjective, createProject } = await import('./repository.ts');
const {
  buildLiveActivityContentState,
  liveActivityContentHash,
  registerLiveActivityPushToken,
  revokeLiveActivityPushToken
} = await import('./live-activities.ts');
const { __testables } = await import('./live-activity-dispatcher.ts');
const { enqueueLiveActivityDispatchJob } =
  await import('../packages/core/service/live-activity-jobs.ts');

const PUSH_REGISTRATION = {
  pushToken: 'opaque-token-1',
  environment: 'sandbox' as const,
  bundleId: 'io.cooperativ.overlord'
};

test('registers opaque tokens privately and coalesces a first refresh job', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await registerLiveActivityPushToken('activity-1', PUSH_REGISTRATION);
    await registerLiveActivityPushToken('activity-1', {
      ...PUSH_REGISTRATION,
      pushToken: 'opaque-token-2',
      environment: 'production'
    });
  });

  const registration = db
    .prepare(
      `SELECT push_token, environment, bundle_id FROM live_activity_push_tokens
        WHERE activity_id = 'activity-1'`
    )
    .get() as { push_token: string; environment: string; bundle_id: string };
  assert.equal(registration.push_token, 'opaque-token-2');
  assert.equal(registration.environment, 'production');
  assert.equal(registration.bundle_id, 'io.cooperativ.overlord');
  const jobs = db
    .prepare(
      `SELECT COUNT(*) AS count FROM worker_jobs
        WHERE type = 'overlord.live_activity.dispatch.v1' AND status = 'queued'`
    )
    .get() as { count: number };
  assert.equal(jobs.count, 1);

  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await revokeLiveActivityPushToken('activity-1');
  });
  assert.equal(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM live_activity_push_tokens`).get() as {
        count: number;
      }
    ).count,
    0
  );
});

test('rejects Live Activity update-token registrations without APNs routing fields', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await assert.rejects(
      () =>
        registerLiveActivityPushToken('activity-missing-bundle', {
          pushToken: 'token',
          environment: 'sandbox'
        }),
      /bundleId is required/
    );
    await assert.rejects(
      () =>
        registerLiveActivityPushToken('activity-missing-env', {
          pushToken: 'token',
          bundleId: 'io.cooperativ.overlord'
        }),
      /environment must be sandbox or production/
    );
  });
});

test('builds a bounded account snapshot and hashes only visible content', async () => {
  const project = await createProject({ name: 'Live Activity Project', color: '#22aa44' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: '**Run** [this](https://example.com)'
  });
  const objective = db
    .prepare(`SELECT id, display_key FROM objectives WHERE mission_id = ?`)
    .get(mission.id) as { id: string; display_key: string };
  db.prepare(`UPDATE objectives SET state = 'executing', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    objective.id
  );

  const state = await buildLiveActivityContentState(requireDatabaseClient(), 'operator-user');
  assert.equal(state?.running.length, 1);
  assert.equal(state?.running[0]?.title, 'Run this');
  assert.equal(
    state?.running[0]?.id,
    mission.id,
    'id stays the mission id for ActivityKit navigation'
  );
  assert.equal(state?.running[0]?.objectiveId, objective.id);
  assert.equal(state?.running[0]?.missionDisplayId, mission.displayId);
  assert.equal(state?.running[0]?.displayId, `${mission.displayId}.${objective.display_key}`);
  assert.equal(state?.running[0]?.projectColorHex, '#22aa44');
  assert.equal(typeof state?.updatedAt, 'number');
  assert.ok(Number.isInteger(state?.updatedAt));
  assert.ok((state?.updatedAt ?? 0) > 1_000_000_000);
  assert.equal(
    liveActivityContentHash(state),
    liveActivityContentHash(state && { ...state, updatedAt: 4_102_444_800 })
  );
});

test('running snapshots are one row per executing objective, capped at two', async () => {
  db.prepare(
    `UPDATE objectives SET state = 'complete' WHERE deleted_at IS NULL AND state = 'executing'`
  ).run();
  const project = await createProject({ name: 'Two Objectives', color: '#111111' });
  const firstMission = await createMission({
    projectId: project.id,
    title: 'Shared context',
    firstObjective: 'Objective A'
  });
  const first = firstMission.objectives[0]!;
  const second = await createObjective({
    missionId: firstMission.id,
    title: 'Objective B',
    instructionText: 'Second running objective',
    state: 'future'
  });
  const otherMission = await createMission({
    projectId: project.id,
    title: 'Other mission',
    firstObjective: 'Objective C'
  });
  const third = otherMission.objectives[0]!;
  for (const [objectiveId, updatedAt] of [
    [third.id, '2026-08-17T12:00:03.000Z'],
    [second.id, '2026-08-17T12:00:02.000Z'],
    [first.id, '2026-08-17T12:00:01.000Z']
  ] as const) {
    db.prepare(`UPDATE objectives SET state = 'executing', updated_at = ? WHERE id = ?`).run(
      updatedAt,
      objectiveId
    );
  }

  const state = await buildLiveActivityContentState(requireDatabaseClient(), 'operator-user');
  assert.equal(state?.running.length, 2, 'account cap is two running objectives, not two missions');
  assert.deepEqual(
    state?.running.map(row => row.objectiveId),
    [third.id, second.id]
  );
  assert.equal(state?.running[0]?.displayId, `${otherMission.displayId}.${third.displayKey}`);
  assert.equal(state?.running[1]?.displayId, `${firstMission.displayId}.${second.displayKey}`);
  assert.equal(state?.running[1]?.id, firstMission.id);
  assert.equal(state?.running[1]?.title, 'Objective B');
});

test('the dispatcher claims and completes a live-activity job without APNs credentials', async () => {
  db.prepare(`DELETE FROM worker_jobs WHERE type = 'overlord.live_activity.dispatch.v1'`).run();
  await enqueueLiveActivityDispatchJob({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    profileId: 'operator-user'
  });

  const dispatcher = new __testables.LiveActivityDispatcher();
  dispatcher.pollNow();
  await new Promise(resolve => setTimeout(resolve, 50));

  const job = db
    .prepare(
      `SELECT status, last_error FROM worker_jobs
        WHERE type = 'overlord.live_activity.dispatch.v1' ORDER BY created_at DESC LIMIT 1`
    )
    .get() as { status: string; last_error: string | null };
  assert.equal(job.status, 'succeeded');
  assert.equal(job.last_error, null);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));
