import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-artifacts-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { db, nowIso } = await import('./db.ts');
const { createMission, createProject, createArtifact, updateArtifact } =
  await import('./repository.ts');
const { ApiError } = await import('./errors.ts');

async function createArtifactFixture(contentText: string | null = '# Initial artifact') {
  const project = await createProject({ name: `Artifacts ${Date.now()}` });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Review artifact' });
  const artifactId = `artifact-${crypto.randomUUID()}`;
  const now = nowIso();
  db.prepare(
    `INSERT INTO artifacts (
       id, workspace_id, project_id, mission_id, objective_id, type, label,
       content_text, content_json, external_url, created_at, updated_at, revision
     ) VALUES (?, ?, ?, ?, ?, 'note', 'Initial label', ?, '{"source":"agent"}', NULL, ?, ?, 1)`
  ).run(
    artifactId,
    mission.workspaceId,
    project.id,
    mission.id,
    mission.objectives[0].id,
    contentText,
    now,
    now
  );
  return { artifactId, mission };
}

test('updates editable artifact fields while retaining provenance and structured content', async () => {
  const { artifactId, mission } = await createArtifactFixture();

  const updated = await updateArtifact(mission.id, artifactId, {
    expectedRevision: 1,
    label: 'Release notes',
    contentText: '## Checks\n\n- **passed**',
    externalUrl: 'https://example.test/results'
  });

  assert.equal(updated.label, 'Release notes');
  assert.equal(updated.contentText, '## Checks\n\n- **passed**');
  assert.equal(updated.externalUrl, 'https://example.test/results');
  assert.deepEqual(updated.contentJson, { source: 'agent' });
  assert.equal(updated.revision, 2);

  const change = db
    .prepare(
      `SELECT entity_type, entity_id, entity_revision, changed_fields_json
         FROM entity_changes WHERE entity_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(artifactId) as {
    entity_type: string;
    entity_id: string;
    entity_revision: number;
    changed_fields_json: string;
  };
  assert.equal(change.entity_type, 'artifact');
  assert.equal(change.entity_id, artifactId);
  assert.equal(change.entity_revision, 2);
  assert.deepEqual(JSON.parse(change.changed_fields_json), [
    'label',
    'content_text',
    'external_url'
  ]);
});

test('rejects an edit that would leave an artifact without any content', async () => {
  const { artifactId, mission } = await createArtifactFixture();
  db.prepare(`UPDATE artifacts SET content_json = NULL WHERE id = ?`).run(artifactId);

  await assert.rejects(
    updateArtifact(mission.id, artifactId, { expectedRevision: 1, contentText: null }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test('rejects an artifact edit based on a stale revision', async () => {
  const { artifactId, mission } = await createArtifactFixture();
  await updateArtifact(mission.id, artifactId, { expectedRevision: 1, label: 'Current label' });

  await assert.rejects(
    updateArtifact(mission.id, artifactId, { expectedRevision: 1, label: 'Stale label' }),
    (error: unknown) => error instanceof ApiError && error.status === 409
  );
});

test('rejects an artifact edit with an unsafe external URL', async () => {
  const { artifactId, mission } = await createArtifactFixture();

  await assert.rejects(
    updateArtifact(mission.id, artifactId, {
      expectedRevision: 1,
      externalUrl: 'javascript:alert(1)'
    }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test('protocol update-artifact revises an existing artifact without a session', async () => {
  const { artifactId, mission } = await createArtifactFixture();
  const { runProtocolSubcommand } = await import('./protocol.ts');

  const updated = (await runProtocolSubcommand('update-artifact', {
    flags: {
      '--mission-id': mission.id,
      '--artifact-id': artifactId,
      '--expected-revision': '1',
      '--label': 'Revised plan',
      '--content-text': '## Updated\n\n- step one'
    }
  })) as {
    label: string;
    contentText: string | null;
    revision: number;
  };

  assert.equal(updated.label, 'Revised plan');
  assert.equal(updated.contentText, '## Updated\n\n- step one');
  assert.equal(updated.revision, 2);
});

test('creates a mid-turn artifact without a delivery', async () => {
  const project = await createProject({ name: `Create artifacts ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Publish plan mid-turn'
  });

  const created = await createArtifact(mission.id, {
    type: 'note',
    label: 'Implementation plan',
    contentText: '## Plan\n\n- step one',
    objectiveId: mission.objectives[0].id
  });

  assert.equal(created.type, 'note');
  assert.equal(created.label, 'Implementation plan');
  assert.equal(created.contentText, '## Plan\n\n- step one');
  assert.equal(created.deliveryId, null);
  assert.equal(created.objectiveId, mission.objectives[0].id);
  assert.equal(created.revision, 1);

  const change = db
    .prepare(
      `SELECT entity_type, operation, entity_revision
         FROM entity_changes WHERE entity_id = ? ORDER BY seq DESC LIMIT 1`
    )
    .get(created.id) as {
    entity_type: string;
    operation: string;
    entity_revision: number;
  };
  assert.equal(change.entity_type, 'artifact');
  assert.equal(change.operation, 'insert');
  assert.equal(change.entity_revision, 1);
});

test('rejects creating an artifact without content', async () => {
  const project = await createProject({ name: `Create empty ${Date.now()}` });
  const mission = await createMission({ projectId: project.id, firstObjective: 'Need content' });

  await assert.rejects(
    createArtifact(mission.id, { type: 'note', label: 'Empty' }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test('protocol add-artifact creates an artifact without a delivery', async () => {
  const project = await createProject({ name: `Protocol add ${Date.now()}` });
  const mission = await createMission({
    projectId: project.id,
    firstObjective: 'Add via protocol'
  });
  const { runProtocolSubcommand } = await import('./protocol.ts');

  const created = (await runProtocolSubcommand('add-artifact', {
    flags: {
      '--mission-id': mission.id,
      '--type': 'decision',
      '--label': 'Chosen approach',
      '--content-text': 'Use REST POST for mid-turn creates.',
      '--external-url': 'https://example.test/adr'
    }
  })) as {
    type: string;
    label: string;
    contentText: string | null;
    externalUrl: string | null;
    deliveryId: string | null;
    revision: number;
  };

  assert.equal(created.type, 'decision');
  assert.equal(created.label, 'Chosen approach');
  assert.equal(created.contentText, 'Use REST POST for mid-turn creates.');
  assert.equal(created.externalUrl, 'https://example.test/adr');
  assert.equal(created.deliveryId, null);
  assert.equal(created.revision, 1);
});
