import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-live-activity-start-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'live-activity-start.sqlite')
});

const { requireDatabaseClient, setActiveProfileId, withRequestContextAsync } =
  await import('./db.ts');
const { createMission, createProject } = await import('./repository.ts');
const {
  registerLiveActivityPushToken,
  registerLiveActivityStartToken,
  revokeLiveActivityStartToken
} = await import('./live-activities.ts');
const { __testables } = await import('./live-activity-dispatcher.ts');
const { enqueueLiveActivityStartForMission, enqueueLiveActivityStartJob } =
  await import('../packages/core/service/live-activity-jobs.ts');

const START_JOB_TYPE = 'overlord.live_activity.start.v1';

const REGISTRATION = {
  startToken: 'push-to-start-token-1',
  environment: 'sandbox' as const,
  bundleId: 'io.cooperativ.overlord',
  activityType: 'OverlordActivityAttributes',
  appVersion: '0.1.0'
};

function startJobs(): Array<{ status: string; payload_json: string; last_error: string | null }> {
  return db
    .prepare(
      `SELECT status, payload_json, last_error FROM worker_jobs
        WHERE type = ? ORDER BY created_at ASC`
    )
    .all(START_JOB_TYPE) as Array<{
    status: string;
    payload_json: string;
    last_error: string | null;
  }>;
}

function clearJobs(): void {
  db.prepare(`DELETE FROM worker_jobs WHERE type IN (?, 'overlord.live_activity.dispatch.v1')`).run(
    START_JOB_TYPE
  );
}

async function asOperator(fn: () => Promise<void>): Promise<void> {
  await withRequestContextAsync(async () => {
    setActiveProfileId('operator-user');
    await fn();
  });
}

async function runDispatcher(): Promise<void> {
  const dispatcher = new __testables.LiveActivityDispatcher();
  dispatcher.pollNow();
  await new Promise(resolve => setTimeout(resolve, 60));
}

async function executingMission(name: string): Promise<{ id: string }> {
  const project = await createProject({ name });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Run the thing' });
  const objective = db
    .prepare(`SELECT id FROM objectives WHERE mission_id = ?`)
    .get(mission.id) as {
    id: string;
  };
  db.prepare(`UPDATE objectives SET state = 'executing', updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    objective.id
  );
  return mission;
}

test('push-to-start tokens are stored apart from activity tokens and rotate in place', async () => {
  await asOperator(async () => {
    await registerLiveActivityStartToken(REGISTRATION);
    await registerLiveActivityStartToken({ ...REGISTRATION, appVersion: '0.2.0' });
  });

  const rows = db
    .prepare(
      `SELECT start_token, environment, bundle_id, activity_type, app_version, last_started_at
         FROM live_activity_start_tokens`
    )
    .all() as Array<Record<string, unknown>>;
  assert.equal(rows.length, 1, 're-registering the same token rotates rather than duplicates');
  assert.equal(rows[0]?.start_token, REGISTRATION.startToken);
  assert.equal(rows[0]?.environment, 'sandbox');
  assert.equal(rows[0]?.activity_type, 'OverlordActivityAttributes');
  assert.equal(rows[0]?.app_version, '0.2.0');
  assert.equal(rows[0]?.last_started_at, null);
  assert.equal(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM live_activity_push_tokens`).get() as {
        count: number;
      }
    ).count,
    0,
    'a start token never lands in the per-activity update-token table'
  );
});

test('start-token registration rejects malformed input', async () => {
  await asOperator(async () => {
    await assert.rejects(
      () => registerLiveActivityStartToken({ ...REGISTRATION, startToken: '  ' }),
      /startToken is required/
    );
    await assert.rejects(
      () => registerLiveActivityStartToken({ ...REGISTRATION, environment: 'staging' }),
      /environment must be sandbox or production/
    );
    await assert.rejects(
      () => registerLiveActivityStartToken({ ...REGISTRATION, bundleId: '' }),
      /bundleId is required/
    );
    await assert.rejects(
      () => registerLiveActivityStartToken({ ...REGISTRATION, appVersion: 'v'.repeat(65) }),
      /appVersion is too long/
    );
  });
});

