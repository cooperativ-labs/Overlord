import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-protocol-auto-advance-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const bootstrap = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});
const {
  getActiveWorkspace,
  serviceDatabaseClient,
  setAuthorizedWorkspacesContext,
  withRequestContextAsync
} = await import('./db.ts');

const { createProject, updateObjective } = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

async function asAuthenticatedOperator<T>(fn: () => Promise<T>): Promise<T> {
  return withRequestContextAsync(async () => {
    setAuthorizedWorkspacesContext({
      organizationId: 'test-organization',
      workspaces: [
        {
          workspaceId: getActiveWorkspace().id,
          workspaceUserId: bootstrap.operatorWorkspaceUserId,
          roleKeys: ['ADMIN'],
          workspace: getActiveWorkspace()
        }
      ]
    });
    return fn();
  });
}

type CreatedMission = {
  mission: { id: string };
  objectives: Array<{ id: string; displayId: string; autoAdvance: boolean; objective: string }>;
};

test('protocol create persists --auto-advance on a single objective', async () => {
  const project = await createProject({ name: `Auto advance create ${Date.now()}` });
  const result = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': 'Run the next step automatically',
      '--auto-advance': true
    }
  })) as CreatedMission;

  assert.equal(result.objectives.length, 1);
  assert.equal(result.objectives[0]?.autoAdvance, true);
});

test('protocol add-objectives persists per-item autoAdvance', async () => {
  const project = await createProject({ name: `Auto advance add ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': 'Existing draft'
    }
  })) as CreatedMission;

  const added = (await runProtocolSubcommand('add-objectives', {
    flags: {
      '--mission-id': created.mission.id,
      '--objectives-json': JSON.stringify([
        { objective: 'Auto follow-up', autoAdvance: true },
        { objective: 'Manual follow-up' }
      ])
    }
  })) as CreatedMission['objectives'];

  assert.equal(added[0]?.autoAdvance, true);
  assert.equal(added[1]?.autoAdvance, false);
});

test('protocol add-objectives persists per-item agent and model', async () => {
  const project = await createProject({ name: `Agent model add ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': 'Existing draft'
    }
  })) as CreatedMission;

  const added = (await runProtocolSubcommand('add-objectives', {
    flags: {
      '--mission-id': created.mission.id,
      '--objectives-json': JSON.stringify([
        { objective: 'Use Codex', agent: 'codex', model: 'gpt-5.6-terra' }
      ])
    }
  })) as CreatedMission['objectives'];

  const stored = await serviceDatabaseClient().get<{
    assigned_agent: string | null;
    model: string | null;
  }>(`SELECT assigned_agent, model FROM objectives WHERE id = ?`, [added[0]!.id]);
  assert.equal(stored?.assigned_agent, 'codex');
  assert.equal(stored?.model, 'gpt-5.6-terra');
});

test('agent queue commands keep legacy auto-advance work in mission-local queue order', async () => {
  const project = await createProject({ name: `Run Queue protocol ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objectives-json': JSON.stringify([
        { objective: 'First queued objective', autoAdvance: true },
        { objective: 'Second queued objective', autoAdvance: true }
      ])
    }
  })) as CreatedMission;
  const [first, second] = created.objectives;
  assert.ok(first);
  assert.ok(second);

  const initial = (await runProtocolSubcommand('run-queue', {
    flags: { '--project-id': project.id }
  })) as { queues: Array<{ entries: Array<{ id: string; objectiveId: string }> }> };
  assert.deepEqual(
    initial.queues.flatMap(queue => queue.entries).map(entry => entry.objectiveId),
    [first.id, second.id]
  );

  const moved = (await runProtocolSubcommand('queue-objective', {
    flags: { '--objective-id': second.displayId, '--front': true }
  })) as { objectiveId: string };
  assert.equal(moved.objectiveId, second.id);

  const reordered = (await runProtocolSubcommand('run-queue', {
    flags: { '--project-id': project.id }
  })) as { queues: Array<{ entries: Array<{ objectiveId: string }> }> };
  assert.deepEqual(
    reordered.queues.flatMap(queue => queue.entries).map(entry => entry.objectiveId),
    [second.id, first.id]
  );

  const dequeued = (await runProtocolSubcommand('dequeue-objective', {
    flags: { '--objective-id': second.displayId }
  })) as { removed: boolean; objectiveId: string };
  assert.deepEqual(dequeued, { removed: true, objectiveId: second.id });
});

test('protocol update-objective toggles auto-advance', async () => {
  const project = await createProject({ name: `Auto advance update ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objective': 'Existing draft'
    }
  })) as CreatedMission;
  const objectiveId = created.objectives[0]?.id;
  assert.ok(objectiveId);
  assert.equal(created.objectives[0]?.autoAdvance, false);

  const enabled = (await asAuthenticatedOperator(() =>
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': objectiveId,
        '--auto-advance': true
      }
    })
  )) as { id: string; autoAdvance: boolean };
  assert.equal(enabled.autoAdvance, true);

  const disabled = (await asAuthenticatedOperator(() =>
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': objectiveId,
        '--no-auto-advance': true
      }
    })
  )) as { id: string; autoAdvance: boolean };
  assert.equal(disabled.autoAdvance, false);
});

test('protocol update-objective edits instruction text on draft and future objectives', async () => {
  const project = await createProject({ name: `Instruction update ${Date.now()}` });
  const created = (await runProtocolSubcommand('create', {
    flags: {
      '--project-id': project.id,
      '--objectives-json': JSON.stringify([
        { objective: 'Draft slot' },
        { objective: 'Future slot' }
      ])
    }
  })) as CreatedMission;

  const draftId = created.objectives[0]?.id;
  const futureId = created.objectives[1]?.id;
  assert.ok(draftId);
  assert.ok(futureId);

  const draftUpdated = (await asAuthenticatedOperator(() =>
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': draftId,
        '--instruction-text': 'Revised draft instructions'
      }
    })
  )) as { instructionText: string };
  assert.equal(draftUpdated.instructionText, 'Revised draft instructions');

  const futureUpdated = (await asAuthenticatedOperator(() =>
    runProtocolSubcommand('update-objective', {
      flags: {
        '--objective-id': futureId,
        '--instruction-text': 'Revised future instructions'
      }
    })
  )) as { instructionText: string };
  assert.equal(futureUpdated.instructionText, 'Revised future instructions');

  await asAuthenticatedOperator(() => updateObjective(draftId, { state: 'submitted' }));
  await assert.rejects(
    () =>
      asAuthenticatedOperator(() =>
        runProtocolSubcommand('update-objective', {
          flags: {
            '--objective-id': draftId,
            '--instruction-text': 'Too late'
          }
        })
      ),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});
