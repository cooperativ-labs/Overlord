import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-protocol-auto-advance-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'webapp.sqlite')
});

const { createProject, updateObjective } = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

type CreatedMission = {
  mission: { id: string };
  objectives: Array<{ id: string; autoAdvance: boolean; objective: string }>;
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

  const enabled = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objectiveId,
      '--auto-advance': true
    }
  })) as { id: string; autoAdvance: boolean };
  assert.equal(enabled.autoAdvance, true);

  const disabled = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objectiveId,
      '--no-auto-advance': true
    }
  })) as { id: string; autoAdvance: boolean };
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

  const draftUpdated = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': draftId,
      '--instruction-text': 'Revised draft instructions'
    }
  })) as { instructionText: string };
  assert.equal(draftUpdated.instructionText, 'Revised draft instructions');

  const futureUpdated = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': futureId,
      '--instruction-text': 'Revised future instructions'
    }
  })) as { instructionText: string };
  assert.equal(futureUpdated.instructionText, 'Revised future instructions');

  await updateObjective(draftId, { state: 'submitted' });
  await assert.rejects(
    () =>
      runProtocolSubcommand('update-objective', {
        flags: {
          '--objective-id': draftId,
          '--instruction-text': 'Too late'
        }
      }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});
