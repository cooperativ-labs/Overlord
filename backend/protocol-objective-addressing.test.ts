import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-objective-addressing-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createMission, createProject } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { ApiError } = await import('./errors.ts');

type ObjectiveRow = { id: string; displayId: string };

async function missionFixture(label: string): Promise<{
  missionDisplayId: string;
  objective: ObjectiveRow;
}> {
  const project = await createProject({ name: `${label} ${Date.now()}` });
  const mission = (await createMission({
    projectId: project.id,
    firstObjective: label
  })) as unknown as { displayId: string; objectives: ObjectiveRow[] };
  return { missionDisplayId: mission.displayId, objective: mission.objectives[0]! };
}

/**
 * The protocol surface has to derive the mission from an objective display id
 * on the server, not only in the CLI: hosted MCP and any direct REST caller
 * reach these handlers with an untouched body.
 */
test('protocol commands accept an objective display id with no --mission-id', async () => {
  const { objective } = await missionFixture('Objective-only addressing');

  const context = (await runProtocolSubcommand('load-context', {
    flags: { '--objective-id': objective.displayId }
  })) as { mission: { displayId: string }; objective: { id: string; displayId: string } };

  assert.equal(context.objective.id, objective.id);
  assert.equal(context.objective.displayId, objective.displayId);
  assert.equal(
    `${context.mission.displayId}.${objective.displayId.split('.')[1]}`,
    objective.displayId
  );
});

test('an explicit --mission-id still wins over the derived one', async () => {
  const { missionDisplayId, objective } = await missionFixture('Explicit mission wins');

  const context = (await runProtocolSubcommand('load-context', {
    flags: { '--mission-id': missionDisplayId, '--objective-id': objective.displayId }
  })) as { mission: { displayId: string }; objective: { id: string } };

  assert.equal(context.mission.displayId, missionDisplayId);
  assert.equal(context.objective.id, objective.id);
});

test('an objective UUID cannot stand in for a mission id', async () => {
  const { objective } = await missionFixture('UUID needs a mission');

  // A UUID names no parent, so the handler must say so rather than 404 on a
  // mission lookup the caller never made.
  await assert.rejects(
    runProtocolSubcommand('load-context', { flags: { '--objective-id': objective.id } }),
    (error: unknown) =>
      error instanceof ApiError && error.status === 400 && error.message.includes('--mission-id')
  );
});

test('protocol add-artifact stamps objective provenance from a display id', async () => {
  const { missionDisplayId, objective } = await missionFixture('Artifact provenance');

  const created = (await runProtocolSubcommand('add-artifact', {
    flags: {
      '--mission-id': missionDisplayId,
      '--objective-id': objective.displayId,
      '--type': 'note',
      '--label': 'Mid-turn note',
      '--content-text': 'Recorded without a live session key.'
    }
  })) as { objectiveId: string | null; sessionId: string | null };

  assert.equal(created.objectiveId, objective.id);
  assert.equal(created.sessionId, null);
});

test('missing both --mission-id and --objective-id names both in the error', async () => {
  await assert.rejects(
    runProtocolSubcommand('load-context', { flags: {} }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.message.includes('--mission-id') &&
      error.message.includes('--objective-id')
  );
});
