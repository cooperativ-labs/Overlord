import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ServiceContext } from './context.js';
import { createMissionWithObjectives } from './missions.js';
import { createProject, listProjectStatuses } from './projects.js';
import { attachSession, deliverSession, searchMissions } from './protocol.js';
import { createSeededServiceContext } from './test-helpers.js';

/**
 * Statuses are project-scoped (coo:752). These are the §10.4 regression tests:
 * the agent protocol is expressed entirely in status *types*, so attach and
 * deliver must keep landing a mission in its own project's execute / review
 * column even when two projects have deliberately diverged their status names.
 */

async function submittedMission(ctx: ServiceContext, projectId: string, label: string) {
  const { mission, objectives } = await createMissionWithObjectives({
    ctx,
    projectId,
    objectives: [{ objective: `Work for ${label}` }]
  });
  await ctx.db.run(`UPDATE objectives SET state = 'submitted' WHERE id = ?`, [objectives[0]?.id]);
  return mission;
}

/** Rename a project's column of one type, leaving its stable type untouched. */
async function renameStatus(
  ctx: ServiceContext,
  projectId: string,
  type: string,
  name: string
): Promise<void> {
  await ctx.db.run(
    `UPDATE project_statuses SET name = ? WHERE project_id = ? AND type = ? AND deleted_at IS NULL`,
    [name, projectId, type]
  );
}

async function statusNameOf(ctx: ServiceContext, missionId: string): Promise<string> {
  const row = (await ctx.db.get(
    `SELECT s.name FROM missions m
       JOIN project_statuses s ON s.id = m.status_id AND s.project_id = m.project_id
      WHERE m.id = ?`,
    [missionId]
  )) as { name: string } | undefined;
  assert.ok(row, 'mission status must resolve inside its own project');
  return row.name;
}

describe('listProjectStatuses', () => {
  it('returns one project’s statuses ordered by board position', async () => {
    const { ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Columns' });

    const statuses = await listProjectStatuses({ ctx, projectId: project.id });

    assert.ok(statuses.length > 0);
    assert.deepEqual(
      statuses.map(status => status.position),
      [...statuses.map(status => status.position)].sort((left, right) => left - right)
    );
    for (const status of statuses) assert.equal(status.projectId, project.id);
    assert.equal(statuses.filter(status => status.isDefault).length, 1);
    assert.ok(statuses.some(status => status.type === 'execute'));
    assert.ok(statuses.some(status => status.type === 'review'));
  });

  it('resolves the project by slug and by name, and reads each project’s own set', async () => {
    const { ctx } = await createSeededServiceContext({ source: 'cli' });
    const alpha = await createProject({ ctx, name: 'Alpha Board' });
    const beta = await createProject({ ctx, name: 'Beta Board' });
    await renameStatus(ctx, alpha.id, 'execute', 'Cooking');

    const bySlug = await listProjectStatuses({ ctx, projectId: alpha.slug });
    const byName = await listProjectStatuses({ ctx, projectId: 'Alpha Board' });
    const other = await listProjectStatuses({ ctx, projectId: beta.id });

    assert.deepEqual(
      bySlug.map(status => status.id),
      byName.map(status => status.id)
    );
    assert.ok(bySlug.some(status => status.name === 'Cooking'));
    // Beta was never edited: divergence is opt-in and strictly project-local.
    assert.ok(!other.some(status => status.name === 'Cooking'));
    assert.equal(other.filter(status => status.type === 'execute').length, 1);
  });
});

describe('agent protocol under diverged project statuses', () => {
  it('attach lands the mission in its own project’s execute status', async () => {
    const { ctx } = await createSeededServiceContext({ source: 'cli' });
    const alpha = await createProject({ ctx, name: 'Alpha' });
    const beta = await createProject({ ctx, name: 'Beta' });
    await renameStatus(ctx, alpha.id, 'execute', 'Cooking');
    await renameStatus(ctx, beta.id, 'execute', 'Doing');

    const alphaMission = await submittedMission(ctx, alpha.id, 'alpha');
    const betaMission = await submittedMission(ctx, beta.id, 'beta');

    await attachSession({ ctx, missionId: alphaMission.displayId, agentIdentifier: 'codex' });
    await attachSession({ ctx, missionId: betaMission.displayId, agentIdentifier: 'codex' });

    assert.equal(await statusNameOf(ctx, alphaMission.id), 'Cooking');
    assert.equal(await statusNameOf(ctx, betaMission.id), 'Doing');
  });

  it('deliver lands the mission in its own project’s review status', async () => {
    const { ctx } = await createSeededServiceContext({ source: 'cli' });
    const alpha = await createProject({ ctx, name: 'Alpha' });
    const beta = await createProject({ ctx, name: 'Beta' });
    await renameStatus(ctx, alpha.id, 'review', 'Needs Eyes');
    await renameStatus(ctx, beta.id, 'review', 'Checking');

    for (const [project, expected] of [
      [alpha, 'Needs Eyes'],
      [beta, 'Checking']
    ] as const) {
      const mission = await submittedMission(ctx, project.id, project.name);
      const attached = await attachSession({
        ctx,
        missionId: mission.displayId,
        agentIdentifier: 'codex'
      });
      await deliverSession({
        ctx,
        missionId: mission.displayId,
        sessionKey: attached.sessionKey,
        summary: `Delivered ${project.name}.`
      });
      assert.equal(await statusNameOf(ctx, mission.id), expected);
    }
  });

  it('search filters on status types, which do not vary between projects', async () => {
    const { ctx } = await createSeededServiceContext({ source: 'cli' });
    const alpha = await createProject({ ctx, name: 'Alpha' });
    const beta = await createProject({ ctx, name: 'Beta' });
    await renameStatus(ctx, alpha.id, 'execute', 'Cooking');
    await renameStatus(ctx, beta.id, 'execute', 'Doing');

    const executing = await submittedMission(ctx, alpha.id, 'alpha');
    const betaExecuting = await submittedMission(ctx, beta.id, 'beta');
    const idle = await submittedMission(ctx, alpha.id, 'idle');
    await attachSession({ ctx, missionId: executing.displayId, agentIdentifier: 'codex' });
    await attachSession({ ctx, missionId: betaExecuting.displayId, agentIdentifier: 'codex' });

    // One type CSV spans both projects despite their different column names.
    const found = await searchMissions({ ctx, statusTypes: ['execute'] });
    const foundIds = found.map(mission => mission.id).sort();
    assert.deepEqual(foundIds, [executing.id, betaExecuting.id].sort());
    assert.ok(!foundIds.includes(idle.id));

    // A project-defined status NAME is not a type and matches nothing.
    assert.deepEqual(await searchMissions({ ctx, statusTypes: ['Cooking'] }), []);
  });
});
