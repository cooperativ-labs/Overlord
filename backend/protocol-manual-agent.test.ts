import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The Manual executor (coo:1248): a person, not an agent, does the objective.
 * Web and iOS store it as `assignedAgent: 'manual'`; MCP and CLI callers reach
 * it through the same protocol subcommands exercised here.
 */
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-protocol-manual-agent-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createProject } = await import('./repository.ts');
const { ApiError } = await import('./errors.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');

type CreatedMission = {
  mission: { id: string };
  objectives: Array<{
    id: string;
    displayId: string;
    assignedAgent: string | null;
    model: string | null;
  }>;
};

type UpdatedObjective = {
  id: string;
  assignedAgent: string | null;
  model: string | null;
  reasoningEffort: string | null;
};

async function createMission(objectivesJson: unknown[]): Promise<CreatedMission> {
  const project = await createProject({ name: `Manual agent ${Date.now()} ${Math.random()}` });
  return (await runProtocolSubcommand('create', {
    flags: { '--project-id': project.id, '--objectives-json': JSON.stringify(objectivesJson) }
  })) as CreatedMission;
}

test('create assigns the Manual executor and folds the human alias onto manual', async () => {
  const created = await createMission([
    { objective: 'Call the vendor', agent: 'manual' },
    { objective: 'Sign the contract', agent: 'Human' }
  ]);
  assert.deepEqual(
    created.objectives.map(objective => objective.assignedAgent),
    ['manual', 'manual']
  );
});

test('create rejects a model on a Manual objective', async () => {
  await assert.rejects(
    createMission([{ objective: 'Review in person', agent: 'human', model: 'opus' }]),
    (error: unknown) => error instanceof Error && /takes no model/.test(error.message)
  );
});

test('update-objective reassigns between an agent and Manual', async () => {
  const created = await createMission([
    { objective: 'Start with an agent', agent: 'codex', model: 'gpt-5.6' }
  ]);
  const objective = created.objectives[0];
  assert.ok(objective);

  const toManual = (await runProtocolSubcommand('update-objective', {
    flags: { '--objective-id': objective.displayId, '--objective-agent': 'human' }
  })) as UpdatedObjective;
  assert.equal(toManual.assignedAgent, 'manual');
  assert.equal(toManual.model, null, 'switching agent clears the previous model');

  const backToAgent = (await runProtocolSubcommand('update-objective', {
    flags: {
      '--objective-id': objective.id,
      '--objective-agent': 'claude',
      '--objective-model': 'opus',
      '--objective-reasoning-effort': 'high'
    }
  })) as UpdatedObjective;
  assert.equal(backToAgent.assignedAgent, 'claude');
  assert.equal(backToAgent.model, 'opus');
  assert.equal(backToAgent.reasoningEffort, 'high');
});

test('update-objective validates the assignment flags', async () => {
  const created = await createMission([{ objective: 'Validate flags' }]);
  const objectiveId = created.objectives[0]?.id;
  assert.ok(objectiveId);

  const invalidFlagSets: Array<Record<string, string>> = [
    { '--objective-model': 'opus' },
    { '--objective-agent': '   ' },
    { '--objective-agent': 'manual', '--objective-model': 'opus' }
  ];
  for (const flags of invalidFlagSets) {
    await assert.rejects(
      runProtocolSubcommand('update-objective', {
        flags: { '--objective-id': objectiveId, ...flags }
      }),
      (error: unknown) => error instanceof ApiError && error.status === 400,
      JSON.stringify(flags)
    );
  }
});

test('launch-objective refuses the Manual executor', async () => {
  const created = await createMission([{ objective: 'Done by hand', agent: 'manual' }]);
  const objective = created.objectives[0];
  assert.ok(objective);

  for (const agent of ['manual', 'HUMAN']) {
    await assert.rejects(
      runProtocolSubcommand('launch-objective', {
        flags: { '--objective-id': objective.displayId, '--agent': agent }
      }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 400 &&
        error.code === 'manual_agent_not_launchable'
    );
  }
});
