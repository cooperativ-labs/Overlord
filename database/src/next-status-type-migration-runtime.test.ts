import assert from 'node:assert/strict';
import test from 'node:test';

import { openInMemoryDatabase } from './connection.js';

test('the migrated schema enforces one next status per project', () => {
  const db = openInMemoryDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('next-org', 'Next', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at)
     VALUES ('next-workspace', 'next-org', 'next', 'Next', 'local', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO projects (id, workspace_id, slug, name, status, created_at, updated_at)
     VALUES ('next-project', 'next-workspace', 'next-project', 'Next Project', 'active', ?, ?)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO project_statuses
       (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, metadata_json, created_at, updated_at, revision)
     VALUES ('next-status', 'next-workspace', 'next-project', 'next_up', 'Next Up', 'next', 0, 0, 0, '{}', ?, ?, 1)`
  ).run(now, now);

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO project_statuses
           (id, workspace_id, project_id, key, name, type, position, is_default, is_terminal, metadata_json, created_at, updated_at, revision)
         VALUES ('other-next', 'next-workspace', 'next-project', 'also_next', 'Also next', 'next', 1, 0, 0, '{}', ?, ?, 1)`
        )
        .run(now, now),
    /UNIQUE/
  );
});
