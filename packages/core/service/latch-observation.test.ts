import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { emitNotification } from './notifications/notifications.ts';
import { createExecutionRequest } from './execution-requests.ts';
import {
  type ExecutionProviderSession,
  mergeProviderSessionIntoMetadata,
  providerSessionFromMetadata
} from './latch-launch.ts';
import { ingestLatchHarnessEvents } from './latch-observation.ts';
import { createProject } from './projects.ts';
import { attachSession, protocolCreate } from './protocol.ts';
import { createIsolatedCheckout } from './test-checkout.ts';
import { createSeededServiceContext } from './test-helpers.ts';

const awaiting = {
  sessionId: 'ses_obs',
  at: '2026-08-13T10:20:00Z',
  harnessVersion: '2.1.119',
  connectorEpoch: 1,
  type: 'awaiting_input',
  requestId: 'permission-1',
  kind: 'permission',
  prompt: 'Install the test runner',
  choices: ['Allow once', 'Deny']
};

const user = {
  sessionId: 'ses_obs',
  at: '2026-08-13T10:00:00Z',
  harnessVersion: '2.1.119',
  connectorEpoch: 1,
  type: 'user_message',
  text: 'Check the build.'
};

describe('Latch harness observation ingest', () => {
  it('notifies from awaiting_input without protocol attach, and delivery notify does not wait on Latch', async () => {
    const { ctx, db } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Observation', slug: 'observation' });
    const created = await protocolCreate({
      ctx,
      projectId: project.id,
      assignedTo: 'operator-workspace-user',
      objectives: [{ objective: 'Watch the session' }]
    });
    const request = await createExecutionRequest({
      ctx,
      missionId: created.mission.id,
      requestedAgent: 'claude',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-latch-obs-')
    });
    const providerSession: ExecutionProviderSession = {
      provider: 'latch',
      providerSessionId: 'ses_obs',
      sessionName: 'watch',
      executionTargetId: null,
      agentSessionId: null,
      createdAt: '2026-08-13T10:00:00.000Z',
      lastObservedState: 'running'
    };
    await db.run(`UPDATE execution_requests SET metadata_json = ? WHERE id = ?`, [
      mergeProviderSessionIntoMetadata({ metadataJson: null, providerSession }),
      request.id
    ]);

    const ingested = await ingestLatchHarnessEvents({
      ctx,
      missionId: created.mission.id,
      executionRequestId: request.id,
      providerSessionId: 'ses_obs',
      events: [user, awaiting],
      from: 0
    });
    assert.equal(ingested.observation.unattached, true);
    assert.equal(ingested.observation.pendingInput?.requestId, 'permission-1');
    assert.equal(ingested.notified, true);

    const deliveryNotify = await emitNotification({
      db,
      workspaceId: ctx.workspace.id,
      missionId: created.mission.id,
      type: 'mission_awaiting_review',
      objectiveId: created.objectives[0]?.id ?? null
    });
    assert.equal(deliveryNotify.emitted, true);

    const types = await db.all<{ type: string }>(
      `SELECT type FROM notifications WHERE mission_id = ? ORDER BY created_at ASC`,
      [created.mission.id]
    );
    assert.deepEqual(
      types.map(row => row.type),
      ['agent_question', 'mission_awaiting_review']
    );
    await db.close();
  });

  it('binds agentSessionId on protocol attach without a session channel', async () => {
    const { ctx, db } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Attach bind', slug: 'attach-bind' });
    const created = await protocolCreate({
      ctx,
      projectId: project.id,
      assignedTo: 'operator-workspace-user',
      objectives: [{ objective: 'Attach without Latch' }]
    });
    const request = await createExecutionRequest({
      ctx,
      missionId: created.mission.id,
      requestedAgent: 'claude',
      requestedSource: 'test',
      workingDirectory: createIsolatedCheckout('ovld-latch-bind-')
    });
    const providerSession: ExecutionProviderSession = {
      provider: 'latch',
      providerSessionId: 'ses_obs',
      sessionName: 'watch',
      executionTargetId: null,
      agentSessionId: null,
      createdAt: '2026-08-13T10:00:00.000Z',
      lastObservedState: 'running'
    };
    await db.run(
      `UPDATE execution_requests SET status = 'launched', metadata_json = ? WHERE id = ?`,
      [mergeProviderSessionIntoMetadata({ metadataJson: null, providerSession }), request.id]
    );
    await ingestLatchHarnessEvents({
      ctx,
      missionId: created.mission.id,
      executionRequestId: request.id,
      providerSessionId: 'ses_obs',
      events: [user],
      from: 0
    });
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
    assert.equal(bound?.observation?.unattached, false);
    await db.close();
  });

  it('attaches without Latch or a session channel', async () => {
    const { ctx, db } = await createSeededServiceContext({ source: 'protocol' });
    const project = await createProject({ ctx, name: 'Channel one', slug: 'channel-one' });
    const created = await protocolCreate({
      ctx,
      projectId: project.id,
      assignedTo: 'operator-workspace-user',
      objectives: [{ objective: 'Bare terminal' }]
    });
    const attached = await attachSession({
      ctx,
      missionId: created.mission.id,
      agentIdentifier: 'claude'
    });
    assert.ok(attached.sessionKey.startsWith('sess_'));
    assert.equal(attached.session.state, 'executing');
    await db.close();
  });
});
