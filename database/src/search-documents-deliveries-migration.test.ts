import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { openInMemoryDatabase } from './connection.js';

const sqliteMigrationPath = new URL(
  '../sqlite/migrations/20260820110000_search_documents_deliveries.sql',
  import.meta.url
);
const postgresMigrationPath = new URL(
  '../postgres/migrations/20260820110000_search_documents_deliveries.sql',
  import.meta.url
);
const now = '2026-08-19T00:00:00.000Z';

function seedWorkspace(db: ReturnType<typeof openInMemoryDatabase>, suffix: string): void {
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
     VALUES (?, 'org', ?, ?, 'local', ?, ?)`
  ).run(`workspace-${suffix}`, `workspace-${suffix}`, `Workspace ${suffix}`, now, now);
  db.prepare(
    `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    `project-${suffix}`,
    `workspace-${suffix}`,
    `project-${suffix}`,
    `Project ${suffix}`,
    now,
    now
  );
  db.prepare(
    `INSERT INTO project_statuses (
       id, workspace_id, project_id, key, name, type, position, is_default, is_terminal,
       created_at, updated_at
     ) VALUES (?, ?, ?, 'draft', 'Draft', 'draft', 0, 1, 0, ?, ?)`
  ).run(`status-${suffix}`, `workspace-${suffix}`, `project-${suffix}`, now, now);
  db.prepare(
    `INSERT INTO missions (
       id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type,
       constraints_text, output_format_text, notes_text, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 1, ?, ?, 'draft', ?, ?, ?, ?, ?)`
  ).run(
    `mission-${suffix}`,
    `workspace-${suffix}`,
    `project-${suffix}`,
    `workspace-${suffix}:1`,
    `Mission ${suffix}`,
    `status-${suffix}`,
    `constraint-${suffix}`,
    `format-${suffix}`,
    `note-${suffix}`,
    now,
    now
  );
  db.prepare(
    `INSERT INTO objectives (
       id, workspace_id, project_id, mission_id, display_key, position, title, instruction_text,
       state, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, 'Objective', 'Instruction', 'draft', ?, ?)`
  ).run(
    `objective-${suffix}`,
    `workspace-${suffix}`,
    `project-${suffix}`,
    `mission-${suffix}`,
    `key${suffix}`,
    now,
    now
  );
}

function deliveryDocument(
  db: ReturnType<typeof openInMemoryDatabase>,
  id: string
): { workspace_id: string; mission_id: string; body_text: string } | undefined {
  return db
    .prepare(
      `SELECT workspace_id, mission_id, body_text
         FROM search_documents
        WHERE entity_type = 'delivery' AND entity_id = ?`
    )
    .get(id) as { workspace_id: string; mission_id: string; body_text: string } | undefined;
}

