import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test(
  'PostgreSQL cutover preserves historical evidence and delivery facts',
  {
    skip: !process.env.TEST_DATABASE_URL
  },
  async () => {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `ovld_upgrade_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);
      // The pre-cutover columns actually touched by the two migrations. The
      // separate adapter suite exercises the complete fresh migration chain.
      await client.query(`
      CREATE TABLE changed_files (
        id text PRIMARY KEY, objective_id text, resource_id text, file_path text,
        session_id text, deleted_at timestamptz, vcs_status text,
        current_diff_state text, observed_metadata_json jsonb NOT NULL,
        first_observed_at timestamptz, last_observed_at timestamptz
      );
      CREATE UNIQUE INDEX idx_changed_files_active_objective_path
        ON changed_files(objective_id, file_path) WHERE deleted_at IS NULL;
      CREATE TABLE agent_sessions (id text PRIMARY KEY);
      CREATE TABLE change_rationales (id text PRIMARY KEY);
      CREATE TABLE entity_changes (id text PRIMARY KEY, entity_type text);
      CREATE TABLE deliveries (id text PRIMARY KEY, summary text, payload_json jsonb);
      INSERT INTO agent_sessions VALUES ('session');
      INSERT INTO entity_changes VALUES ('retired', 'change_rationale'), ('keep', 'changed_file');
    `);
      const metadata = [
        { source: 'declared_edit', hookHealth: 'direct_path_observed', syncKeys: ['native'] },
        {
          source: 'declared_edit',
          hookHealth: 'agent_declared_generator_output',
          syncKeys: ['declared']
        },
        { source: 'window_observed', quality: 'window', syncKeys: ['unknown'] },
        {
          source: 'declared_edit',
          hookHealth: 'agent_declared_generator_output',
          syncKeys: ['ambiguous1', 'ambiguous2']
        }
      ];
      const stamp = '2026-10-01T00:00:00.000Z';
      for (const [index, value] of metadata.entries()) {
        await client.query(
          `INSERT INTO changed_files
        VALUES ($1, 'objective', 'primary', $2, 'session', NULL, 'M', 'present', $3, $4, $4)`,
          [String(index), `${index}.ts`, JSON.stringify(value), stamp]
        );
      }
      const payload = {
        changeRationales: [{ why: 'inert history' }],
        deliveryReport: {
          agentReport: { knownRisks: ['retained'] },
          presentation: {
            markdown: 'Historical summary',
            humanActions: [
              { id: 'keep', source: 'deterministic_rule' },
              { id: 'drop', source: 'change_rationale' }
            ],
            tradeoffsMade: [
              { id: 'agent', source: 'agent' },
              { id: 'drop', source: 'change_rationale' }
            ]
          }
        }
      };
      await client.query('INSERT INTO deliveries VALUES ($1, $2, $3)', [
        'delivery',
        'Original summary',
        payload
      ]);
      for (const name of [
        '20261024120000_changed_files_resource_provenance.sql',
        '20261024130000_delivery_reports_retire_change_rationale.sql'
      ]) {
        await client.query(
          readFileSync(new URL(`../postgres/migrations/${name}`, import.meta.url), 'utf8')
        );
      }
      const rows = (await client.query('SELECT * FROM changed_files ORDER BY id')).rows;
      assert.deepEqual(
        rows.map(row => row.source),
        ['declared_edit', 'agent_declared', null, null]
      );
      assert.deepEqual(
        rows.map(row => row.sync_keys_json),
        metadata.map(row => row.syncKeys)
      );
      assert.ok(rows.every(row => row.last_observed_at.toISOString() === stamp));
      assert.equal(
        (await client.query("SELECT to_regclass('change_rationales') AS name")).rows[0].name,
        null
      );
      assert.deepEqual((await client.query('SELECT id FROM entity_changes')).rows, [
        { id: 'keep' }
      ]);
      assert.equal(
        (await client.query('SELECT capture_binding_state FROM agent_sessions')).rows[0]
          .capture_binding_state,
        'unknown'
      );
      const delivery = (await client.query('SELECT * FROM deliveries')).rows[0];
      assert.equal(delivery.summary, 'Original summary');
      assert.deepEqual(
        delivery.payload_json.deliveryReport.agentReport,
        payload.deliveryReport.agentReport
      );
      assert.equal(
        delivery.payload_json.deliveryReport.presentation.markdown,
        'Historical summary'
      );
      assert.deepEqual(delivery.payload_json.deliveryReport.presentation.humanActions, [
        { id: 'keep', source: 'deterministic_rule' }
      ]);
      assert.deepEqual(delivery.payload_json.deliveryReport.presentation.tradeoffsMade, [
        { id: 'agent', source: 'agent' }
      ]);
      assert.deepEqual(delivery.payload_json.changeRationales, payload.changeRationales);
      await client.query(
        "INSERT INTO changed_files(id, objective_id, resource_id, file_path) VALUES ('mobile', 'objective', 'mobile', '0.ts')"
      );
      await assert.rejects(
        client.query(
          "INSERT INTO changed_files(id, objective_id, resource_id, file_path) VALUES ('duplicate', 'objective', 'primary', '0.ts')"
        ),
        /duplicate key/
      );
    } finally {
      await client.query('ROLLBACK');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    }
  }
);
