import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-shared-context-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db } = await import('./db.ts');
const { createMission, createProject, listMissionSharedContext, upsertMissionSharedContext } =
  await import('./repository.ts');
const { ApiError } = await import('./errors.ts');

test('lists empty shared context for a new mission', async () => {
  const project = await createProject({ name: `Shared ctx ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Track shared facts'
  });

  const entries = await listMissionSharedContext(mission.id);
  assert.deepEqual(entries, []);
});

test('upserts string and json shared context entries and emits entity changes', async () => {
  const project = await createProject({ name: `Shared ctx write ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Write shared facts'
  });

  const created = await upsertMissionSharedContext(mission.id, {
    key: 'repo.testing',
    value: 'yarn test'
  });
  assert.equal(created.key, 'repo.testing');
  assert.equal(created.value, 'yarn test');
  assert.equal(created.valueKind, 'string');
  assert.equal(created.revision, 1);
  assert.equal(created.missionId, mission.id);

  const updated = await upsertMissionSharedContext(mission.id, {
    key: 'repo.testing',
    value: { command: 'yarn test', suite: 'unit' }
  });
  assert.equal(updated.key, 'repo.testing');
  assert.deepEqual(updated.value, { command: 'yarn test', suite: 'unit' });
  assert.equal(updated.valueKind, 'json');
  assert.equal(updated.revision, 2);
  assert.equal(updated.id, created.id);

  const listed = await listMissionSharedContext(mission.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].key, 'repo.testing');
  assert.equal(listed[0].revision, 2);

  const changes = db
    .prepare(
      `SELECT entity_type, operation, entity_revision FROM entity_changes
        WHERE entity_id = ? ORDER BY occurred_at ASC, id ASC`
    )
    .all(created.id) as Array<{
    entity_type: string;
    operation: string;
    entity_revision: number;
  }>;
  assert.equal(changes.length, 2);
  assert.equal(changes[0].entity_type, 'shared_context_entry');
  assert.equal(changes[0].operation, 'insert');
  assert.equal(changes[0].entity_revision, 1);
  assert.equal(changes[1].operation, 'update');
  assert.equal(changes[1].entity_revision, 2);
});

test('rejects blank shared context keys', async () => {
  const project = await createProject({ name: `Shared ctx validation ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Validate shared facts'
  });

  await assert.rejects(
    () => upsertMissionSharedContext(mission.id, { key: '  ', value: 'x' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});
