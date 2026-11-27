import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { claimNextExecutionRequest } from '../packages/core/service/execution-requests.ts';
import { recordRunnerHeartbeat } from '../packages/core/service/execution-target-runners.ts';
import { latchHostKeyDigest } from '../packages/core/service/latch-host-identity.ts';
import { ok } from '../packages/core/service/local-target/result.ts';
import { completeLocalTargetMutationRequest } from '../packages/core/service/local-target-mutations.ts';
import { loadProjectResourceLatchHosts } from '../packages/core/service/project-resource-latch-host.ts';
import { addProjectResource, createProject } from '../packages/core/service/projects.ts';

import { bindWebappDatabaseClient, createConformanceDatabase } from './test-helpers.ts';

test(
  'PostgreSQL verifies, projects and revokes a source link through the native runner queue',
  {
    skip: !process.env.TEST_DATABASE_URL
  },
  async t => {
    const { db, cleanup } = await createConformanceDatabase('postgres', 'latch_host');
    t.after(cleanup);
    const actor = await bindWebappDatabaseClient({ client: db });
    const { buildWebappServiceContextForWorkspace } = await import('./db.ts');
    const { updateProjectResourceLatchHost } =
      await import('./execution/project-resource-latch-host.ts');

    const workspaceId = 'local-workspace';
    const ctx = await buildWebappServiceContextForWorkspace(workspaceId, db, actor);
    ctx.clientDevice = {
      deviceFingerprint: 'latch-postgres-native-fixture',
      deviceLabel: 'Test Mac',
      devicePlatform: 'darwin'
    };
    const project = await createProject({ ctx, name: 'Hosted Latch association' });
    const resource = await addProjectResource({
      ctx,
      projectId: project.id,
      directoryPath: '/test/checkout',
      isPrimary: true
    });
    const targetId = resource.executionTargetId!;
    const scope = { db, workspaceId, workspaceUserId: actor, projectId: project.id };
    const runner = { runnerInstanceId: 'postgres-latch-fixture' };
    await recordRunnerHeartbeat({
      ctx,
      executionTargetId: targetId,
      ...runner,
      relation: 'native'
    });
    const links = await loadProjectResourceLatchHosts(scope);
    assert.equal(links.size, 1);
    const [sourceId, link] = [...links.entries()][0]!;
    const hostPublicKey = '12'.repeat(32);
    const pending = updateProjectResourceLatchHost({
      projectId: project.id,
      sourceId,
      resourceId: resource.id,
      body: { sourceRevision: link.sourceRevision, hostPublicKey }
    }).then(
      result => ({ result }),
      error => ({ error })
    );

    const deadline = Date.now() + 3000;
    while (
      !(await db.get(
        "SELECT id FROM execution_requests WHERE project_id = ? AND status = 'queued'",
        [project.id]
      ))
    ) {
      assert.ok(Date.now() < deadline, 'Expected a queued host identity probe');
      await setTimeout(10);
    }
    const request = await claimNextExecutionRequest({ ctx, projectId: project.id, runner });
    assert.ok(request);
    await completeLocalTargetMutationRequest({
      ctx,
      requestId: request.id,
      result: ok(
        { executionTargetId: targetId, deviceLabel: null, transport: 'in_process' },
        {
          hostKeyDigest: latchHostKeyDigest(hostPublicKey)
        }
      )
    });

    assert.deepEqual(await pending, { result: { ok: true } });
    const verified = (await loadProjectResourceLatchHosts(scope)).get(sourceId)!;
    assert.equal(verified.hostPublicKey, hostPublicKey);
    assert.equal(verified.sourceRevision, link.sourceRevision + 1);
    await updateProjectResourceLatchHost({
      projectId: project.id,
      sourceId,
      resourceId: resource.id,
      body: { sourceRevision: verified.sourceRevision, hostPublicKey: null }
    });
    assert.equal((await loadProjectResourceLatchHosts(scope)).get(sourceId)?.state, 'unlinked');
  }
);
