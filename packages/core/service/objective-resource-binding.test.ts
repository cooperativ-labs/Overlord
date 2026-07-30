import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { createExecutionRequest } from './execution-requests.js';
import { ensureCallerDeviceTarget } from './execution-targets.js';
import { createMissionWithObjectives, insertObjective } from './missions.js';
import {
  addProjectResource,
  assertObjectiveResourceConnected,
  createProject,
  resolveObjectiveWorkingDirectory
} from './projects.js';
import { createSeededServiceContext } from './test-helpers.js';

// A co-located backend derives resource status by observing the checkout on disk,
// so a bound resource has to point at a directory that actually exists — a
// placeholder path resolves as `missing` and fails connection assertions.
function checkoutDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `${prefix}-`));
}

describe('objective resource binding', () => {
  it('resolves an objective-bound resource key before the project primary', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Cross-repo project' });
    const localTarget = await ensureCallerDeviceTarget({ ctx });
    const primaryDir = checkoutDir('overlord-primary');
    const mobileDir = checkoutDir('overlord-mobile');

    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: primaryDir,
      resourceKey: 'overlord',
      isPrimary: true
    });
    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: mobileDir,
      resourceKey: 'mobile',
      isPrimary: false
    });

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Work in mobile repo', resourceKey: 'mobile' }]
    });

    const resolved = await resolveObjectiveWorkingDirectory({
      ctx,
      projectId: project.id,
      objectiveResourceKey: objectives[0]?.resourceKey,
      executionTargetId: localTarget.executionTargetId
    });

    assert.equal(resolved.workingDirectory, mobileDir);
    assert.notEqual(resolved.resourceId, null);

    const request = await createExecutionRequest({
      ctx,
      missionId: mission.id,
      objectiveId: objectives[0]?.id,
      requestedAgent: 'codex',
      requestedSource: 'cli',
      executionTargetId: localTarget.executionTargetId
    });
    assert.equal(request.resolvedWorkingDirectory, mobileDir);

    await db.close();
  });

  it('fails with objective_resource_not_connected when the bound key is missing on the target', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Missing objective resource' });
    const localTarget = await ensureCallerDeviceTarget({ ctx });

    await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: checkoutDir('overlord-primary'),
      resourceKey: 'overlord',
      isPrimary: true
    });

    // The mobile key exists in the project but is linked only on another
    // device, so objective creation passes key validation while launch
    // resolution on this target must fail.
    const mobile = await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: checkoutDir('overlord-mobile'),
      resourceKey: 'mobile',
      isPrimary: false
    });
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO execution_targets (id, workspace_id, type, label, status, created_at, updated_at)
       VALUES ('other-target', ?, 'virtual', 'Other Device', 'active', ?, ?)`,
      [ctx.workspace.id, now, now]
    );
    // Contract v39 moved per-target linkage off `project_resources` and onto the
    // resource's `project_resource_sources` row, so re-homing the checkout means
    // re-pointing the source.
    await db.run(
      `UPDATE project_resource_sources SET execution_target_id = 'other-target' WHERE resource_id = ?`,
      [mobile.id]
    );

    const { mission, objectives } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Needs mobile checkout', resourceKey: 'mobile' }]
    });

    await assert.rejects(
      () =>
        assertObjectiveResourceConnected({
          ctx,
          projectId: project.id,
          resourceKey: 'mobile',
          executionTargetId: localTarget.executionTargetId
        }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'objective_resource_not_connected'
    );

    await assert.rejects(
      () =>
        createExecutionRequest({
          ctx,
          missionId: mission.id,
          objectiveId: objectives[0]?.id,
          requestedAgent: 'codex',
          requestedSource: 'cli',
          executionTargetId: localTarget.executionTargetId
        }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'objective_resource_not_connected'
    );

    await db.close();
  });

  it('rejects unknown resource keys when creating objectives', async () => {
    const { db, ctx } = await createSeededServiceContext({ source: 'cli' });
    const project = await createProject({ ctx, name: 'Unknown key validation' });
    const { mission } = await createMissionWithObjectives({
      ctx,
      projectId: project.id,
      objectives: [{ objective: 'Primary objective' }]
    });

    await assert.rejects(
      () =>
        insertObjective({
          ctx,
          missionId: mission.id,
          instructionText: 'Bound to missing key',
          resourceKey: 'missing-key',
          state: 'future'
        }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'project_resource_key_not_found'
    );

    await db.close();
  });
});
