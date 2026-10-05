import type { RepositoryReadRequest } from '@overlord/contract';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { InProcessProvider } from './local-target/in-process-provider.ts';
import type { ServiceContext } from './context.ts';
import { ServiceError } from './errors.ts';
import { claimNextExecutionRequest } from './execution-requests.ts';
import { executeLocalTargetMutation } from './local-target-mutation-runner.ts';
import {
  completeLocalTargetMutationRequest,
  parseLocalTargetMutation
} from './local-target-mutations.ts';
import { addProjectResource, createProject } from './projects.ts';
import {
  parseRepositoryReadRequest,
  performRepositoryRead,
  RepositoryReadLimiter
} from './repository-reads.ts';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.ts';
import { newId, nowIso } from './util.ts';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};

function gitRepo(prefix: string, files: Record<string, string>): string {
  const dir = createIsolatedCheckout(prefix);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: GIT_ENV });
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content);
  execFileSync('git', ['add', '.'], { cwd: dir, env: GIT_ENV });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: dir, env: GIT_ENV });
  return dir;
}

async function setup() {
  const { db, ctx } = await createSeededServiceContext({ source: 'webapp' });
  const project = await createProject({ ctx, name: 'Repository reads' });
  const primaryDir = gitRepo('ovld-rr-primary-', { 'primary.txt': 'primary\n' });
  const mobileDir = gitRepo('ovld-rr-mobile-', { 'mobile.swift': 'let mobile = true\n' });
  const primary = await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: primaryDir,
    resourceKey: 'primary',
    isPrimary: true
  });
  await addProjectResource({
    ctx,
    projectId: project.id,
    directoryPath: mobileDir,
    resourceKey: 'mobile',
    isPrimary: false
  });
  return {
    db,
    ctx,
    projectId: project.id,
    executionTargetId: primary.executionTargetId!,
    primaryResourceId: primary.id,
    primaryDir,
    mobileDir
  };
}

let sequence = 0;
function request(
  base: { projectId: string; executionTargetId: string },
  rest: Record<string, unknown>
): RepositoryReadRequest {
  sequence += 1;
  return parseRepositoryReadRequest({
    operationId: `op-test-${Date.now()}-${sequence}`,
    projectId: base.projectId,
    executionTargetId: base.executionTargetId,
    resourceKey: 'primary',
    ...rest
  });
}

/**
 * Stand in for `ovld runner`: claim through the real claim (which resolves the
 * queued resource key to a directory on this target), dispatch through the
 * real generic runner with the real in-process provider, and post the result.
 */
async function runOneRead(ctx: ServiceContext): Promise<{ workingDirectory: string } | null> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const claimed = await claimNextExecutionRequest({
      ctx,
      runner: { runnerInstanceId: 'test-runner' }
    });
    if (claimed) {
      const mutation = parseLocalTargetMutation(claimed.metadata);
      assert.ok(mutation);
      const result = await executeLocalTargetMutation({
        mutation,
        provider: new InProcessProvider({
          executionTargetId: 'runner',
          deviceLabel: null,
          transport: 'in_process'
        }),
        workingDirectory: claimed.workingDirectory
      });
      await completeLocalTargetMutationRequest({ ctx, requestId: claimed.id, result });
      return { workingDirectory: claimed.workingDirectory };
    }
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  return null;
}

async function readWithRunner(ctx: ServiceContext, req: RepositoryReadRequest) {
  const [result, claim] = await Promise.all([
    performRepositoryRead({
      ctx,
      request: req,
      scopeKey: 'test',
      timeoutMs: 10_000,
      queueOptions: { pollIntervalMs: 5 }
    }),
    runOneRead(ctx)
  ]);
  return { result, claim };
}

describe('parseRepositoryReadRequest', () => {
  const base = {
    operationId: 'op-12345678',
    projectId: 'p',
    executionTargetId: 't',
    resourceKey: 'primary'
  };
  it('rejects absolute and escaping paths, bad operation ids, and unknown operations', () => {
    for (const body of [
      { ...base, operation: 'read_file', relativePath: '/etc/passwd' },
      { ...base, operation: 'read_file', relativePath: '../../x' },
      { ...base, operation: 'diff', scope: 'all', relativePaths: ['ok', 'C:\\x'] },
      { ...base, operation: 'search_text', query: 'a\nb' },
      { ...base, operation: 'search_text', query: '' },
      { ...base, operation: 'git_status', operationId: 'short' },
      { ...base, operation: 'write_file' },
      { ...base, operation: 'tree', maxEntries: -1 },
      { ...base, operation: 'diff', scope: 'everything' }
    ]) {
      assert.throws(
        () => parseRepositoryReadRequest(body),
        (error: unknown) => error instanceof ServiceError && error.status === 400,
        JSON.stringify(body)
      );
    }
    assert.deepEqual(
      parseRepositoryReadRequest({ ...base, operation: 'read_file', relativePath: './src//a.ts' }),
      {
        ...base,
        operation: 'read_file',
        relativePath: 'src/a.ts'
      }
    );
  });
});

