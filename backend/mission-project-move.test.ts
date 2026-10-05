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
 * Adapter conformance for cross-project mission moves on the hosted-backend
 * Postgres path.
 *
 * The same battery runs against SQLite (always) and PostgreSQL (when
 * `TEST_DATABASE_URL` points at a reachable Postgres). Postgres must defer the
 * objectives `(project_id, mission_id)` FK so denormalized rows can repoint
 * before the mission row in one transaction.
 */

const adapters = conformanceAdapters();

/** SQLite keeps the suite's file-backed integration bootstrap; Postgres binds a conformance schema. */
async function open(adapter: ConformanceAdapter): Promise<{ cleanup: () => Promise<void> }> {
  if (adapter === 'sqlite') {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-project-move-'));
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });
    return { cleanup: async () => {} };
  }
  const handle = await createConformanceDatabase(adapter, 'ovld_move_test');
  await bindWebappDatabaseClient({ client: handle.db });
  return handle;
}

async function runMissionProjectMoveCase(): Promise<void> {
  const { createProject, createMission, updateMission, getMissionDetail, listProjectStatuses } =
    await import('./repository.ts');

  const p1 = await createProject({ name: 'Project A' });
  const p2 = await createProject({ name: 'Project B' });
  const mission = await createMission({ projectId: p1.id, firstObjective: 'Move me' });
  assert.equal(mission.projectId, p1.id);

  const updated = await updateMission(mission.id, { projectId: p2.id });
  assert.equal(updated.projectId, p2.id);
  const p2Default = (await listProjectStatuses(p2.id)).find(status => status.isDefault)!;
  assert.equal(updated.statusId, p2Default.id, 'the target project receives its matching status');

  const detail = await getMissionDetail(mission.id);
  assert.equal(detail.projectId, p2.id);
  assert.equal(detail.objectives.length, 1);
  assert.equal(detail.objectives[0]?.projectId, p2.id);

  const p2Execute = (await listProjectStatuses(p2.id)).find(status => status.type === 'execute')!;
  await assert.rejects(
    updateMission(mission.id, { projectId: p1.id, statusId: p2Execute.id }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
}

for (const adapter of adapters) {
  describe(`mission project move [${adapter}]`, () => {
    it('updates mission project_id via updateMission', async () => {
      const { cleanup } = await open(adapter);
      try {
        await runMissionProjectMoveCase();
      } finally {
        await cleanup();
      }
    });
  });
}

after(() => {
  if (!process.env.TEST_DATABASE_URL) {
    console.warn(
      '[mission project move postgres-conformance] TEST_DATABASE_URL not set — Postgres battery skipped; SQLite battery ran.'
    );
  }
});
