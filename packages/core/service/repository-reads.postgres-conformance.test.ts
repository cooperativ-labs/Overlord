import {
  createPostgresSessionClient,
  createSqliteClient,
  type DatabaseClient,
  migratePostgres,
  openInMemoryDatabase
} from '@overlord/database';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { InProcessProvider } from './local-target/in-process-provider.ts';
import { createServiceContext, type ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { claimNextExecutionRequest } from './execution-requests.ts';
import { recordRunnerHeartbeat } from './execution-target-runners.ts';
import { executeLocalTargetMutation } from './local-target-mutation-runner.ts';
import {
  completeLocalTargetMutationRequest,
  parseLocalTargetMutation
} from './local-target-mutations.ts';
import { createProject } from './projects.ts';
import { parseRepositoryReadRequest, performRepositoryRead } from './repository-reads.ts';
import { seedServiceOperator } from './test-helpers.ts';
import { newId, nowIso } from './util.ts';

/**
 * Repository reads (coo:1108.zg8m) on both editions: a remote target holding
 * two resources, the gateway queueing a mission-less read for the non-primary
 * one, the real claim resolving that resource (not the primary) to a
 * directory, and the stored result coming back — plus operation-id reuse.
 */

interface Adapter {
  label: string;
  create: () => Promise<{ client: DatabaseClient; teardown: () => Promise<void> }>;
}

const adapters: Adapter[] = [
  {
    label: 'sqlite',
    create: async () => {
      const client = createSqliteClient(openInMemoryDatabase());
      await seedServiceOperator({ db: client });
      return { client, teardown: () => client.close() };
    }
  }
];
const pgUrl = process.env.TEST_DATABASE_URL;
if (pgUrl) {
  adapters.push({
    label: 'postgres',
    create: async () => {
      const pg = await import('pg');
      const Pool = (pg.default ?? pg).Pool;
      const schema = `ovld_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const admin = new Pool({ connectionString: pgUrl });
      await admin.query(`CREATE SCHEMA ${schema}`);
      const scoped = new Pool({ connectionString: pgUrl });
      const session = await scoped.connect();
      await session.query(`SET search_path TO ${schema}`);
      const client = createPostgresSessionClient(session);
      await migratePostgres(client);
      await seedServiceOperator({ db: client });
      return {
        client,
        teardown: async () => {
          session.release();
          await scoped.end();
          await admin.query(`DROP SCHEMA ${schema} CASCADE`);
          await admin.end();
        }
      };
    }
  });
}

function gitRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-rr-conf-'));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'T',
    GIT_AUTHOR_EMAIL: 't@e',
    GIT_COMMITTER_NAME: 'T',
    GIT_COMMITTER_EMAIL: 't@e'
  };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: dir, env });
  return dir;
}

/** A remote target (not this machine) with a live runner and two linked resources. */
async function seedRemoteTarget(ctx: ServiceContext) {
  const now = nowIso();
  const project = await createProject({ ctx, name: `Reads ${randomUUID().slice(0, 6)}` });
  const deviceId = newId();
  const executionTargetId = newId();
  await ctx.db.run(
    `INSERT INTO devices (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
        metadata_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, 'Remote Mac', 'darwin', 'active', ?, '{}', ?, ?, 1)`,
    [deviceId, ctx.workspace.id, `fp-${randomUUID()}`, now, now, now]
  );
  await ctx.db.run(
    `INSERT INTO execution_targets (id, workspace_id, device_id, owner_workspace_user_id, type,
        label, status, connection_json, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, 'local', 'Remote Mac', 'active', '{}', ?, ?, 1)`,
    [executionTargetId, ctx.workspace.id, deviceId, ctx.actorWorkspaceUserId, now, now]
  );
  await ctx.db.run(
    `INSERT INTO workspace_user_execution_targets (id, workspace_id, workspace_user_id,
        execution_target_id, access_status, created_at, updated_at, revision)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`,
    [newId(), ctx.workspace.id, ctx.actorWorkspaceUserId, executionTargetId, now, now]
  );
  const dirs = {
    primary: gitRepo({ 'primary.txt': 'primary\n' }),
    mobile: gitRepo({ 'mobile.swift': 'let mobile = true\n' })
  };
  for (const [key, dir] of Object.entries(dirs)) {
    const resourceId = newId();
    await ctx.db.run(
      `INSERT INTO project_resources (id, workspace_id, project_id, resource_key, label, is_primary,
          status, metadata_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, ?, 'active', '{}', ?, ?, 1)`,
      [resourceId, ctx.workspace.id, project.id, key, key, key === 'primary' ? 1 : 0, now, now]
    );
    await ctx.db.run(
      `INSERT INTO project_resource_sources (id, workspace_id, project_id, resource_id,
          execution_target_id, source_kind, descriptor_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, 'local_checkout', ?, ?, ?, 1)`,
      [
        newId(),
        ctx.workspace.id,
        project.id,
        resourceId,
        executionTargetId,
        JSON.stringify({ path: dir }),
        now,
        now
      ]
    );
  }
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId,
    runnerInstanceId: 'conformance-runner',
    relation: 'adopted'
  });
  return { projectId: project.id, executionTargetId, dirs };
}

async function drain(ctx: ServiceContext, executionTargetId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const claimed = await claimNextExecutionRequest({
      ctx,
      runner: { executionTargetId, runnerInstanceId: 'conformance-runner', relation: 'adopted' }
    });
    if (claimed) {
      const mutation = parseLocalTargetMutation(claimed.metadata);
      assert.ok(mutation);
      const result = await executeLocalTargetMutation({
        mutation,
        provider: new InProcessProvider({
          executionTargetId,
          deviceLabel: null,
          transport: 'in_process'
        }),
        workingDirectory: claimed.workingDirectory
      });
      await completeLocalTargetMutationRequest({ ctx, requestId: claimed.id, result });
      return claimed.workingDirectory;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return null;
}

for (const adapter of adapters) {
  describe(`repository reads conformance [${adapter.label}]`, () => {
    it('reads a non-primary resource on a remote target through the real claim, and reuses the operation id', async () => {
      const { client, teardown } = await adapter.create();
      try {
        const ctx = await createServiceContext({ db: client, source: 'webapp' });
        const seeded = await seedRemoteTarget(ctx);
        const request = parseRepositoryReadRequest({
          operation: 'read_file',
          operationId: `op-conf-${randomUUID()}`,
          projectId: seeded.projectId,
          executionTargetId: seeded.executionTargetId,
          resourceKey: 'mobile',
          relativePath: 'mobile.swift'
        });
        const [result, workingDirectory] = await Promise.all([
          performRepositoryRead({
            ctx,
            request,
            scopeKey: 'conformance',
            timeoutMs: 10_000,
            queueOptions: { pollIntervalMs: 10 }
          }),
          drain(ctx, seeded.executionTargetId)
        ]);
        assert.equal(workingDirectory, path.resolve(seeded.dirs.mobile));
        assert.equal(result.outcome, 'ok');
        assert.equal((result.data as { content: string }).content, 'let mobile = true');

        const retried = await performRepositoryRead({
          ctx,
          request,
          scopeKey: 'conformance',
          timeoutMs: 2_000
        });
        assert.equal(retried.outcome, 'ok');
        const rows = await client.all<{ n: number | string }>(
          `SELECT COUNT(*) AS n FROM execution_requests WHERE workspace_id = ? AND mission_id IS NULL`,
          [ctx.workspace.id]
        );
        assert.equal(Number(rows[0]?.n), 1);

        await assert.rejects(
          performRepositoryRead({
            ctx,
            request: { ...request, relativePath: 'other.swift' },
            scopeKey: 'conformance'
          }),
          (error: unknown) => error instanceof ServiceError && error.code === 'operation_conflict'
        );
      } finally {
        await teardown();
      }
    });
  });
}