test('a mission entering execution enqueues one coalesced start job for its assignee', async () => {
  clearJobs();
  const mission = await executingMission('Start Job Project');
  const client = requireDatabaseClient();

  const first = await enqueueLiveActivityStartForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id
  });
  const second = await enqueueLiveActivityStartForMission({
    db: client,
    workspaceId: 'local-workspace',
    missionId: mission.id
  });

  assert.equal(first, true);
  assert.equal(second, false, 'a queued start for the same profile is not duplicated');
  const jobs = startJobs();
  assert.equal(jobs.length, 1);
  const payload = JSON.parse(jobs[0]!.payload_json) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['missionId', 'profileId'],
    'the payload carries ids only — never Lock Screen content'
  );
  assert.equal(payload.profileId, 'operator-user');
  assert.equal(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM worker_jobs
            WHERE type = 'overlord.live_activity.dispatch.v1'`
        )
        .get() as { count: number }
    ).count,
    1,
    'an already-running activity is refreshed alongside the start attempt'
  );
});

test('an unassigned mission never produces a start job', async () => {
  clearJobs();
  const project = await createProject({ name: 'Unassigned Start Project' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
  db.prepare(`UPDATE missions SET assigned_workspace_user_id = NULL WHERE id = ?`).run(mission.id);

  const enqueued = await enqueueLiveActivityStartForMission({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    missionId: mission.id
  });
  assert.equal(enqueued, false, 'start is addressed to an assignee, never broadcast');
  assert.equal(startJobs().length, 0);
});

test('the start payload carries the ActivityKit start event, attributes, and bounded state', () => {
  const body = JSON.parse(
    __testables.apnsStartPayload(
      {
        running: [
          {
            id: 'mission-1',
            title: 'Run the thing',
            displayId: 'coo:1',
            projectName: 'Start Job Project',
            projectColorHex: '#2563eb'
          }
        ],
        recentCompletion: null,
        updatedAt: '2026-08-06T00:00:00.000Z'
      },
      'OverlordActivityAttributes'
    )
  ) as { aps: Record<string, unknown> };

  assert.equal(body.aps.event, 'start');
  assert.equal(body.aps['attributes-type'], 'OverlordActivityAttributes');
  assert.deepEqual(body.aps.attributes, { accountLabel: 'My Missions' });
  assert.equal(typeof body.aps['stale-date'], 'number');
  assert.deepEqual((body.aps.alert as { title: string }).title, 'Run the thing');
  assert.deepEqual(Object.keys(body.aps['content-state'] as object).sort(), [
    'recentCompletion',
    'running',
    'updatedAt'
  ]);
});

test('the dispatcher completes a start job without APNs credentials and leaves no start stamp', async () => {
  clearJobs();
  delete process.env.OVERLORD_APNS_TEAM_ID;
  db.prepare(`UPDATE live_activity_start_tokens SET last_started_at = NULL`).run();
  await executingMission('Dispatch Start Project');
  await enqueueLiveActivityStartJob({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    profileId: 'operator-user',
    missionId: 'mission-under-test'
  });

  await runDispatcher();

  const jobs = startJobs();
  assert.equal(jobs.at(-1)?.status, 'succeeded');
  assert.equal(jobs.at(-1)?.last_error, null);
  assert.equal(
    (
      db.prepare(`SELECT last_started_at FROM live_activity_start_tokens LIMIT 1`).get() as {
        last_started_at: string | null;
      }
    ).last_started_at,
    null,
    'no APNs request is attempted without credentials'
  );
});

test('a start is skipped while the account already has a live activity registered', async () => {
  clearJobs();
  await asOperator(async () => {
    // The handoff after APNs remotely started the activity: this is the
    // per-activity *update* token, registered against the existing route.
    await registerLiveActivityPushToken('activity-from-push', {
      pushToken: 'update-token-1',
      startedByPush: true
    });
  });
  const registration = db
    .prepare(`SELECT origin FROM live_activity_push_tokens WHERE activity_id = ?`)
    .get('activity-from-push') as { origin: string };
  assert.equal(registration.origin, 'push_to_start');

  clearJobs();
  await enqueueLiveActivityStartJob({
    db: requireDatabaseClient(),
    workspaceId: 'local-workspace',
    profileId: 'operator-user',
    missionId: 'mission-under-test'
  });
  await runDispatcher();

  assert.equal(startJobs().at(-1)?.status, 'succeeded');
  assert.equal(
    (
      db.prepare(`SELECT last_started_at FROM live_activity_start_tokens LIMIT 1`).get() as {
        last_started_at: string | null;
      }
    ).last_started_at,
    null,
    'an account with an activity on screen is updated, never started a second time'
  );
});

test('revoking the start token withdraws consent to desktop-initiated activities', async () => {
  await asOperator(async () => {
    await revokeLiveActivityStartToken({ startToken: REGISTRATION.startToken });
    await revokeLiveActivityStartToken({ startToken: REGISTRATION.startToken });
  });
  assert.equal(
    (
      db.prepare(`SELECT COUNT(*) AS count FROM live_activity_start_tokens`).get() as {
        count: number;
      }
    ).count,
    0,
    'revocation is idempotent'
  );
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));
