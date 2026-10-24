import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { loadBetterSqlite3 } from './better-sqlite3-loader.js';
import { openInMemoryDatabase } from './connection.js';

const SUMMARIES = '20261024140000_mission_summaries.sql';
const CUTOVER = '20261024140100_deferred_work_structured_cutover.sql';
const read = (dialect: 'sqlite' | 'postgres', file: string) =>
  readFileSync(new URL(`../${dialect}/migrations/${file}`, import.meta.url), 'utf8');

const now = '2026-10-24T00:00:00.000Z';

function seedMission(db: ReturnType<typeof openInMemoryDatabase>, suffix: string) {
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
  ).run(`org-${suffix}`, `Org ${suffix}`, now, now);
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', ?, ?)`
  ).run(`w-${suffix}`, `org-${suffix}`, `w-${suffix}`, `W ${suffix}`, now, now);
  db.prepare(
    `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(`p-${suffix}`, `w-${suffix}`, `p-${suffix}`, `P ${suffix}`, now, now);
  db.prepare(
    `INSERT INTO project_statuses (
       id, workspace_id, project_id, key, name, type, position, is_default, is_terminal,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'draft', 'Draft', 'draft', 0, 1, 0, ?, ?)`
  ).run(`s-${suffix}`, `w-${suffix}`, `p-${suffix}`, now, now);
  db.prepare(
    `INSERT INTO missions (
       id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, 'draft', ?, ?)`
  ).run(
    `m-${suffix}`,
    `w-${suffix}`,
    `p-${suffix}`,
    `w-${suffix}:1`,
    `M ${suffix}`,
    `s-${suffix}`,
    now,
    now
  );
  db.prepare(
    `INSERT INTO objectives (
       id, workspace_id, project_id, mission_id, display_key, position, title, state,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'abcd', 0, 'Objective', 'complete', ?, ?)`
  ).run(`o-${suffix}`, `w-${suffix}`, `p-${suffix}`, `m-${suffix}`, now, now);
  return {
    workspaceId: `w-${suffix}`,
    projectId: `p-${suffix}`,
    missionId: `m-${suffix}`,
    objectiveId: `o-${suffix}`
  };
}

test('fresh database: new missions are summary-eligible and both summary tables exist', () => {
  const db = openInMemoryDatabase();
  const seeded = seedMission(db, 'fresh');
  const mission = db
    .prepare(`SELECT summary_enabled FROM missions WHERE id = ?`)
    .get(seeded.missionId) as { summary_enabled: number };
  assert.equal(mission.summary_enabled, 1);

  db.prepare(
    `INSERT INTO mission_summaries
       (mission_id, workspace_id, project_id, status, generated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', 'deterministic', ?, ?)`
  ).run(seeded.missionId, seeded.workspaceId, seeded.projectId, now, now);
  const shell = db
    .prepare(`SELECT * FROM mission_summaries WHERE mission_id = ?`)
    .get(seeded.missionId) as Record<string, unknown>;
  assert.equal(shell.revision, 1);
  assert.equal(shell.requested_generation, 0);
  assert.equal(shell.completed_generation, 0);
  assert.equal(shell.headline, '');
  assert.equal(shell.risks_json, '[]');
  assert.equal(shell.suggestions_json, '[]');
  assert.equal(shell.generated_at, null);
  assert.throws(() =>
    db
      .prepare(`UPDATE mission_summaries SET status = 'stale' WHERE mission_id = ?`)
      .run(seeded.missionId)
  );
  assert.ok(
    db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'mission_summary_seen'`).get(),
    'mission_summary_seen exists'
  );
});

test('summary migration marks only pre-existing missions ineligible', () => {
  const db = new (loadBetterSqlite3())(':memory:');
  db.exec(`
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE workspace_users (id TEXT PRIMARY KEY);
    CREATE TABLE missions (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO missions VALUES ('old-1', 'a'), ('old-2', 'b');
  `);
  db.exec(read('sqlite', SUMMARIES));
  db.prepare(`INSERT INTO missions (id, title) VALUES ('new', 'c')`).run();
  const rows = db.prepare(`SELECT id, summary_enabled FROM missions ORDER BY id`).all();
  assert.deepEqual(rows, [
    { id: 'new', summary_enabled: 1 },
    { id: 'old-1', summary_enabled: 0 },
    { id: 'old-2', summary_enabled: 0 }
  ]);
});

test('cutover clears historical deferred work and its resolutions, keeping other evidence', () => {
  const db = openInMemoryDatabase();
  const seeded = seedMission(db, 'cutover');
  const legacyPayload = {
    other: 'kept',
    deliveryReport: {
      schemaVersion: 1,
      agentReport: {
        humanActions: [],
        tradeoffsMade: [],
        knownRisks: ['Retention filters are untested'],
        deferredWork: ['Add the audit-log export'],
        assumptions: ['The exporter runs nightly']
      },
      presentation: {
        status: 'composed',
        markdown: 'Composed.',
        humanActions: [],
        tradeoffsMade: [],
        knownRisks: ['Retention filters are untested'],
        deferredWork: ['Add the audit-log export with retention filters'],
        assumptions: ['The exporter runs nightly'],
        generatedBy: 'gemini'
      }
    }
  };
  const insertDelivery = db.prepare(
    `INSERT INTO deliveries
       (id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
        delivered_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertDelivery.run(
    'd-legacy',
    seeded.workspaceId,
    seeded.projectId,
    seeded.missionId,
    seeded.objectiveId,
    'Delivered the exporter.',
    JSON.stringify(legacyPayload),
    now,
    now,
    now
  );
  insertDelivery.run(
    'd-plain',
    seeded.workspaceId,
    seeded.projectId,
    seeded.missionId,
    seeded.objectiveId,
    'Plain delivery.',
    '{}',
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO human_action_resolutions
       (delivery_id, action_id, workspace_id, mission_id, objective_id, status, resolved_at)
     VALUES ('d-legacy', 'deferred-work-0-0123456789abcdef', ?, ?, ?, 'done', ?)`
  ).run(seeded.workspaceId, seeded.missionId, seeded.objectiveId, now);
  const searchBody = () =>
    (
      db
        .prepare(
          `SELECT body_text FROM search_documents WHERE entity_type = 'delivery' AND entity_id = 'd-legacy'`
        )
        .get() as { body_text: string }
    ).body_text;
  // Stand-in for the pre-cutover trigger, which indexed string items verbatim.
  db.prepare(
    `UPDATE search_documents SET body_text = body_text || ' Add the audit-log export'
      WHERE entity_type = 'delivery' AND entity_id = 'd-legacy'`
  ).run();
  assert.match(searchBody(), /audit-log export/);

  // Already applied on the fresh database; the migration is safe to replay.
  db.exec(read('sqlite', CUTOVER));

  const payload = JSON.parse(
    (
      db.prepare(`SELECT payload_json FROM deliveries WHERE id = 'd-legacy'`).get() as {
        payload_json: string;
      }
    ).payload_json
  );
  assert.deepEqual(payload.deliveryReport.agentReport.deferredWork, []);
  assert.deepEqual(payload.deliveryReport.presentation.deferredWork, []);
  assert.deepEqual(payload.deliveryReport.agentReport.knownRisks, [
    'Retention filters are untested'
  ]);
  assert.equal(payload.deliveryReport.presentation.markdown, 'Composed.');
  assert.equal(payload.other, 'kept');
  assert.equal(
    (
      db.prepare(`SELECT payload_json FROM deliveries WHERE id = 'd-plain'`).get() as {
        payload_json: string;
      }
    ).payload_json,
    '{}'
  );
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM human_action_resolutions`).get() as { n: number }).n,
    0
  );
  assert.doesNotMatch(searchBody(), /audit-log export/);
  assert.match(searchBody(), /Retention filters are untested/);

  // New structured items are indexed by their fields, not their JSON text.
  payload.deliveryReport.agentReport.deferredWork = [
    {
      id: 'deferred-work-0-feedfacefeedface',
      title: 'Advance the fake clock',
      change: 'The retry test never advances time.',
      location: 'backend/sync-worker.test.ts',
      doneWhen: 'The test passes 20 runs.'
    }
  ];
  db.prepare(`UPDATE deliveries SET payload_json = ? WHERE id = 'd-legacy'`).run(
    JSON.stringify(payload)
  );
  assert.match(searchBody(), /Advance the fake clock The retry test never advances time\./);
  assert.doesNotMatch(searchBody(), /"title"/);
});

test('PostgreSQL migrations mirror the SQLite semantics', () => {
  const summaries = read('postgres', SUMMARIES);
  assert.match(summaries, /summary_enabled boolean NOT NULL DEFAULT false/);
  assert.match(summaries, /ALTER COLUMN summary_enabled SET DEFAULT true/);
  assert.match(summaries, /CREATE TABLE IF NOT EXISTS mission_summaries/);
  assert.match(summaries, /CREATE TABLE IF NOT EXISTS mission_summary_seen/);
  const cutover = read('postgres', CUTOVER);
  assert.match(
    cutover,
    /DELETE FROM human_action_resolutions WHERE action_id LIKE 'deferred-work-%'/
  );
  assert.match(cutover, /\{deliveryReport,agentReport,deferredWork\}/);
  assert.match(cutover, /\{deliveryReport,presentation,deferredWork\}/);
  assert.match(cutover, /item ->> 'title'/);
});
