import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('Everhour attribution migration retains distinct actors from historical inserts and updates', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE entity_changes (entity_type TEXT, entity_id TEXT, operation TEXT, actor_workspace_user_id TEXT);
      INSERT INTO entity_changes VALUES
        ('everhour:workspace_connection', 'c1', 'insert', 'a1'),
        ('everhour:workspace_connection', 'c1', 'update', 'a1'),
        ('everhour:workspace_connection', 'c1', 'update', 'a2'),
        ('everhour:workspace_connection', 'c1', 'delete', 'a3'),
        ('everhour:workspace_connection', 'c1', 'insert', NULL),
        ('other', 'c1', 'insert', 'a4');`);
    const sql = readFileSync(
      new URL(
        '../sqlite/migrations/20261121120000_ext_everhour_attribution_evidence.sql',
        import.meta.url
      ),
      'utf8'
    );
    db.exec(sql);
    db.exec(sql);
    assert.deepEqual(
      db
        .prepare(
          `SELECT connection_id, actor_workspace_user_id FROM ext_everhour_connection_attribution ORDER BY actor_workspace_user_id`
        )
        .all(),
      [
        { connection_id: 'c1', actor_workspace_user_id: 'a1' },
        { connection_id: 'c1', actor_workspace_user_id: 'a2' }
      ]
    );
  } finally {
    db.close();
  }
});
