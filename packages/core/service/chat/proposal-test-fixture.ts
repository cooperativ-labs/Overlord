import {
  createPostgresClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import { randomUUID } from 'node:crypto';

import { createProject } from '../projects.js';
import { seedServiceOperator } from '../test-helpers.js';

import { ChatAccess, overlordSourceChecker } from './access.js';
import { Conversations } from './conversations.js';

export const proposalOwner = { profileId: 'owner', organizationId: 'ws-a-org' };
export async function proposalFixture(
  adapter: string,
  fn: (db: DatabaseClient, c: Conversations, projects: string[]) => Promise<void>
) {
  let db: DatabaseClient, cleanup: () => Promise<void>;
  if (adapter === 'sqlite') {
    const raw = openInMemoryDatabase();
    db = createSqliteClient(raw);
    cleanup = async () => {
      raw.close();
    };
  } else {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `proposal_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    db = createPostgresClient(
      new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        options: `-c search_path=${schema}`,
        max: 5
      }),
      { ownsPool: true }
    );
    await migratePostgres(db);
    cleanup = async () => {
      await db.close();
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    };
  }
  try {
    for (const ws of ['ws-a', 'ws-b'])
      await seedServiceOperator({
        db,
        workspaceId: ws,
        profileId: 'owner',
        workspaceUserId: `${ws}-member`
      });
    await db.run("UPDATE workspaces SET organization_id = 'ws-a-org' WHERE id = 'ws-b'");
    const access = new ChatAccess(db);
    const grants = await access.grants(proposalOwner, 'mission:create');
    const projects: string[] = [];
    for (const grant of grants) {
      await db.run('UPDATE workspaces SET settings_json = ? WHERE id = ?', [
        JSON.stringify({
          agentCatalog: {
            agents: {
              codex: {
                models: [{ id: 'test-model', reasoningOptions: ['high'] }],
                defaultModel: 'test-model',
                defaultReasoningEffort: null,
                launchDefaults: { preCommand: 'CATALOG-PRIVATE-LAUNCH-COMMAND' }
              }
            }
          }
        }),
        grant.workspaceId
      ]);
      const p = await createProject({
        ctx: access.context(grant),
        name: `Project ${grant.workspaceId}`
      });
      projects.push(p.id);
      const now = new Date().toISOString();
      await db.run(
        "INSERT INTO project_resources (id, workspace_id, project_id, resource_key, is_primary, access_mode, status, created_at, updated_at) VALUES (?, ?, ?, 'primary', ?, 'read_write', 'active', ?, ?)",
        [randomUUID(), grant.workspaceId, p.id, db.dialect === 'sqlite' ? 1 : true, now, now]
      );
    }
    await fn(db, new Conversations(db, { checkSource: overlordSourceChecker(db) }), projects);
  } finally {
    await cleanup();
  }
}