test('delivery search documents backfill idempotently and stay synchronized [sqlite]', () => {
  const db = openInMemoryDatabase();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)`
  ).run(now, now);
  seedWorkspace(db, 'one');
  seedWorkspace(db, 'two');

  const report = JSON.stringify({
    deliveryReport: {
      agentReport: {
        humanActions: ['rotate public key'],
        knownRisks: ['cache warmup'],
        deferredWork: ['document rollout'],
        assumptions: ['staging matches production'],
        tradeoffsMade: [{ decision: 'kept the bounded index' }]
      }
    },
    ignored: 'must-not-be-indexed'
  });
  db.prepare(
    `INSERT INTO deliveries (
       id, workspace_id, project_id, mission_id, objective_id, summary, verification_summary,
       follow_up_notes, payload_json, delivered_at, created_at, updated_at
     ) VALUES ('delivery-one', 'workspace-one', 'project-one', 'mission-one', 'objective-one',
       'Summary one', 'Verified one', 'Follow-up one', ?, ?, ?, ?)`
  ).run(report, now, now, now);
  db.prepare(
    `INSERT INTO deliveries (
       id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
       delivered_at, created_at, updated_at
     ) VALUES ('delivery-long', 'workspace-one', 'project-one', 'mission-one', 'objective-one',
       ?, '{}', ?, ?, ?)`
  ).run('x'.repeat(20_100), now, now, now);

  const first = deliveryDocument(db, 'delivery-one');
  assert.equal(first?.workspace_id, 'workspace-one');
  assert.equal(first?.mission_id, 'mission-one');
  for (const expected of [
    'Summary one',
    'Verified one',
    'Follow-up one',
    'rotate public key',
    'cache warmup',
    'document rollout',
    'staging matches production',
    'kept the bounded index'
  ]) {
    assert.match(first?.body_text ?? '', new RegExp(expected));
  }
  assert.doesNotMatch(first?.body_text ?? '', /must-not-be-indexed/);
  assert.equal(deliveryDocument(db, 'delivery-long')?.body_text.length, 20_000);

  db.prepare(
    `UPDATE deliveries SET summary = 'Updated delivery summary', revision = revision + 1 WHERE id = 'delivery-one'`
  ).run();
  assert.match(deliveryDocument(db, 'delivery-one')?.body_text ?? '', /Updated delivery summary/);

  db.prepare(
    `UPDATE deliveries
        SET workspace_id = 'workspace-two', project_id = 'project-two', mission_id = 'mission-two',
            objective_id = 'objective-two', revision = revision + 1
      WHERE id = 'delivery-one'`
  ).run();
  const moved = deliveryDocument(db, 'delivery-one');
  assert.equal(moved?.workspace_id, 'workspace-two');
  assert.equal(moved?.mission_id, 'mission-two');
  assert.deepEqual(
    db
      .prepare(
        `SELECT count(*) AS count FROM search_documents
          WHERE workspace_id = 'workspace-one' AND entity_type = 'delivery' AND entity_id = 'delivery-one'`
      )
      .get() as { count: number },
    { count: 0 }
  );

  db.prepare(
    `UPDATE deliveries SET deleted_at = ?, revision = revision + 1 WHERE id = 'delivery-one'`
  ).run(now);
  assert.equal(deliveryDocument(db, 'delivery-one'), undefined);
  db.prepare(`DELETE FROM deliveries WHERE id = 'delivery-long'`).run();
  assert.equal(deliveryDocument(db, 'delivery-long'), undefined);

  // Recreate a pre-v98-looking index state. Trigger upserts are the same shape
  // as the migration backfill, so reapplying them must leave one document per
  // source row rather than duplicate documents.
  db.prepare(
    `INSERT INTO deliveries (
       id, workspace_id, project_id, mission_id, objective_id, summary, payload_json,
       delivered_at, created_at, updated_at
     ) VALUES ('delivery-backfill', 'workspace-one', 'project-one', 'mission-one', 'objective-one',
       'Backfill delivery', '{}', ?, ?, ?)`
  ).run(now, now, now);
  db.prepare(`DELETE FROM search_documents WHERE entity_type = 'delivery'`).run();
  db.prepare(
    `UPDATE search_documents SET body_text = 'old mission body' WHERE entity_type = 'mission'`
  ).run();

  db.prepare(`UPDATE missions SET revision = revision + 1 WHERE id = 'mission-one'`).run();
  db.prepare(`UPDATE deliveries SET revision = revision + 1 WHERE id = 'delivery-backfill'`).run();
  db.prepare(`UPDATE missions SET revision = revision + 1 WHERE id = 'mission-one'`).run();
  db.prepare(`UPDATE deliveries SET revision = revision + 1 WHERE id = 'delivery-backfill'`).run();
  assert.deepEqual(
    db
      .prepare(
        `SELECT count(*) AS count FROM search_documents WHERE entity_type = 'delivery' AND entity_id = 'delivery-backfill'`
      )
      .get(),
    { count: 1 }
  );
  const mission = db
    .prepare(
      `SELECT body_text FROM search_documents WHERE entity_type = 'mission' AND entity_id = 'mission-one'`
    )
    .get() as { body_text: string };
  assert.match(mission.body_text, /constraint-one/);
  assert.match(mission.body_text, /format-one/);
  assert.match(mission.body_text, /note-one/);
  assert.deepEqual(
    db
      .prepare(
        `SELECT count(*) AS count FROM sqlite_schema
          WHERE type = 'trigger' AND name IN ('trg_search_deliveries_ai', 'trg_search_deliveries_au',
            'trg_search_deliveries_soft_delete', 'trg_search_deliveries_ad')`
      )
      .get(),
    { count: 4 }
  );
  db.close();
});

test('Postgres and SQLite migrations preserve the v98 delivery-index contract', () => {
  const postgres = readFileSync(postgresMigrationPath, 'utf8');
  const sqlite = readFileSync(sqliteMigrationPath, 'utf8');
  for (const migration of [postgres, sqlite]) {
    assert.match(migration, /'mission', 'objective', 'event', 'delivery'/);
    assert.match(migration, /humanActions/);
    assert.match(migration, /knownRisks/);
    assert.match(migration, /deferredWork/);
    assert.match(migration, /assumptions/);
    assert.match(migration, /tradeoffsMade/);
    assert.match(migration, /20000/);
    assert.match(migration, /delivery/);
    assert.match(migration, /ON CONFLICT/);
  }
  assert.match(postgres, /NEW\.workspace_id IS DISTINCT FROM OLD\.workspace_id/);
  assert.match(sqlite, /new\.workspace_id AND entity_type = 'delivery'/);
});
