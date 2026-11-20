import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createPostgresClient, type DatabaseClient } from './client.js';
import { migratePostgres } from './migrate-postgres.js';

/**
 * Objective brief state (coo:1275, ADR 0057), Postgres half, driven through the
 * real runner on an upgraded database. Mirrors
 * `objective-brief-state-migration.test.ts`. Runs only with TEST_DATABASE_URL.
 */

const VERSION = '20261114180000';
const now = '2026-11-14T00:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;

const ROWS: Array<[string, string, string, boolean, boolean]> = [
  ['agent-unedited', 'agent', 'Agent text', false, false],
  ['agent-edited', 'agent', 'Agent text, edited later', false, true],
  ['human-unedited', 'human', 'Human text', false, false],
  ['automation-unedited', 'automation', 'Scheduled text', false, false],
  ['agent-blank', 'agent', '   ', false, false],
  ['agent-deleted', 'agent', 'Deleted text', true, false]
];

async function freshDatabase(url: string) {
  const pg = await import('pg');
  const Pool = (pg.default ?? pg).Pool;
  const name = `ovld_brief_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE DATABASE ${name}`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  const pool = new Pool({ connectionString: target.toString() });
  const client = createPostgresClient(pool, { ownsPool: true });
  return {
    client,
    teardown: async () => {
      await client.close();
      await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    }
  };
}

async function seed(client: DatabaseClient) {
  await client.exec(`
    INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', '${now}', '${now}');
    INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
      VALUES ('w', 'org', 'w', 'W', 'local', '${now}', '${now}');
    INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
      VALUES ('p', 'w', 'p', 'P', 'active', '${now}', '${now}');
    INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, created_at, updated_at)
      VALUES ('s', 'w', 'p', 'draft', 'Draft', 'draft', 0, true, false, '${now}', '${now}');
    INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at)
      VALUES ('m', 'w', 'p', 'w:1', 1, 'M', 's', 'draft', '${now}', '${now}');
  `);
  for (const [index, [id, kind, text, deleted, edited]] of ROWS.entries()) {
    await client.run(
      `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position, title,
         instruction_text, state, created_by_kind, created_at, updated_at, deleted_at, revision)
       VALUES (?, 'w', 'p', 'm', ?, ?, 'Custom title', ?, 'draft', ?, ?, ?, ?, 2)`,
      [id, `k${index}`, index, text, kind, now, now, deleted ? now : null]
    );
    await client.run(
      `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, changed_fields_json, source, occurred_at)
       VALUES (?, 'w', 'objective', ?, 'update', ?::jsonb, 'api', ?)`,
      [`c-title-${id}`, id, '["title"]', now]
    );
    if (edited) {
      await client.run(
        `INSERT INTO entity_changes (id, workspace_id, entity_type, entity_id, operation, changed_fields_json, source, occurred_at)
         VALUES (?, 'w', 'objective', ?, 'update', ?::jsonb, 'api', ?)`,
        [`c-text-${id}`, id, '["instruction_text","title"]', now]
      );
    }
  }
}

describe('objective brief state migration [postgres]', { skip: !connectionString }, () => {
  it('adds brief state with conservative defaults and backfills provable authorship', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client, { stopBeforeVersion: VERSION });
      await seed(client);
      const snapshot = () =>
        client.all(
          'SELECT id, title, instruction_text, revision, updated_at FROM objectives ORDER BY id'
        );
      const before = await snapshot();

      await migratePostgres(client);

      assert.deepEqual(await snapshot(), before);
      const rows = await client.all<Record<string, unknown>>(
        `SELECT id, title_source, title_generation, summary, summary_source,
                summary_suppressed, summary_generation, summary_revision,
                summary_status, instruction_author_kind
           FROM objectives ORDER BY id`
      );
      assert.deepEqual(Object.fromEntries(rows.map(r => [r.id, r.instruction_author_kind])), {
        'agent-blank': null,
        'agent-deleted': null,
        'agent-edited': null,
        'agent-unedited': 'agent',
        'automation-unedited': 'automation',
        'human-unedited': 'human'
      });
      for (const row of rows) {
        assert.equal(row.title_source, null);
        assert.equal(row.summary, null);
        assert.ok(!row.summary_suppressed, 'not suppressed');
        assert.equal(row.summary_status, null);
        assert.equal(Number(row.title_generation), 0);
        assert.equal(Number(row.summary_generation), 0);
        assert.equal(Number(row.summary_revision), 0);
      }

      for (const [column, value] of [
        ['title_source', 'model'],
        ['summary_source', 'person'],
        ['summary_status', 'ready'],
        ['summary_request_kind', 'manual'],
        ['instruction_author_kind', 'assistant'],
        ['summary_generation', -1]
      ] as const) {
        await assert.rejects(
          client.run(`UPDATE objectives SET ${column} = ? WHERE id = 'agent-unedited'`, [value]),
          /check constraint/i,
          column
        );
      }
      const ledger = await client.get<{ version: string }>(
        'SELECT version FROM schema_migrations WHERE version = ?',
        [VERSION]
      );
      assert.equal(ledger?.version, VERSION);
    } finally {
      await teardown();
    }
  });
});