describe('performRepositoryRead over the runner queue', () => {
  it('reads status, files, diff, search and tree for the requested resource, not the primary', async () => {
    const env = await setup();
    const status = await readWithRunner(env.ctx, request(env, { operation: 'git_status' }));
    assert.equal(status.result.outcome, 'ok');
    assert.equal(status.claim?.workingDirectory, path.resolve(env.primaryDir));
    assert.equal(status.result.branch, 'main');
    assert.match(status.result.head ?? '', /^[0-9a-f]{40}$/);

    const mobile = await readWithRunner(
      env.ctx,
      request(env, { operation: 'read_file', resourceKey: 'mobile', relativePath: 'mobile.swift' })
    );
    assert.equal(mobile.claim?.workingDirectory, path.resolve(env.mobileDir));
    assert.equal(mobile.result.outcome, 'ok');
    assert.equal((mobile.result.data as { content: string }).content, 'let mobile = true');
    assert.deepEqual(mobile.result.binding, {
      executionTargetId: env.executionTargetId,
      projectId: env.projectId,
      resourceKey: 'mobile'
    });

    writeFileSync(path.join(env.primaryDir, 'primary.txt'), 'changed\n');
    const diff = await readWithRunner(
      env.ctx,
      request(env, { operation: 'diff', scope: 'unstaged' })
    );
    assert.deepEqual((diff.result.data as { files: string[] }).files, ['primary.txt']);

    const search = await readWithRunner(
      env.ctx,
      request(env, { operation: 'search_text', query: 'changed' })
    );
    assert.deepEqual((search.result.data as { hits: unknown[] }).hits, [
      { path: 'primary.txt', line: 1, text: 'changed' }
    ]);

    const tree = await readWithRunner(env.ctx, request(env, { operation: 'tree', maxEntries: 1 }));
    assert.equal(tree.result.outcome, 'ok');
    assert.equal((tree.result.data as { entries: unknown[] }).entries.length, 1);
    assert.equal(JSON.stringify(tree.result.data).includes(env.primaryDir), false);

    symlinkSync(
      path.join(env.mobileDir, 'mobile.swift'),
      path.join(env.primaryDir, 'escape.swift')
    );
    const denied = await readWithRunner(
      env.ctx,
      request(env, { operation: 'read_file', relativePath: 'escape.swift' })
    );
    assert.equal(denied.result.outcome, 'denied');
    await env.db.close();
  });

  it('never queues a write: every queued call is a read capability for a resource', async () => {
    const env = await setup();
    await readWithRunner(env.ctx, request(env, { operation: 'worktrees' }));
    await readWithRunner(env.ctx, request(env, { operation: 'branches' }));
    await readWithRunner(env.ctx, request(env, { operation: 'observe' }));
    const rows = (await env.db.all(
      `SELECT metadata_json, mission_id FROM execution_requests WHERE workspace_id = ?`,
      [env.ctx.workspace.id]
    )) as Array<{ metadata_json: string; mission_id: string | null }>;
    assert.equal(rows.length, 3);
    for (const row of rows) {
      const mutation = parseLocalTargetMutation(row.metadata_json);
      assert.equal(row.mission_id, null);
      assert.equal(mutation?.kind, 'capability_call');
      assert.equal(mutation?.resourceKey, 'primary');
      assert.ok(
        ['listWorktrees', 'listBranches', 'observeResource'].includes(mutation!.capability)
      );
    }
    await env.db.close();
  });

  it('reuses the job for a retried operation id and rejects a conflicting reuse', async () => {
    const env = await setup();
    const first = request(env, { operation: 'git_status' });
    await readWithRunner(env.ctx, first);
    const retried = await performRepositoryRead({
      ctx: env.ctx,
      request: first,
      scopeKey: 'test',
      timeoutMs: 2_000
    });
    assert.equal(retried.outcome, 'ok', 'a retry returns the stored result without queueing again');
    const count = (await env.db.get(
      `SELECT COUNT(*) AS n FROM execution_requests WHERE workspace_id = ?`,
      [env.ctx.workspace.id]
    )) as { n: number };
    assert.equal(count.n, 1);
    await assert.rejects(
      performRepositoryRead({
        ctx: env.ctx,
        request: {
          ...first,
          operation: 'read_file',
          relativePath: 'primary.txt'
        } as RepositoryReadRequest,
        scopeKey: 'test'
      }),
      (error: unknown) => error instanceof ServiceError && error.code === 'operation_conflict'
    );
    await env.db.close();
  });

  it('answers timeout when no runner claims, and leaves the job for its runner', async () => {
    const env = await setup();
    const result = await performRepositoryRead({
      ctx: env.ctx,
      request: request(env, { operation: 'git_status' }),
      scopeKey: 'test',
      timeoutMs: 150,
      queueOptions: { pollIntervalMs: 10 }
    });
    assert.equal(result.outcome, 'timeout');
    const row = (await env.db.get(`SELECT status FROM execution_requests WHERE workspace_id = ?`, [
      env.ctx.workspace.id
    ])) as { status: string };
    assert.equal(row.status, 'queued');
    await env.db.close();
  });

  it('answers unavailable for a job the runner could not run (an older runner fails it)', async () => {
    const env = await setup();
    const pending = performRepositoryRead({
      ctx: env.ctx,
      request: request(env, { operation: 'git_status' }),
      scopeKey: 'test',
      timeoutMs: 5_000,
      queueOptions: { pollIntervalMs: 5 }
    });
    for (let i = 0; i < 200; i += 1) {
      const changed = await env.db.run(
        `UPDATE execution_requests SET status = 'failed', last_error = '/Users/secret/path: no agent'
          WHERE workspace_id = ? AND status = 'queued'`,
        [env.ctx.workspace.id]
      );
      if (changed.changes > 0) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const result = await pending;
    assert.equal(result.outcome, 'unavailable');
    assert.equal(
      JSON.stringify(result).includes('/Users/secret'),
      false,
      'target text never leaks'
    );
    await env.db.close();
  });

  it('reports a target the caller cannot use as not found, an offline target without queueing, and an unlinked resource as unavailable', async () => {
    const env = await setup();
    await assert.rejects(
      performRepositoryRead({
        ctx: env.ctx,
        request: request({ ...env, executionTargetId: newId() }, { operation: 'git_status' }),
        scopeKey: 'test'
      }),
      (error: unknown) => error instanceof ServiceError && error.status === 404
    );

    // A second target the caller may use, holding the primary resource, whose runner is not live.
    const now = nowIso();
    const stale = '2000-01-01T00:00:00.000Z';
    const deviceId = newId();
    const offlineTargetId = newId();
    await env.db.run(
      `INSERT INTO devices (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
          metadata_json, created_at, updated_at, revision)
        VALUES (?, ?, 'fp-offline', 'Offline', 'linux', 'active', ?, '{}', ?, ?, 1)`,
      [deviceId, env.ctx.workspace.id, stale, now, now]
    );
    await env.db.run(
      `INSERT INTO execution_targets (id, workspace_id, device_id, owner_workspace_user_id, type, label,
          status, connection_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, 'local', 'Offline', 'active', '{}', ?, ?, 1)`,
      [offlineTargetId, env.ctx.workspace.id, deviceId, env.ctx.actorWorkspaceUserId, now, now]
    );
    await env.db.run(
      `INSERT INTO workspace_user_execution_targets (id, workspace_id, workspace_user_id,
          execution_target_id, access_status, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, 'active', ?, ?, 1)`,
      [newId(), env.ctx.workspace.id, env.ctx.actorWorkspaceUserId, offlineTargetId, now, now]
    );
    await env.db.run(
      `INSERT INTO project_resource_sources (id, workspace_id, project_id, resource_id,
          execution_target_id, source_kind, descriptor_json, created_at, updated_at, revision)
        VALUES (?, ?, ?, ?, ?, 'local_checkout', ?, ?, ?, 1)`,
      [
        newId(),
        env.ctx.workspace.id,
        env.projectId,
        env.primaryResourceId,
        offlineTargetId,
        JSON.stringify({ path: '/srv/offline/checkout' }),
        now,
        now
      ]
    );
    const offline = await performRepositoryRead({
      ctx: env.ctx,
      request: request({ ...env, executionTargetId: offlineTargetId }, { operation: 'git_status' }),
      scopeKey: 'test'
    });
    assert.equal(offline.outcome, 'target_offline');
    const unlinked = await performRepositoryRead({
      ctx: env.ctx,
      request: request(env, { operation: 'git_status', resourceKey: 'marketing' }),
      scopeKey: 'test'
    });
    assert.equal(unlinked.outcome, 'unavailable');
    const queued = (await env.db.get(
      `SELECT COUNT(*) AS n FROM execution_requests WHERE workspace_id = ?`,
      [env.ctx.workspace.id]
    )) as { n: number };
    assert.equal(queued.n, 0, 'neither read reached the queue');
    await env.db.close();
  });
});

describe('RepositoryReadLimiter', () => {
  it('admits four reads per scope, queues the fifth, and drops cancelled or expired waiters', async () => {
    const limiter = new RepositoryReadLimiter(4);
    const releases = await Promise.all([1, 2, 3, 4].map(() => limiter.acquire('run', 1_000)));
    assert.equal(limiter.inFlight('run'), 4);
    const other = await limiter.acquire('other-run', 1_000);
    assert.ok(other, 'scopes are independent');

    let fifthGranted = false;
    const fifth = limiter.acquire('run', 1_000).then(release => {
      fifthGranted = true;
      return release;
    });
    const controller = new AbortController();
    const cancelled = limiter.acquire('run', 1_000, controller.signal);
    const expired = limiter.acquire('run', 20);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(fifthGranted, false);
    controller.abort();
    assert.equal(await cancelled, null);
    assert.equal(await expired, null);

    releases[0]!();
    const release5 = await fifth;
    assert.ok(release5);
    assert.equal(limiter.inFlight('run'), 4);
    for (const release of [...releases.slice(1), release5]) release!();
    assert.equal(limiter.inFlight('run'), 0);
  });
});
