import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  bootstrapIntegrationTestDb,
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

/**
 * Adapter conformance for the REST mission-schedule routes, which delegate to the
 * shared service (packages/core/service/mission-schedules.ts) from inside their own
 * transaction, and for the scheduled duplicate's mission number, which uses the
 * service's atomic allocator. Runs against SQLite always and PostgreSQL when
 * `TEST_DATABASE_URL` points at a reachable Postgres.
 */

const adapters = conformanceAdapters();

const DAILY_UTC_SCHEDULE = {
  periodType: 'd' as const,
  periodInterval: 1,
  timezone: 'UTC',
  daysOfWeek: [{ dayNum: 1, times: ['09:00:00'] }]
};

async function open(adapter: ConformanceAdapter): Promise<{ cleanup: () => Promise<void> }> {
  if (adapter === 'sqlite') {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-schedule-conformance-'));
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });
    return { cleanup: async () => {} };
  }
  const handle = await createConformanceDatabase(adapter, 'ovld_schedule_test');
  await bindWebappDatabaseClient({ client: handle.db });
  return handle;
}

async function runScheduleLifecycleCase(): Promise<void> {
  const {
    clearMissionSchedule,
    createMission,
    createProject,
    getMissionSchedule,
    upsertMissionSchedule
  } = await import('./repository.ts');

  const project = await createProject({ name: 'Schedule Conformance' });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Recurring' });

  const created = await upsertMissionSchedule(mission.displayId, DAILY_UTC_SCHEDULE);
  assert.ok(created.schedule, 'a display id addresses the mission');
  assert.equal(created.schedule.revision, 1);
  assert.ok(created.dueDatetime);

  const updated = await upsertMissionSchedule(mission.id, {
    ...DAILY_UTC_SCHEDULE,
    name: 'Daily standup'
  });
  assert.equal(updated.schedule?.id, created.schedule.id, 'updates the linked schedule in place');
  assert.equal(updated.schedule?.revision, 2);
  assert.equal(updated.schedule?.name, 'Daily standup');

  assert.deepEqual(await getMissionSchedule(mission.id), updated);

  await assert.rejects(
    upsertMissionSchedule(mission.id, { ...DAILY_UTC_SCHEDULE, nextStatusKey: 'no-such-status' }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
  // The rejected write rolled back: the schedule is unchanged.
  assert.equal((await getMissionSchedule(mission.id)).schedule?.revision, 2);

  await clearMissionSchedule(mission.id);
  assert.deepEqual(await getMissionSchedule(mission.id), { dueDatetime: null, schedule: null });
}

async function runScheduledDuplicateSequenceCase(): Promise<void> {
  const {
    createMission,
    createProject,
    listMissions,
    listProjectStatuses,
    updateMission,
    upsertMissionSchedule
  } = await import('./repository.ts');

  const project = await createProject({ name: 'Schedule Sequence Conformance' });
  const first = await createMission({ projectId: project.id, firstObjective: 'Weekly report' });
  await upsertMissionSchedule(first.id, DAILY_UTC_SCHEDULE);
  const done = (await listProjectStatuses(project.id)).find(status => status.key === 'done')!;

  await updateMission(first.id, { statusId: done.id });
  const afterDuplicate = await createMission({ projectId: project.id, firstObjective: 'Next' });

  const missions = await listMissions(project.id);
  const duplicate = missions.find(
    mission => mission.id !== first.id && mission.id !== afterDuplicate.id
  );
  assert.ok(duplicate, 'completing a scheduled mission spawns its duplicate');

  const numberOf = (displayId: string) => Number(displayId.split(':').at(-1));
  assert.deepEqual(
    [first, duplicate, afterDuplicate].map(mission => numberOf(mission.displayId)),
    [numberOf(first.displayId), numberOf(first.displayId) + 1, numberOf(first.displayId) + 2],
    'the duplicate and the next create draw consecutive numbers from one counter'
  );
}

for (const adapter of adapters) {
  describe(`mission schedules through the shared service [${adapter}]`, () => {
    it('upserts, reads, rejects, and clears a schedule from the REST transaction', async () => {
      const { cleanup } = await open(adapter);
      try {
        await runScheduleLifecycleCase();
      } finally {
        await cleanup();
      }
    });

    it('allocates the scheduled duplicate number from the shared counter', async () => {
      const { cleanup } = await open(adapter);
      try {
        await runScheduledDuplicateSequenceCase();
      } finally {
        await cleanup();
      }
    });
  });
}

after(() => {
  if (!process.env.TEST_DATABASE_URL) {
    console.warn(
      '[mission schedule postgres-conformance] TEST_DATABASE_URL not set — Postgres battery skipped; SQLite battery ran.'
    );
  }
});
