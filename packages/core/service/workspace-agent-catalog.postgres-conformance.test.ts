import {
  createPostgresClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it } from 'node:test';

import { readStoredWorkspaceAgentCatalog } from './workspace-agent-catalog.js';

const adapters = ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])];
for (const adapter of adapters) {
  it(`stored workspace catalog respects live rows and tolerates malformed settings [${adapter}]`, async () => {
    let db: DatabaseClient, cleanup: () => Promise<void>;
    if (adapter === 'sqlite') {
      const raw = openInMemoryDatabase();
      db = createSqliteClient(raw);
      cleanup = async () => raw.close();
    } else {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
      const session = await pool.connect();
      const schema = `workspace_catalog_${randomUUID().replaceAll('-', '')}`;
      await session.query(`CREATE SCHEMA ${schema}`);
      const scoped = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 2
      });
      db = createPostgresClient(scoped, { ownsPool: true });
      cleanup = async () => {
        await db.close();
        await session.query(`DROP SCHEMA ${schema} CASCADE`);
        session.release();
        await pool.end();
      };
    }
    try {
      if (adapter === 'postgres') {
        await migratePostgres(db);
        // Permit corrupt legacy JSON in this isolated schema to exercise the guard.
        await db.run('ALTER TABLE workspaces ALTER COLUMN settings_json DROP DEFAULT');
        await db.run(
          'ALTER TABLE workspaces ALTER COLUMN settings_json TYPE text USING settings_json::text'
        );
        await db.run("ALTER TABLE workspaces ALTER COLUMN settings_json SET DEFAULT '{}'");
      } else {
        await db.run('PRAGMA ignore_check_constraints = ON');
      }
      const stamp = '2026-10-05T12:00:00.000Z';
      await db.run(
        "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', ?, ?)",
        [stamp, stamp]
      );
      await db.run(
        "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', ?, ?)",
        [stamp, stamp]
      );
      assert.equal(await readStoredWorkspaceAgentCatalog(db, 'missing'), null);
      for (const settings of [
        '{broken',
        'null',
        '[]',
        '{}',
        '{"agentCatalog":{}}',
        '{"agentCatalog":false}',
        '{"agentCatalog":[]}',
        '{"agentCatalog":{"agents":null}}',
        '{"agentCatalog":{"agents":[]}}',
        '{"agentCatalog":{"agents":"invalid"}}'
      ]) {
        await db.run('UPDATE workspaces SET settings_json = ? WHERE id = ?', [settings, 'ws']);
        assert.equal(await readStoredWorkspaceAgentCatalog(db, 'ws'), null, settings);
      }
      const catalog = {
        agents: {
          custom: {
            label: 'Custom',
            availableByDefault: true,
            models: [
              { id: 'model', displayName: 'Model', reasoningOptions: ['high'], enabled: false }
            ],
            defaultModel: 'model',
            defaultReasoningEffort: 'high',
            reasoningLabel: 'Thinking',
            launchDefaults: { preCommand: 'prepare', flags: [] }
          }
        },
        updatedAt: stamp
      };
      for (const stored of [catalog, { agents: {} }]) {
        const settings = JSON.stringify({ agentCatalog: stored, unrelated: 'preserved' });
        await db.run('UPDATE workspaces SET settings_json = ? WHERE id = ?', [settings, 'ws']);
        assert.deepEqual(await readStoredWorkspaceAgentCatalog(db, 'ws'), stored);
        assert.equal(
          (
            await db.get<{ settings_json: string }>(
              'SELECT settings_json FROM workspaces WHERE id = ?',
              ['ws']
            )
          )?.settings_json,
          settings
        );
      }
      await db.run('UPDATE workspaces SET deleted_at = ? WHERE id = ?', [stamp, 'ws']);
      assert.equal(await readStoredWorkspaceAgentCatalog(db, 'ws'), null);
    } finally {
      await cleanup();
    }
  });
}
