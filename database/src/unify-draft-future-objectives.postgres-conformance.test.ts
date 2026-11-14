import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';

import { createPostgresClient, type DatabaseClient } from './client.js';
import { migratePostgres } from './migrate-postgres.js';

/**
 * Postgres half of the `future` retirement (coo:1274, ADR 0056), driven through
 * the real `migratePostgres` runner on an upgraded database: every `future`
 * row (live or soft-deleted) becomes `draft` with its evidence intact, the named
 * state CHECK is replaced, and indexes, foreign keys and RLS policies on
 * `objectives` are unchanged. Runs only with TEST_DATABASE_URL.
 */

const VERSION = '20261114120000';
const now = '2026-11-14T00:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;

async function freshDatabase(url: string) {
  const pg = await import('pg');
  const Pool = (pg.default ?? pg).Pool;
  const name = `ovld_unify_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
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
    INSERT INTO organizations (id, name, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000a1', 'Org', '${now}', '${now}');
    INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'w', 'W', 'local', '${now}', '${now}');
    INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'p', 'P', 'active', '${now}', '${now}');
    INSERT INTO project_statuses (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'draft', 'Draft', 'draft', 0, true, false, '${now}', '${now}');
    INSERT INTO missions (id, workspace_id, project_id, display_id, sequence_number, title, status_id, status_type, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'w:1', 1, 'M', '00000000-0000-0000-0000-0000000000d1', 'draft', '${now}', '${now}');
  `);
  const rows: Array<[string, string, number, string, string, string | null, number]> = [
    ['00000000-0000-0000-0000-000000000f01', 'aaaa', 0, 'did it', 'complete', null, 3],
    ['00000000-0000-0000-0000-000000000f02', 'bbbb', 1, 'next', 'draft', null, 1],
    ['00000000-0000-0000-0000-000000000f03', 'cccc', 2, 'later', 'future', null, 2],
    ['00000000-0000-0000-0000-000000000f04', 'dddd', 3, '', 'future', null, 1],
    ['00000000-0000-0000-0000-000000000f05', 'eeee', 4, 'deleted', 'future', now, 5]
  ];
  for (const [id, key, position, text, state, deletedAt, revision] of rows) {
    await client.run(
      `INSERT INTO objectives (id, workspace_id, project_id, mission_id, display_key, position, title,
         instruction_text, state, created_at, updated_at, deleted_at, revision)
       VALUES (?, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1',
         '00000000-0000-0000-0000-0000000000e1', ?, ?, 'T', ?, ?, ?, ?, ?, ?)`,
      [id, key, position, text, state, now, now, deletedAt, revision]
    );
  }
  await client.exec(`
    INSERT INTO objective_attachments (id, workspace_id, mission_id, objective_id, storage_backend, storage_key, filename, upload_status, metadata_json, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-000000000a11', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000f04', 'local_fs', 'synthetic/file', 'evidence.txt', 'available', '{}', '${now}', '${now}');
    INSERT INTO mission_events (id, workspace_id, project_id, mission_id, objective_id, type, summary, payload_json, source, created_at)
      VALUES ('00000000-0000-0000-0000-000000000a12', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000f04', 'update', 'Historical evidence', '{"state":"future"}', 'test', '${now}');
  `);
}

