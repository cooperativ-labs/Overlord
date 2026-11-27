import {
  PROJECT_RESOURCE_READ_CAPABILITY,
  type ProjectResourceReadCatalog,
  type ProjectResourceReadRequest,
  type ProjectResourceReadResult,
  type RunnerClaimResponse
} from '@overlord/contract';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { claimNextExecutionRequest } from '../packages/core/service/execution-requests.ts';
import { recordRunnerHeartbeat } from '../packages/core/service/execution-target-runners.ts';
import { executeLocalTargetMutation } from '../packages/core/service/local-target-mutation-runner.ts';
import { parseLocalTargetMutation } from '../packages/core/service/local-target-mutations.ts';

import { listenForTest } from './http/test-app-fixture.ts';
import { createIntegrationTestDb, seedAuthenticatedOperator } from './test-helpers.ts';

const { db, tempDir } = await createIntegrationTestDb('ovld-project-reads-');
const { app } = await import('./app.ts');
const { buildWebappServiceContext, setActiveProfileId, withRequestContextAsync } =
  await import('./db.ts');
const { createProject, createProjectResource, createUserToken } = await import('./repository.ts');
const ctx = buildWebappServiceContext();
const capabilities = { [PROJECT_RESOURCE_READ_CAPABILITY]: true };
const runner = { runnerInstanceId: 'project-read-native', capabilities };

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test('web reads use the exact project source on its owning runner and discard private queue data', async t => {
  const repo = path.join(tempDir, 'repo');
  const plain = path.join(tempDir, 'folder');
  const outside = path.join(tempDir, 'outside.txt');
  mkdirSync(repo);
  mkdirSync(plain);
  mkdirSync(path.join(repo, 'nested'));
  writeFileSync(outside, 'outside fixture');
  writeFileSync(path.join(repo, 'clean.txt'), 'clean preview\n');
  writeFileSync(path.join(repo, 'change.txt'), 'base\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'base');
  writeFileSync(path.join(repo, 'change.txt'), 'staged\n');
  git('add', 'change.txt');
  writeFileSync(path.join(repo, 'change.txt'), 'working\n');
  writeFileSync(path.join(repo, '.env'), 'synthetic secret');
  symlinkSync(outside, path.join(repo, 'symlink.txt'));
  writeFileSync(path.join(plain, 'plain.txt'), 'plain folder\n');
  writeFileSync(path.join(plain, 'binary.bin'), Buffer.from([0, 1]));
  writeFileSync(path.join(plain, 'bounded.txt'), 'fixture text\n'.repeat(10_000));
  writeFileSync(path.join(plain, 'oversized.txt'), '');
  truncateSync(path.join(plain, 'oversized.txt'), 8 * 1024 * 1024 + 1);
  for (let n = 0; n < 100; n++) writeFileSync(path.join(plain, `fixture-${n}.txt`), '');

  const project = await createProject({ name: 'Project read browser' });
  const otherProject = await createProject({ name: 'Other project' });
  const a = await createProjectResource(project.id, { resourceKey: 'repo', directoryPath: repo });
  const b = await createProjectResource(project.id, {
    resourceKey: 'folder',
    directoryPath: plain
  });
  await createProjectResource(project.id, {
    resourceKey: 'nested',
    directoryPath: path.join(repo, 'nested')
  });
  const foreign = await createProjectResource(otherProject.id, {
    resourceKey: 'foreign',
    directoryPath: tempDir
  });
  const ownerTargetId = a.sources[0]!.executionTargetId!;
  const otherTargetId = crypto.randomUUID();
  const otherDeviceId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO devices
    (id, workspace_id, fingerprint, label, platform, status, created_at, updated_at)
    VALUES (?, ?, ?, 'Second Mac', 'darwin', 'active', ?, ?)`
  ).run(otherDeviceId, ctx.workspace.id, otherDeviceId, now, now);
  db.prepare(
    `INSERT INTO execution_targets
    (id, workspace_id, device_id, owner_workspace_user_id, type, label, status, created_at, updated_at)
    SELECT ?, workspace_id, ?, owner_workspace_user_id, 'local', label, 'active', ?, ? FROM execution_targets WHERE id = ?`
  ).run(otherTargetId, otherDeviceId, now, now, ownerTargetId);
  db.prepare(
    `INSERT INTO workspace_user_execution_targets
    (id, workspace_id, workspace_user_id, execution_target_id, access_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(crypto.randomUUID(), ctx.workspace.id, ctx.actorWorkspaceUserId, otherTargetId, now, now);
  await createProjectResource(project.id, {
    resourceKey: 'repo',
    directoryPath: repo,
    executionTargetId: otherTargetId
  });

  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: ownerTargetId,
    ...runner,
    relation: 'native'
  });
  await recordRunnerHeartbeat({
    ctx,
    executionTargetId: otherTargetId,
    runnerInstanceId: 'old-owner-runner',
    relation: 'native'
  });
  const { secret } = await createUserToken({ label: 'Project resource reads test' });
  const server = await listenForTest(app);
  t.after(server.close);
  const url = `${server.baseUrl}/api/projects/${project.id}/resource-reads`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const post = (body: unknown, requestHeaders = headers, signal?: AbortSignal) =>
    fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      signal,
      body: JSON.stringify(body)
    });
  assert.equal((await fetch(url)).status, 401);
  const listed = await fetch(url, { headers });
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'private, no-store');
  const catalog = (await listed.json()) as ProjectResourceReadCatalog;
  assert.deepEqual(
    catalog.map(resource => resource.resourceKey),
    ['folder', 'nested', 'repo']
  );
  assert.ok(!JSON.stringify(catalog).includes(tempDir));
  const binding = (resourceKey: string, executionTargetId = ownerTargetId) => {
    const source = catalog
      .find(row => row.resourceKey === resourceKey)!
      .sources.find(candidate => candidate.executionTargetId === executionTargetId)!;
    return {
      resourceKey,
      executionTargetId,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision
    };
  };
  const repoSource = binding('repo');
  assert.equal(catalog.find(resource => resource.resourceKey === 'repo')?.sources.length, 2);
  assert.equal(
    (await post({ ...repoSource, operation: 'git_status', executionTargetId: undefined })).status,
    400
  );
  assert.equal(
    (await post({ ...repoSource, operation: 'git_status', executionTargetId: otherTargetId }))
      .status,
    404
  );
  assert.equal(
    (
      await post({
        ...repoSource,
        operation: 'git_status',
        sourceRevision: repoSource.sourceRevision + 1
      })
    ).status,
    404
  );
  assert.equal(
    (await post({ ...repoSource, operation: 'git_status', sourceId: foreign.sources[0]!.id }))
      .status,
    404
  );
  assert.equal(
    (await post({ ...repoSource, operation: 'read_file', relativePath: '../outside.txt' })).status,
    400
  );
  const otherMemberId = seedAuthenticatedOperator({
    db,
    profileId: 'resource-browser-other-user',
    workspaceUserId: 'resource-browser-other-member'
  });
  const otherToken = await withRequestContextAsync(async () => {
    setActiveProfileId('resource-browser-other-user');
    return createUserToken({ label: 'Other resource read member' });
  });
  const otherHeaders = { ...headers, Authorization: `Bearer ${otherToken.secret}` };
  assert.equal((await post({ ...repoSource, operation: 'git_status' }, otherHeaders)).status, 404);
  assert.equal(
    (await (await post({ ...binding('repo', otherTargetId), operation: 'git_status' })).json())
      .outcome,
    'unsupported'
  );

  db.prepare(
    `UPDATE execution_target_runner_registrations SET last_heartbeat_at = ?
    WHERE execution_target_id = ?`
  ).run('2001-01-01T00:00:00.000Z', otherTargetId);
  assert.equal(
    (await (await post({ ...binding('repo', otherTargetId), operation: 'git_status' })).json())
      .outcome,
    'target_offline'
  );
  assert.equal(
    (
      db
        .prepare(`SELECT count(*) AS total FROM execution_requests WHERE project_id = ?`)
        .get(project.id) as { total: number }
    ).total,
    0
  );

  async function claimPendingRead(checkClaim = false) {
    const queued = db.prepare(
      "SELECT id FROM execution_requests WHERE project_id = ? AND status = 'queued'"
    );
    const deadline = Date.now() + 3000;
    while (!queued.get(project.id)) {
      assert.ok(Date.now() < deadline, 'expected a private queued resource read');
      await setTimeout(10);
    }
    if (checkClaim) {
      assert.equal(
        await claimNextExecutionRequest({
          ctx,
          projectId: project.id,
          runner: { runnerInstanceId: 'legacy' }
        }),
        null
      );
      assert.equal(
        await claimNextExecutionRequest({
          ctx,
          projectId: project.id,
          runner: { ...runner, runnerInstanceId: 'adopted', relation: 'adopted' }
        }),
        null
      );
    }
    const claimResponse = await fetch(`${server.baseUrl}/api/runner/claim`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ projectId: project.id, ...runner })
    });
    assert.equal(claimResponse.status, 200);
    const { request } = (await claimResponse.json()) as RunnerClaimResponse;
    assert.ok(request);
    return request;
  }

  async function runRead(
    body: ProjectResourceReadRequest,
    options: {
      checkClaim?: boolean;
      readerHeaders?: typeof headers;
      beforeComplete?: () => void;
    } = {}
  ) {
    const response = post(body, options.readerHeaders);
    const request = await claimPendingRead(options.checkClaim);
    const mutation = parseLocalTargetMutation(request.metadata);
    assert.equal(mutation?.capability, 'readProjectResource');
    assert.equal(mutation.input.repoPath, '');
    const result = await executeLocalTargetMutation({
      mutation,
      workingDirectory: request.workingDirectory
    });
    options.beforeComplete?.();
    const completed = await fetch(`${server.baseUrl}/api/runner/requests/${request.id}/completed`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ mutationResult: result })
    });
    assert.equal(completed.status, 200);
    assert.deepEqual((await completed.json()).metadata, {});
    const read = await response;
    assert.equal(read.headers.get('cache-control'), 'private, no-store');
    const stored = db
      .prepare(
        'SELECT metadata_json, resolved_working_directory FROM execution_requests WHERE id = ?'
      )
      .get(request.id);
    assert.deepEqual(stored, { metadata_json: '{}', resolved_working_directory: null });
    return { status: read.status, body: (await read.json()) as ProjectResourceReadResult };
  }

  const status = await runRead({ ...repoSource, operation: 'git_status' }, { checkClaim: true });
  assert.equal(status.body.outcome, 'ok');
  assert.equal(status.body.branch, 'main');
  assert.match(JSON.stringify(status.body.data), /change\.txt/);
  const diff = await runRead({
    ...repoSource,
    operation: 'diff',
    scope: 'staged',
    relativePath: 'change.txt'
  });
  assert.match(JSON.stringify(diff.body.data), /\+staged/);
  assert.doesNotMatch(JSON.stringify(diff.body.data), /\+working/);
  assert.equal(
    (await runRead({ ...binding('nested'), operation: 'git_status' })).body.outcome,
    'not_git_repository'
  );

  const clean = await runRead({ ...repoSource, operation: 'read_file', relativePath: 'clean.txt' });
  assert.match(JSON.stringify(clean.body.data), /clean preview/);
  assert.equal(
    (await runRead({ ...repoSource, operation: 'read_file', relativePath: '.env' })).body.outcome,
    'denied'
  );
  assert.equal(
    (await runRead({ ...repoSource, operation: 'read_file', relativePath: 'symlink.txt' })).body
      .outcome,
    'denied'
  );
  const rootEntries = (await runRead({ ...repoSource, operation: 'list_directory' })).body.data;
  assert.doesNotMatch(JSON.stringify(rootEntries), /"\.git"|"\.env"|"symlink\.txt"/);
  const folder = binding(b.resourceKey);
  const first = (await runRead({ ...folder, operation: 'list_directory' })).body.data as {
    entries: unknown[];
    nextOffset: number;
  };
  assert.equal(first.entries.length, 100);
  const second = (
    await runRead({ ...folder, operation: 'list_directory', offset: first.nextOffset })
  ).body.data as typeof first;
  assert.equal(second.entries.length, 4);
  assert.equal(second.nextOffset, null);
  assert.notDeepEqual(first.entries[0], second.entries[0]);
  assert.match(
    JSON.stringify(
      (await runRead({ ...folder, operation: 'read_file', relativePath: 'plain.txt' })).body.data
    ),
    /plain folder/
  );
  assert.equal(
    (await runRead({ ...folder, operation: 'read_file', relativePath: 'binary.bin' })).body.outcome,
    'binary'
  );

  const bounded = await runRead({ ...folder, operation: 'read_file', relativePath: 'bounded.txt' });
  assert.equal(bounded.body.truncated, true);
  assert.ok(Buffer.byteLength((bounded.body.data as { content: string }).content) <= 64 * 1024);
  const oversized = await runRead({
    ...folder,
    operation: 'read_file',
    relativePath: 'oversized.txt'
  });
  assert.equal(oversized.body.outcome, 'oversized');
  assert.equal((oversized.body.data as { content: string | null }).content, null);

  db.prepare(
    `INSERT INTO workspace_user_execution_targets
    (id, workspace_id, workspace_user_id, execution_target_id, access_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)`
  ).run(crypto.randomUUID(), ctx.workspace.id, otherMemberId, ownerTargetId, now, now);
  const revoked = await runRead(
    { ...repoSource, operation: 'read_file', relativePath: 'clean.txt' },
    {
      readerHeaders: otherHeaders,
      beforeComplete: () => {
        db.prepare(
          `UPDATE workspace_user_execution_targets SET access_status = 'disabled'
        WHERE workspace_user_id = ? AND execution_target_id = ?`
        ).run(otherMemberId, ownerTargetId);
      }
    }
  );
  assert.equal(revoked.status, 404);
  assert.doesNotMatch(JSON.stringify(revoked.body), /clean preview/);
  db.prepare(
    `UPDATE workspace_user_execution_targets SET access_status = 'active'
    WHERE workspace_user_id = ? AND execution_target_id = ?`
  ).run(otherMemberId, ownerTargetId);
  const roleRevoked = await runRead(
    { ...repoSource, operation: 'read_file', relativePath: 'clean.txt' },
    {
      readerHeaders: otherHeaders,
      beforeComplete: () => {
        db.prepare('UPDATE role_assignments SET deleted_at = ? WHERE workspace_user_id = ?').run(
          now,
          otherMemberId
        );
      }
    }
  );
  assert.equal(roleRevoked.status, 404);
  assert.doesNotMatch(JSON.stringify(roleRevoked.body), /clean preview/);
  const controller = new AbortController();
  const abandoned = post(
    { ...repoSource, operation: 'read_file', relativePath: 'clean.txt' },
    headers,
    controller.signal
  );
  const aborted = assert.rejects(abandoned, { name: 'AbortError' });
  const claimed = await claimPendingRead();
  const abandonedMutation = parseLocalTargetMutation(claimed.metadata);
  assert.ok(abandonedMutation);
  const lateResult = await executeLocalTargetMutation({
    mutation: abandonedMutation,
    workingDirectory: claimed.workingDirectory
  });
  controller.abort();
  await aborted;
  const state = db.prepare('SELECT status, metadata_json FROM execution_requests WHERE id = ?');
  const expiry = Date.now() + 3000;
  while ((state.get(claimed.id) as { status: string }).status !== 'cancelled') {
    assert.ok(Date.now() < expiry, 'expected a cancelled private read');
    await setTimeout(10);
  }
  const late = await fetch(`${server.baseUrl}/api/runner/requests/${claimed.id}/completed`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mutationResult: lateResult })
  });
  assert.equal(late.status, 200);
  assert.deepEqual(state.get(claimed.id), { status: 'cancelled', metadata_json: '{}' });

  const relinked = await runRead(
    { ...repoSource, operation: 'read_file', relativePath: 'clean.txt' },
    {
      beforeComplete: () => {
        db.prepare('UPDATE project_resource_sources SET revision = revision + 1 WHERE id = ?').run(
          repoSource.sourceId
        );
      }
    }
  );
  assert.equal(relinked.status, 404);
  assert.doesNotMatch(JSON.stringify(relinked.body), /clean preview/);
});
