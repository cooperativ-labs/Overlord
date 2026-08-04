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
const { createMission, createProject } = await import('./repository.ts');
const {
  buildLiveActivityContentState,
  liveActivityContentHash,
  registerLiveActivityPushToken,
  revokeLiveActivityPushToken
} = await import('./live-activities.ts');
const { __testables } = await import('./live-activity-dispatcher.ts');
const { enqueueLiveActivityDispatchJob } =
  await import('../packages/core/service/live-activity-jobs.ts');

test('registers opaque tokens privately and coalesces a first refresh job', async () => {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await registerLiveActivityPushToken('activity-1', { pushToken: 'opaque-token-1' });
    await registerLiveActivityPushToken('activity-1', { pushToken: 'opaque-token-2' });
  });

  const registration = db
    .prepare(`SELECT push_token FROM live_activity_push_tokens WHERE activity_id = 'activity-1'`)
    .get() as { push_token: string };
  assert.equal(registration.push_token, 'opaque-token-2');
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

test('builds a bounded account snapshot and hashes only visible content', async () => {
  const project = await createProject({ name: 'Live Activity Project', color: '#22aa44' });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: '**Run** [this](https://example.com)'
  });
  const objective = db
    .prepare(`SELECT id FROM objectives WHERE mission_id = ?`)
    .get(mission.id) as { id: string };
  db.prepare(`UPDATE objectives SET state = 'executing', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    objective.id
  );

  const state = await buildLiveActivityContentState(requireDatabaseClient(), 'operator-user');
  assert.equal(state?.running.length, 1);
  assert.equal(state?.running[0]?.title, 'Run this');
  assert.equal(state?.running[0]?.projectColorHex, '#22aa44');
  assert.equal(
    liveActivityContentHash(state),
    liveActivityContentHash(state && { ...state, updatedAt: '2099-01-01T00:00:00.000Z' })
  );
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
