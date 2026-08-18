import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

// Guards per-mission branch recording end to end. The runner persists the prepared
// branch in `missions.active_branch` and records a human-readable audit event under
// the allowed `update` type — using a `branch_prepared` event type instead would
// violate the closed `mission_events.type` CHECK and fail every worktree launch.
describe('branch preparation recording', () => {
  it('persists the active branch and surfaces it on the mission detail DTO', async () => {
    const dir = mkdtempSync(path.join('/tmp', 'ovld-branch-prepared-'));
    const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });

    const { createProject, createMission, getMissionDetail, listMissionEvents } =
      await import('./repository.ts');
    const { recordBranchPrepared } = await import('./execution/runner.ts');

    const project = await createProject({ name: 'Branch Prepared Test' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Prepare a branch'
    });

    // Before any launch, the DTO predicts the canonical branch with a pending status.
    assert.equal((await getMissionDetail(mission.id)).branch?.status, 'pending');

    await recordBranchPrepared({
      missionId: mission.displayId,
      payload: {
        branchName: 'overlord/prepare-a-branch-1',
        baseBranch: 'main',
        worktreePath: '/tmp/.ovld/worktrees/branch-prepared/overlord-prepare-a-branch-1',
        resourceKey: 'primary-repo',
        action: 'create',
        cycle: 1
      }
    });

    const branch = (await getMissionDetail(mission.id)).branch;
    assert.equal(branch?.name, 'overlord/prepare-a-branch-1');
    assert.equal(branch?.baseBranch, 'main');
    // No real git checkout backs the test project, so the branch reads as created
    // (recorded but not inspectable, and not yet pushed or merged).
    assert.equal(branch?.status, 'created');

    // The audit entry is recorded under an allowed event type, not `branch_prepared`.
    const events = await listMissionEvents(mission.displayId);
    assert.ok(events.some(event => event.summary.includes('Prepared branch')));
    assert.ok(!events.some(event => event.type === 'branch_prepared'));
  });

  it('leaves the mission branch alone when an objective prepares an isolated branch', async () => {
    const dir = mkdtempSync(path.join('/tmp', 'ovld-branch-prepared-isolated-'));
    const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
    await bootstrapIntegrationTestDb({ sqlitePath: path.join(dir, 'Overlord.sqlite') });

    const { createProject, createMission, getMissionDetail, listMissionEvents } =
      await import('./repository.ts');
    const { recordBranchPrepared } = await import('./execution/runner.ts');

    const project = await createProject({ name: 'Isolated Branch Prepared Test' });
    const mission = await createMission({
      projectId: project.id,
      firstObjective: 'Prepare a branch'
    });

    await recordBranchPrepared({
      missionId: mission.displayId,
      payload: {
        branchName: 'prepare-a-branch-1',
        baseBranch: 'main',
        worktreePath: '/tmp/.ovld/worktrees/isolated/prepare-a-branch-1',
        resourceKey: 'primary-repo',
        action: 'create',
        cycle: 1
      }
    });

    // A parallel sibling's per-objective branch is that objective's checkout; the
    // mission keeps pointing at the shared branch so the next sequential objective
    // continues the mission's work rather than the sibling's isolated cycle.
    await recordBranchPrepared({
      missionId: mission.displayId,
      payload: {
        branchName: 'prepare-a-branch-1-q4t9',
        baseBranch: 'main',
        worktreePath: '/tmp/.ovld/worktrees/isolated/prepare-a-branch-1-q4t9',
        resourceKey: 'primary-repo',
        action: 'create',
        cycle: 1,
        isolated: true
      }
    });

    assert.equal((await getMissionDetail(mission.id)).branch?.name, 'prepare-a-branch-1');
    const events = await listMissionEvents(mission.displayId);
    assert.ok(
      events.some(event => event.summary.includes('Prepared isolated objective branch')),
      'the isolated preparation is still audited'
    );
  });
});
