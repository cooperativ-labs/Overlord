import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createMissionWithObjectives, moveMissionToReview } from './missions.js';
import { createProject } from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';

it('delivery places an assigned mission ahead of existing review work on its project board', async () => {
  const { db, ctx, workspaceUserId } = await createSeededServiceContext({ source: 'cli' });
  const project = await createProject({ ctx, name: 'Review ordering' });
  const { mission: first } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'First review' }]
  });
  await moveMissionToReview({ ctx, missionId: first.id });
  const { mission: delivered } = await createMissionWithObjectives({
    ctx,
    projectId: project.id,
    objectives: [{ objective: 'New delivery' }]
  });
  await db.run('UPDATE missions SET assigned_workspace_user_id = ? WHERE id = ?', [
    workspaceUserId,
    delivered.id
  ]);
  await moveMissionToReview({ ctx, missionId: delivered.id });
  const rows = await db.all<{
    id: string;
    status_type: string;
    assigned_workspace_user_id: string | null;
  }>(
    'SELECT id, status_type, assigned_workspace_user_id FROM missions WHERE project_id = ? ORDER BY board_position',
    [project.id]
  );
  assert.deepEqual(
    rows.map(row => row.id),
    [delivered.id, first.id]
  );
  assert.ok(rows.every(row => row.status_type === 'review'));
  assert.equal(rows[0]?.assigned_workspace_user_id, workspaceUserId);
});
