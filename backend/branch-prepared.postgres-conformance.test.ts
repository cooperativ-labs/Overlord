import { bindBool, type DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import {
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase,
  seedAuthenticatedOperatorClient
} from './test-helpers.ts';

/**
 * Conformance for the mission-level branch observation written when a runner
 * reports a prepared branch for an execution request (`recordBranchPrepared` →
 * `mission_branch_observations`). `dirty` is `boolean NOT NULL` on Postgres and
 * `INTEGER` on SQLite, so the write must bind it per dialect. This pins both the
 * insert and the update path on both adapters: a freshly prepared branch is
 * recorded clean, and re-preparing over a dirty observation resets it.
 *
 * Runs against SQLite always and PostgreSQL when `TEST_DATABASE_URL` is set.
 */

const adapters = conformanceAdapters();

const WORKSPACE_ID = 'branch-prepared-ws';
const WORKSPACE_USER_ID = 'branch-prepared-user';
const PROFILE_ID = 'branch-prepared-profile';
const ORGANIZATION_ID = 'branch-prepared-org';
const TARGET_ID = 'branch-prepared-target';

async function open(adapter: ConformanceAdapter) {
  const handle = await createConformanceDatabase(adapter, 'ovld_branchprep_test');
  const dbModule = await import('./db.ts');
  await dbModule.bindDatabaseClient(handle.db);
  return handle;
}

async function seedExecutionTarget(client: DatabaseClient): Promise<void> {
  const now = new Date().toISOString();
  await client.run(
    `INSERT INTO devices
       (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
        metadata_json, created_at, updated_at, revision)
     VALUES (?, ?, ?, 'branch-prepared', 'darwin', 'active', ?, '{}', ?, ?, 1)`,
    ['branch-prepared-device', WORKSPACE_ID, 'fp-branch-prepared', now, now, now]
  );
  await client.run(
    `INSERT INTO execution_targets
       (id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
        connection_json, created_at, updated_at, revision)
     VALUES (?, ?, ?, NULL, 'local', 'branch-prepared', 'active', '{}', ?, ?, 1)`,
    [TARGET_ID, WORKSPACE_ID, 'branch-prepared-device', now, now]
  );
}

async function seedClaimedRequest(
  client: DatabaseClient,
  {
    id,
    projectId,
    missionId,
    objectiveId
  }: { id: string; projectId: string; missionId: string; objectiveId: string }
): Promise<void> {
  const now = new Date().toISOString();
  await client.run(
    `INSERT INTO execution_requests
       (id, workspace_id, project_id, mission_id, objective_id, execution_target_id,
        claimed_by_execution_target_id, requested_agent, launch_mode,
        launch_flags_json, requested_source, status, metadata_json, created_at,
        updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'codex', 'run', '{}', 'webapp', 'claimed', '{}', ?, ?, 1)`,
    [id, WORKSPACE_ID, projectId, missionId, objectiveId, TARGET_ID, TARGET_ID, now, now]
  );
}

type ObservationRow = { dirty: boolean | number; status: string; worktree_path: string | null };

async function readObservation(
  client: DatabaseClient,
  missionId: string
): Promise<ObservationRow[]> {
  return client.all<ObservationRow>(
    `SELECT dirty, status, worktree_path FROM mission_branch_observations
      WHERE execution_target_id = ? AND mission_id = ? AND resource_key = ?`,
    [TARGET_ID, missionId, 'primary-repo']
  );
}

async function expectClean(
  client: DatabaseClient,
  missionId: string,
  row: ObservationRow
): Promise<void> {
  // Both clients surface booleans as `0 | 1` on read, so also match the row with a
  // dialect-bound `false`: on Postgres that is a real boolean comparison.
  assert.equal(row.dirty, 0);
  const matched = await client.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM mission_branch_observations
      WHERE execution_target_id = ? AND mission_id = ? AND dirty = ?`,
    [TARGET_ID, missionId, bindBool(client.dialect, false)]
  );
  assert.equal(Number(matched?.n), 1);
}

for (const adapter of adapters) {
  describe(`branch-prepared observation conformance [${adapter}]`, () => {
    it('records a prepared branch as a clean observation and resets a dirty one', async () => {
      const { db: client, cleanup } = await open(adapter);
      try {
        const dbModule = await import('./db.ts');
        const { createProject, createMission } = await import('./repository.ts');
        const { recordBranchPrepared } = await import('./execution/runner.ts');

        await seedAuthenticatedOperatorClient({
          client,
          organizationId: ORGANIZATION_ID,
          workspaceId: WORKSPACE_ID,
          profileId: PROFILE_ID,
          workspaceUserId: WORKSPACE_USER_ID
        });
        await seedExecutionTarget(client);

        const workspace = {
          id: WORKSPACE_ID,
          slug: WORKSPACE_ID,
          name: WORKSPACE_ID,
          kind: 'local'
        };
        const asOperator = <T>(fn: () => Promise<T>): Promise<T> =>
          dbModule.withRequestContextAsync(async () => {
            dbModule.setActiveProfileId(PROFILE_ID);
            dbModule.setAuthorizedWorkspacesContext({
              organizationId: ORGANIZATION_ID,
              workspaces: [
                {
                  workspaceId: WORKSPACE_ID,
                  workspaceUserId: WORKSPACE_USER_ID,
                  roleKeys: ['ADMIN'],
                  workspace
                }
              ]
            });
            dbModule.setActiveWorkspaceContext(workspace);
            dbModule.setActiveWorkspaceUser(WORKSPACE_USER_ID);
            return fn();
          });

        const mission = await asOperator(async () => {
          const project = await createProject({
            name: 'Branch Prepared Conformance',
            workspaceId: WORKSPACE_ID
          });
          return createMission({ projectId: project.id, firstObjective: 'Prepare a branch' });
        });
        const objectiveId = mission.objectives[0]!.id;

        await seedClaimedRequest(client, {
          id: 'branch-prepared-request-1',
          projectId: mission.projectId,
          missionId: mission.id,
          objectiveId
        });
        await asOperator(() =>
          recordBranchPrepared({
            missionId: mission.displayId,
            requestId: 'branch-prepared-request-1',
            payload: {
              branchName: 'overlord/prepare-a-branch-1',
              baseBranch: 'main',
              worktreePath: '/tmp/.ovld/worktrees/conformance/first',
              resourceKey: 'primary-repo',
              action: 'create',
              cycle: 1
            }
          })
        );

        const inserted = await readObservation(client, mission.id);
        assert.equal(inserted.length, 1);
        await expectClean(client, mission.id, inserted[0]!);
        assert.equal(inserted[0]!.status, 'created');
        assert.equal(inserted[0]!.worktree_path, '/tmp/.ovld/worktrees/conformance/first');

        // A client reported the checkout dirty since; a fresh preparation over the
        // same mission/target/resource takes the update path and records it clean.
        await client.run(
          `UPDATE mission_branch_observations SET dirty = ?, status = 'published'
            WHERE execution_target_id = ? AND mission_id = ?`,
          [bindBool(client.dialect, true), TARGET_ID, mission.id]
        );
        await seedClaimedRequest(client, {
          id: 'branch-prepared-request-2',
          projectId: mission.projectId,
          missionId: mission.id,
          objectiveId
        });
        await asOperator(() =>
          recordBranchPrepared({
            missionId: mission.displayId,
            requestId: 'branch-prepared-request-2',
            payload: {
              branchName: 'overlord/prepare-a-branch-2',
              baseBranch: 'main',
              worktreePath: '/tmp/.ovld/worktrees/conformance/second',
              resourceKey: 'primary-repo',
              action: 'new_cycle',
              cycle: 2
            }
          })
        );

        const updated = await readObservation(client, mission.id);
        assert.equal(updated.length, 1);
        await expectClean(client, mission.id, updated[0]!);
        assert.equal(updated[0]!.status, 'created');
        assert.equal(updated[0]!.worktree_path, '/tmp/.ovld/worktrees/conformance/second');
      } finally {
        await cleanup();
      }
    });
  });
}

after(() => {
  if (!process.env.TEST_DATABASE_URL) {
    console.error(
      '[branch-prepared postgres-conformance] TEST_DATABASE_URL not set — Postgres battery skipped; SQLite battery ran.'
    );
  }
});