async function objectivesShape(client: DatabaseClient) {
  const indexes = await client.all<{ indexdef: string }>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'objectives' ORDER BY indexname`
  );
  const constraints = await client.all<{ conname: string; def: string }>(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'objectives'::regclass ORDER BY conname`
  );
  const referencing = await client.all<{ conname: string }>(
    `SELECT conname FROM pg_constraint WHERE confrelid = 'objectives'::regclass ORDER BY conname`
  );
  const policies = await client.all<{ policyname: string }>(
    `SELECT policyname FROM pg_policies WHERE tablename = 'objectives' ORDER BY policyname`
  );
  const rls = await client.get<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE oid = 'objectives'::regclass`
  );
  return { indexes, constraints, referencing, policies, rls };
}

describe('unify draft/future objectives migration [postgres]', { skip: !connectionString }, () => {
  it('converts every future row through the real runner and only swaps the state CHECK', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client, { stopBeforeVersion: VERSION });
      await seed(client);
      const before = await objectivesShape(client);
      const evidence = () =>
        Promise.all(
          ['objective_attachments', 'mission_events'].map(table =>
            client.all(`SELECT * FROM ${table} ORDER BY id`)
          )
        );
      const evidenceBefore = await evidence();

      await migratePostgres(client);
      assert.deepEqual(await evidence(), evidenceBefore);

      const rows = await client.all<{
        display_key: string;
        state: string;
        position: number;
        instruction_text: string;
        deleted_at: string | null;
        revision: number;
      }>(
        `SELECT display_key, state, position, instruction_text, deleted_at, revision
           FROM objectives ORDER BY position`
      );
      assert.deepEqual(
        rows.map(row => [
          row.display_key,
          row.state,
          row.position,
          row.instruction_text,
          row.revision
        ]),
        [
          ['aaaa', 'complete', 0, 'did it', 3],
          ['bbbb', 'draft', 1, 'next', 1],
          ['cccc', 'draft', 2, 'later', 3],
          ['dddd', 'draft', 3, '', 2],
          ['eeee', 'draft', 4, 'deleted', 6]
        ]
      );
      assert.ok(rows[4]!.deleted_at, 'soft-deleted row stays soft-deleted');

      const after = await objectivesShape(client);
      assert.deepEqual(after.indexes, before.indexes);
      assert.deepEqual(after.referencing, before.referencing);
      assert.deepEqual(after.policies, before.policies);
      assert.deepEqual(after.rls, before.rls);
      const withoutState = (shape: typeof before) =>
        shape.constraints.filter(constraint => constraint.conname !== 'objectives_state_check');
      assert.deepEqual(withoutState(after), withoutState(before));
      const stateCheck = after.constraints.find(c => c.conname === 'objectives_state_check');
      assert.ok(stateCheck && !stateCheck.def.includes('future'));

      await assert.rejects(
        client.run(`UPDATE objectives SET state = 'future' WHERE display_key = 'bbbb'`),
        /objectives_state_check/
      );
      const ledger = await client.get<{ version: string }>(
        `SELECT version FROM schema_migrations WHERE version = ?`,
        [VERSION]
      );
      assert.equal(ledger?.version, VERSION);
    } finally {
      await teardown();
    }
  });

  it('applies cleanly on a fresh database', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client);
      const check = await client.get<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'objectives'::regclass AND conname = 'objectives_state_check'`
      );
      assert.ok(check && !check.def.includes('future'));
    } finally {
      await teardown();
    }
  });

  it('rolls back a failed conversion and leaves the connection usable for retry', async () => {
    const { client, teardown } = await freshDatabase(connectionString!);
    try {
      await migratePostgres(client, { stopBeforeVersion: VERSION });
      await seed(client);
      const rowsBefore = await client.all('SELECT * FROM objectives ORDER BY id');
      const shapeBefore = await objectivesShape(client);
      await client.exec(`
        CREATE FUNCTION reject_conversion() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected conversion failure'; END $$;
        CREATE TRIGGER reject_conversion BEFORE UPDATE ON objectives FOR EACH ROW EXECUTE FUNCTION reject_conversion();
      `);
      await assert.rejects(migratePostgres(client), /injected conversion failure/);
      assert.deepEqual(await client.all('SELECT * FROM objectives ORDER BY id'), rowsBefore);
      assert.deepEqual(await objectivesShape(client), shapeBefore);
      assert.equal(
        await client.get('SELECT version FROM schema_migrations WHERE version = ?', [VERSION]),
        undefined
      );
      await client.exec(
        'DROP TRIGGER reject_conversion ON objectives; DROP FUNCTION reject_conversion();'
      );
      await migratePostgres(client);
      assert.equal(
        (await client.get<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM objectives WHERE state = 'future'"
        ))!.n,
        0
      );
    } finally {
      await teardown();
    }
  });
});
