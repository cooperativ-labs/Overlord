import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tempDir = mkdtempSync(path.join('/tmp', 'ovld-protocol-record-work-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
await bootstrapIntegrationTestDb({ sqlitePath: path.join(tempDir, 'webapp.sqlite') });

const { createProject, listMissionFileChanges } = await import('./repository.ts');
const { runProtocolSubcommand } = await import('./protocol.ts');
const { serviceDatabaseClient } = await import('./db.ts');
const { nowIso } = await import('../packages/core/service/util.ts');

// The web-server workspace ('local-workspace') needs its mission counter seeded
// before missions can be created through the protocol dispatch.
await serviceDatabaseClient().run(
  `INSERT OR IGNORE INTO mission_sequences
     (id, workspace_id, scope_type, scope_id, counter_name, next_value, updated_at)
   VALUES (?, 'local-workspace', 'workspace', 'local-workspace', 'mission', 1, ?)`,
  ['local-workspace-mission-seq', nowIso()]
);

type RecordWorkResult = { mission: { id: string }; deliveryId: string };

test('record-work accepts the whole submission as one --payload-json envelope', async () => {
  const project = await createProject({ name: 'Record Work Envelope' });

  // The objective, title, and declared paths all arrive inside the single
  // envelope — no --objective flag. This is the ergonomic path the shared
  // reference documents for chat connectors.
  const result = (await runProtocolSubcommand('record-work', {
    flags: {
      '--project-id': project.id,
      '--payload-json': JSON.stringify({
        objective: 'Built the export button the user asked for.',
        title: 'CSV export',
        summary: 'Added a CSV export control and the serializer behind it.',
        declaredPaths: ['src/export.ts', 'src/generated.ts']
      })
    }
  })) as RecordWorkResult;

  assert.ok(result.mission?.id, 'created a mission');
  assert.ok(result.deliveryId, 'created a delivery');

  const db = serviceDatabaseClient();
  const mission = (await db.get(`SELECT status_type, title FROM missions WHERE id = ?`, [
    result.mission.id
  ])) as { status_type: string; title: string } | undefined;
  assert.equal(mission?.status_type, 'review', 'mission lands in review');
  assert.equal(mission?.title, 'CSV export', 'title comes from the envelope');

  const files = (await db.all(
    `SELECT file_path FROM changed_files WHERE mission_id = ? ORDER BY file_path`,
    [result.mission.id]
  )) as Array<{ file_path: string }>;
  assert.deepEqual(
    files.map(f => f.file_path),
    ['src/export.ts', 'src/generated.ts'],
    'every explicitly declared path is recorded'
  );

  const projected = await listMissionFileChanges(result.mission.id);
  assert.deepEqual(
    projected.items.map(change => [change.filePath, change.source, change.resourceKey]).sort(),
    [
      ['src/export.ts', 'agent_declared', null],
      ['src/generated.ts', 'agent_declared', null]
    ]
  );
  assert.deepEqual(Object.keys(projected.items[0] ?? {}).sort(), [
    'filePath',
    'hookHealth',
    'id',
    'missionId',
    'objectiveId',
    'observedAt',
    'resourceKey',
    'source'
  ]);
});

test('record-work rejects retired rationale and changed-file inputs clearly', async () => {
  const project = await createProject({ name: 'Record Work Retired Inputs' });
  for (const retired of [
    { changeRationales: [] },
    { changedFiles: [{ filePath: 'src/a.ts', vcsStatus: 'M' }] }
  ]) {
    await assert.rejects(
      runProtocolSubcommand('record-work', {
        flags: {
          '--project-id': project.id,
          '--payload-json': JSON.stringify({
            objective: 'Retired input.',
            summary: 'Did something.',
            ...retired
          })
        }
      }),
      /Unsupported record-work payload field/
    );
  }
  await assert.rejects(
    runProtocolSubcommand('record-work', {
      flags: {
        '--project-id': project.id,
        '--objective': 'Retired flag.',
        '--summary': 'Did something.',
        '--change-rationales-json': '[]'
      }
    }),
    /Unsupported protocol flag/
  );
});

test('record-work rejects a submission with no objective anywhere', async () => {
  const project = await createProject({ name: 'Record Work No Objective' });
  await assert.rejects(
    runProtocolSubcommand('record-work', {
      flags: {
        '--project-id': project.id,
        '--payload-json': JSON.stringify({ summary: 'Did something.' })
      }
    }),
    /Missing objective text/
  );
});
