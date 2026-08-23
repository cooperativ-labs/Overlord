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

  // The objective, title, and file-change arrays all arrive inside the single
  // envelope — no --objective flag. This is the ergonomic path the shared
  // reference documents for chat connectors.
  const result = (await runProtocolSubcommand('record-work', {
    flags: {
      '--project-id': project.id,
      '--payload-json': JSON.stringify({
        objective: 'Built the export button the user asked for.',
        title: 'CSV export',
        summary: 'Added a CSV export control and the serializer behind it.',
        changeRationales: [
          {
            filePath: 'src/export.ts',
            label: 'CSV serializer',
            summary: 'New CSV serializer.',
            why: 'Users need offline reports.',
            impact: 'Reports export as CSV.'
          }
        ],
        changedFiles: [{ filePath: 'src/generated.ts', vcsStatus: 'M' }]
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
    'both rationale-derived and explicit changed files are recorded'
  );

  const linked = (await db.get(
    `SELECT cf.id, cf.workspace_id, cf.project_id, cf.objective_id, cf.last_observed_at
       FROM changed_files cf
      WHERE cf.mission_id = ? AND cf.file_path = 'src/export.ts'`,
    [result.mission.id]
  )) as {
    id: string;
    workspace_id: string;
    project_id: string;
    objective_id: string;
    last_observed_at: string;
  };
  await db.run(
    `INSERT INTO change_rationales
       (id, workspace_id, project_id, mission_id, objective_id, changed_file_id, file_path,
        label, summary, why, impact, hunks_json, is_final, created_at, updated_at, revision)
     VALUES ('newest-rationale', ?, ?, ?, ?, ?, 'src/export.ts', 'Newest rationale',
             'Latest summary.', 'Latest reason.', 'Latest impact.', '[]', 0, ?, ?, 1)`,
    [
      linked.workspace_id,
      linked.project_id,
      result.mission.id,
      linked.objective_id,
      linked.id,
      '2099-01-01T00:00:00.000Z',
      '2099-01-01T00:00:00.000Z'
    ]
  );
  await db.run(
    `UPDATE changed_files SET observed_metadata_json = ?
       WHERE mission_id = ? AND file_path = 'src/export.ts'`,
    [
      JSON.stringify({
        source: 'declared_edit',
        quality: 'window',
        overlap: true,
        hookHealth: 'x'.repeat(161)
      }),
      result.mission.id
    ]
  );
  await db.run(
    `UPDATE changed_files SET observed_metadata_json = ?
       WHERE mission_id = ? AND file_path = 'src/generated.ts'`,
    [
      JSON.stringify({
        source: 'window_observed',
        quality: 'window',
        overlap: true,
        hookHealth: ' paired_hook_healthy '
      }),
      result.mission.id
    ]
  );
  const projected = await listMissionFileChanges(result.mission.id);
  assert.equal(projected.filter(change => change.filePath === 'src/export.ts').length, 1);
  assert.equal(
    projected.find(change => change.filePath === 'src/export.ts')?.label,
    'Newest rationale'
  );
  const invalidEvidence = projected.find(change => change.filePath === 'src/export.ts');
  assert.equal(invalidEvidence?.createdAt, linked.last_observed_at);
  assert.equal(invalidEvidence?.source, null);
  assert.equal(invalidEvidence?.quality, null);
  assert.equal(invalidEvidence?.overlap, false);
  assert.equal(invalidEvidence?.hookHealth, null);
  const validEvidence = projected.find(change => change.filePath === 'src/generated.ts');
  assert.equal(validEvidence?.source, 'window_observed');
  assert.equal(validEvidence?.quality, 'window');
  assert.equal(validEvidence?.overlap, true);
  assert.equal(validEvidence?.hookHealth, 'paired_hook_healthy');
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
