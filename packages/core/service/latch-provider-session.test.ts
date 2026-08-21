import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createExecutionRequest } from './execution-requests.ts';
import {
  type ExecutionProviderSession,
  mergeProviderSessionIntoMetadata,
  providerSessionFromMetadata
} from './latch-launch.ts';
import { forgetLatchProviderSession } from './latch-provider-session.ts';
import { createProject } from './projects.ts';
import { attachSession, protocolCreate } from './protocol.ts';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.ts';

function providerSession(providerSessionId: string): ExecutionProviderSession {
  return {
    provider: 'latch',
    providerSessionId,
    sessionName: 'watch',
    executionTargetId: null,
    agentSessionId: null,
    createdAt: '2026-08-13T10:00:00.000Z',
    lastObservedState: 'running'
  };
}

describe('Latch provider-session persistence', () => {
  it('binds the provider mapping to the agent session on protocol attach', async () => {
    const { ctx, db } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach bind', slug: 'attach-bind' });
    const created = await protocolCreate({
      ctx,
      projectId: project.id,
      assignedTo: 'operator-workspace-user',
      objectives: [{ objective: 'Attach without a conversation surface' }]
    });
    const request = await createExecutionRequest({
      ctx,
      missionId: created.mission.id,
      requestedAgent: 'claude',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-latch-bind-')
    });
    await db.run(
      `UPDATE execution_requests SET status = 'launched', metadata_json = ? WHERE id = ?`,
      [
        mergeProviderSessionIntoMetadata({
          metadataJson: null,
          providerSession: providerSession('ses_bind')
        }),
        request.id
      ]
    );

    const attached = await attachSession({
      ctx,
      missionId: created.mission.id,
      executionRequestId: request.id,
      agentIdentifier: 'claude'
    });
    const row = await db.get<{ metadata_json: string }>(
      `SELECT metadata_json FROM execution_requests WHERE id = ?`,
      [request.id]
    );
    const bound = providerSessionFromMetadata(
      JSON.parse(row!.metadata_json) as Record<string, unknown>
    );

    assert.equal(bound?.agentSessionId, attached.session.id);
    await db.close();
  });

  it('forgets a reclaimed Latch mapping without deleting the execution request', async () => {
    const { ctx, db } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Forget session', slug: 'forget-session' });
    const created = await protocolCreate({
      ctx,
      projectId: project.id,
      assignedTo: 'operator-workspace-user',
      objectives: [{ objective: 'Prune the mapping' }]
    });
    const request = await createExecutionRequest({
      ctx,
      missionId: created.mission.id,
      requestedAgent: 'claude',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-latch-forget-')
    });
    await db.run(`UPDATE execution_requests SET metadata_json = ? WHERE id = ?`, [
      mergeProviderSessionIntoMetadata({
        metadataJson: JSON.stringify({ launchSession: { version: 1 } }),
        providerSession: providerSession('ses_gone')
      }),
      request.id
    ]);

    const forgotten = await forgetLatchProviderSession({
      ctx,
      missionId: created.mission.id,
      executionRequestId: request.id,
      providerSessionId: 'ses_gone'
    });
    assert.equal(forgotten.forgotten, true);
    assert.equal(forgotten.executionRequestId, request.id);

    const row = await db.get<{ metadata_json: string; deleted_at: string | null }>(
      `SELECT metadata_json, deleted_at FROM execution_requests WHERE id = ?`,
      [request.id]
    );
    const parsed = JSON.parse(row!.metadata_json) as Record<string, unknown>;
    assert.deepEqual(parsed.launchSession, { version: 1 });
    assert.equal(providerSessionFromMetadata(parsed), null);
    assert.equal(row!.deleted_at, null);

    const again = await forgetLatchProviderSession({
      ctx,
      missionId: created.mission.id,
      executionRequestId: request.id,
      providerSessionId: 'ses_gone'
    });
    assert.equal(again.forgotten, false);
    await db.close();
  });
});
