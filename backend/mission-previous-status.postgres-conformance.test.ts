import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  bindWebappDatabaseClient,
  conformanceAdapters,
  createConformanceDatabase
} from './test-helpers.ts';

const ambient = mkdtempSync(
  path.join(process.env.OVERLORD_TMPDIR || '/private/tmp', 'prior-status-ambient-')
);
process.env.OVERLORD_SQLITE_PATH = path.join(ambient, 'ambient.sqlite');

for (const adapter of conformanceAdapters()) {
  describe(`mission previous status [${adapter}]`, () => {
    it('records and clears the prior status across a completion', async () => {
      const { db, cleanup } = await createConformanceDatabase(adapter, 'ovld_prior_status');
      try {
        await bindWebappDatabaseClient({ client: db });
        const { createProject, createMission, listProjectStatuses, listMissions, updateMission } =
          await import('./repository.ts');
        const project = await createProject({ name: 'Prior status conformance' });
        const mission = await createMission({ projectId: project.id, firstObjective: 'Work' });
        const done = (await listProjectStatuses(project.id)).find(
          status => status.type === 'complete'
        );
        assert.ok(done);
        const completed = await updateMission(mission.id, { statusId: done.id });
        assert.equal(completed.previousStatusId, mission.statusId);
        assert.equal(
          (await listMissions(project.id)).find(item => item.id === mission.id)?.previousStatusId,
          mission.statusId
        );
        assert.equal(
          (await updateMission(mission.id, { statusId: mission.statusId })).previousStatusId,
          null
        );
      } finally {
        await cleanup();
      }
    });
  });
}
