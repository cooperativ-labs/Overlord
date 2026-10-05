import { createSqliteClient, openInMemoryDatabase } from '@overlord/database';
import assert from 'node:assert/strict';
import { it } from 'node:test';

import { createChatEngine } from './chat/engine.ts';
import { instanceAgentCatalog, resolveWorkspaceAgentCatalog } from './agent-catalog.ts';

it('chat and launch resolve the same stored or instance catalog without seeding', async () => {
  const raw = openInMemoryDatabase();
  const db = createSqliteClient(raw);
  try {
    raw
      .prepare(
        "INSERT INTO organizations (id, name, created_at, updated_at) VALUES ('org', 'Org', '2026-10-05T12:00:00.000Z', '2026-10-05T12:00:00.000Z')"
      )
      .run();
    raw
      .prepare(
        "INSERT INTO workspaces (id, organization_id, slug, name, kind, created_at, updated_at) VALUES ('ws', 'org', 'ws', 'Ws', 'hosted', '2026-10-05T12:00:00.000Z', '2026-10-05T12:00:00.000Z')"
      )
      .run();
    const engine = createChatEngine({
      db,
      env: {},
      connections: () => {
        throw new Error('unused');
      }
    });
    const defaults = { agents: instanceAgentCatalog() };
    assert.ok(Object.keys(defaults.agents).length > 0);
    for (const settings of ['{}', '{broken', 'null', '{"agentCatalog":{"agents":null}}']) {
      raw.pragma('ignore_check_constraints = ON');
      raw.prepare('UPDATE workspaces SET settings_json = ? WHERE id = ?').run(settings, 'ws');
      assert.deepEqual(await resolveWorkspaceAgentCatalog(db, 'ws'), defaults);
      assert.ok(Object.keys((await engine.assignmentCatalog('ws')).agents).length > 0);
      assert.equal(
        (
          raw.prepare('SELECT settings_json FROM workspaces WHERE id = ?').get('ws') as {
            settings_json: string;
          }
        ).settings_json,
        settings
      );
    }
    const stored = {
      agents: { custom: { ...Object.values(defaults.agents)[0], label: 'Workspace custom' } }
    };
    raw
      .prepare('UPDATE workspaces SET settings_json = ? WHERE id = ?')
      .run(JSON.stringify({ agentCatalog: stored }), 'ws');
    assert.deepEqual(await resolveWorkspaceAgentCatalog(db, 'ws'), stored);
    assert.deepEqual(Object.keys((await engine.assignmentCatalog('ws')).agents), ['custom']);
    raw
      .prepare('UPDATE workspaces SET settings_json = ? WHERE id = ?')
      .run('{"agentCatalog":{"agents":{}}}', 'ws');
    assert.deepEqual(await resolveWorkspaceAgentCatalog(db, 'ws'), { agents: {} });
    assert.deepEqual(Object.keys((await engine.assignmentCatalog('ws')).agents), []);
    raw
      .prepare('UPDATE workspaces SET deleted_at = ? WHERE id = ?')
      .run('2026-10-05T12:00:00.000Z', 'ws');
    assert.deepEqual(await resolveWorkspaceAgentCatalog(db, 'ws'), defaults);
  } finally {
    raw.close();
  }
});
