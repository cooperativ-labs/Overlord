import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMissionWithObjectives, writeSharedContext } from './missions.js';
import { createProject } from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';

async function setup() {
  return createSeededServiceContext({ source: 'cli' });
}

describe('writeSharedContext', () => {
  it('inserts and updates an entry scoped to the caller workspace', async () => {
    const { db, ctx } = await setup();
    const project = await createProject({ ctx, name: 'Shared Context Write' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Track shared facts' }]
    });

    const created = await writeSharedContext({
      ctx,
      missionId: mission.id,
      key: 'repo.testing',
      value: 'yarn test'
    });
    assert.equal(created.key, 'repo.testing');
    assert.equal(created.value, 'yarn test');
    assert.equal(created.revision, 1);

    const updated = await writeSharedContext({
      ctx,
      missionId: mission.id,
      key: 'repo.testing',
      value: { command: 'yarn test', suite: 'unit' }
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.revision, 2);
    assert.deepEqual(updated.value, { command: 'yarn test', suite: 'unit' });

    const row = (await db.get(
      `SELECT workspace_id, revision, value_kind FROM shared_context_entries WHERE id = ?`,
      [created.id]
    )) as { workspace_id: string; revision: number; value_kind: string };
    assert.equal(row.workspace_id, ctx.workspace.id);
    assert.equal(row.revision, 2);
    assert.equal(row.value_kind, 'json');

    await db.close();
  });
});
