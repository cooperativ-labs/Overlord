import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { listenForTest, routerTestApp, type TestServer } from './http/test-app-fixture.ts';

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4319';
const ambientDirectory = mkdtempSync(path.join(tmpdir(), 'ovld-answer-delivery-'));
process.env.OVERLORD_SQLITE_PATH = path.join(ambientDirectory, 'ambient.sqlite');
after(() => rmSync(ambientDirectory, { recursive: true, force: true }));

const { bindWebappDatabaseClient, conformanceAdapters, createConformanceDatabase } =
  await import('./test-helpers.ts');
const dbModule = await import('./db.ts');
const { createAgentRequestHumanRouter } = await import('./agent-session-routes.ts');
const {
  beginAnswerRedelivery,
  getRequest,
  readAnswerDelivery,
  recordAnswerDeliveryOutcome,
  resolveRequest
} = await import('../packages/core/service/agent-session/index.ts');
const { cancelQueuedLocalTargetMutation, createLocalTargetMutationRequest } =
  await import('../packages/core/service/local-target-mutations.ts');
const { createProject } = await import('../packages/core/service/projects.ts');
const { askQuestion, attachSession, protocolCreate } =
  await import('../packages/core/service/protocol.ts');
const { seedServiceOperator } = await import('../packages/core/service/test-helpers.ts');
const { createServiceContext } = await import('../packages/core/service/context.ts');

/**
 * The delivery record of an answer (ADR 0065) on both database adapters. `details_json` is
 * `jsonb` on Postgres and text on SQLite, so the attempt counter, the failure fields and the
 * compare-and-set that guards them are exercised on each.
 */

type DeliveryBody = {
  stage: string | null;
  attempt: number | null;
  failureCode: string | null;
  failureMessage: string | null;
  state: string | null;
};

for (const adapter of conformanceAdapters()) {
  describe(`answer delivery record [${adapter}]`, () => {
    let client: DatabaseClient;
    let cleanup: () => Promise<void>;
    let server: TestServer;
    let ctx: Awaited<ReturnType<typeof createServiceContext>>;
    let projectId = '';

    before(async () => {
      const database = await createConformanceDatabase(adapter, 'ovld_answer_delivery');
      client = database.db;
      cleanup = database.cleanup;
      await bindWebappDatabaseClient({ client });
      server = await listenForTest(
        routerTestApp(
          app => {
            app.use('/api/agent-requests', createAgentRequestHumanRouter());
          },
          { json: false }
        )
      );
      await seedServiceOperator({ db: client });
      await dbModule.setActiveWorkspace('local-workspace');
      ctx = await createServiceContext({ db: client, source: 'protocol' });
      projectId = (await createProject({ ctx, name: 'Answers', slug: 'answers' })).id;
    });

    after(async () => {
      await server.close();
      await cleanup();
    });

    async function askedQuestion(question: string) {
      const created = await protocolCreate({
        ctx,
        projectId,
        objectives: [{ objective: question }]
      });
      const attached = await attachSession({ ctx, missionId: created.mission.id });
      const asked = await askQuestion({
        ctx,
        missionId: created.mission.id,
        sessionKey: attached.sessionKey,
        question
      });
      const row = await client.get<{ id: string }>(
        `SELECT id FROM agent_requests WHERE mission_id = ? AND deleted_at IS NULL`,
        [created.mission.id]
      );
      assert.ok(row, 'ask opens a request for a session without a launch channel');
      return { missionId: created.mission.id, requestId: row.id, eventId: asked.eventId };
    }

    async function delivery(missionId: string, requestId: string): Promise<DeliveryBody> {
      const response = await fetch(`${server.baseUrl}/api/agent-requests?missionId=${missionId}`);
      const body = (await response.json()) as {
        requests: Array<{ id: string; delivery: DeliveryBody }>;
      };
      assert.equal(response.status, 200, JSON.stringify(body));
      return body.requests.find(request => request.id === requestId)!.delivery;
    }

    it('opens a credential-less protocol channel and links the ask event', async () => {
      const asked = await askedQuestion('Which region?');
      const channel = await client.get<{
        launch_kind: string;
        state: string;
        credential_hash: string | null;
        lease_expires_at: string | null;
      }>(
        `SELECT c.launch_kind, c.state, c.credential_hash, c.lease_expires_at
           FROM agent_session_channels c
           JOIN agent_requests r ON r.channel_id = c.id
          WHERE r.id = ?`,
        [asked.requestId]
      );
      assert.equal(channel?.launch_kind, 'protocol');
      assert.equal(channel?.state, 'online');
      assert.equal(channel?.credential_hash, null);
      assert.equal(channel?.lease_expires_at, null);
      const event = await client.get<{ payload_json: unknown }>(
        `SELECT payload_json FROM mission_events WHERE id = ?`,
        [asked.eventId]
      );
      const payload =
        typeof event!.payload_json === 'string'
          ? (JSON.parse(event!.payload_json) as { agentRequestId?: string })
          : (event!.payload_json as { agentRequestId?: string });
      assert.equal(payload.agentRequestId, asked.requestId);

      // A second ask from the same session reuses its one channel.
      const again = await client.get<{ count: number | string }>(
        `SELECT COUNT(*) AS count FROM agent_session_channels WHERE mission_id = ?`,
        [asked.missionId]
      );
      assert.equal(Number(again!.count), 1);
    });

    it('records outcomes per attempt and admits one redelivery under compare-and-set', async () => {
      const asked = await askedQuestion('Which database?');
      const open = await getRequest({ ctx, requestId: asked.requestId });
      await resolveRequest({
        ctx,
        requestId: asked.requestId,
        resolution: { text: 'Postgres' },
        expectedRevision: open.revision
      });
      assert.equal((await delivery(asked.missionId, asked.requestId)).stage, 'recorded');

      const failed = await recordAnswerDeliveryOutcome({
        ctx,
        requestId: asked.requestId,
        attempt: 1,
        outcome: {
          state: 'not_applied',
          failureCode: 'gateway_unavailable',
          failureMessage: "Latch's gateway is not running."
        }
      });
      assert.equal(failed.changed, true);
      // The same report again (resolve call and completion hook both see it) changes nothing.
      const duplicate = await recordAnswerDeliveryOutcome({
        ctx,
        requestId: asked.requestId,
        attempt: 1,
        outcome: { state: 'applied', failureCode: null, failureMessage: null }
      });
      assert.equal(duplicate.changed, false);
      const afterFailure = await delivery(asked.missionId, asked.requestId);
      assert.deepEqual(
        [afterFailure.stage, afterFailure.attempt, afterFailure.failureCode, afterFailure.state],
        ['failed', 1, 'gateway_unavailable', 'not_applied']
      );
      assert.equal(afterFailure.failureMessage, "Latch's gateway is not running.");

      const attempts = await Promise.allSettled(
        [1, 2].map(() =>
          beginAnswerRedelivery({ ctx, requestId: asked.requestId, expectedAttempt: 1 })
        )
      );
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
      const begun = await getRequest({ ctx, requestId: asked.requestId });
      assert.equal(readAnswerDelivery(begun).attempt, 2);
      assert.equal(begun.application_state, 'emitted');
      assert.equal(Number(begun.revision), Number(open.revision) + 2);

      // A late report for the superseded attempt cannot decide the new one.
      const stale = await recordAnswerDeliveryOutcome({
        ctx,
        requestId: asked.requestId,
        attempt: 1,
        outcome: { state: 'applied', failureCode: null, failureMessage: null }
      });
      assert.equal(stale.changed, false);
      const unconfirmed = await recordAnswerDeliveryOutcome({
        ctx,
        requestId: asked.requestId,
        attempt: 2,
        outcome: { state: 'unknown', failureCode: 'unconfirmed', failureMessage: 'No receipt.' }
      });
      assert.equal(unconfirmed.changed, true);
      await assert.rejects(
        beginAnswerRedelivery({ ctx, requestId: asked.requestId, expectedAttempt: 2 }),
        { code: 'delivery_confirmation_required' }
      );
      const confirmed = await beginAnswerRedelivery({
        ctx,
        requestId: asked.requestId,
        expectedAttempt: 2,
        confirmUnconfirmed: true
      });
      assert.equal(confirmed.attempt, 3);
      await recordAnswerDeliveryOutcome({
        ctx,
        requestId: asked.requestId,
        attempt: 3,
        outcome: { state: 'applied', failureCode: null, failureMessage: null }
      });
      const done = await delivery(asked.missionId, asked.requestId);
      assert.deepEqual([done.stage, done.attempt, done.failureCode], ['confirmed', 3, null]);
      const changes = await client.all<{ id: string }>(
        `SELECT id FROM entity_changes WHERE entity_type = 'agent_request' AND entity_id = ?`,
        [asked.requestId]
      );
      // insert, resolve, 3 outcomes, 2 redeliveries.
      assert.equal(changes.length, 7);
    });

    it('withdraws an unclaimed delivery job and reports it as never dispatched', async () => {
      const asked = await askedQuestion('Proceed?');
      const open = await getRequest({ ctx, requestId: asked.requestId });
      await resolveRequest({
        ctx,
        requestId: asked.requestId,
        resolution: { text: 'Yes' },
        expectedRevision: open.revision
      });
      const now = new Date().toISOString();
      await client.run(
        `INSERT INTO devices
           (id, workspace_id, fingerprint, label, platform, status, last_seen_at,
            metadata_json, created_at, updated_at, revision)
         VALUES ('answer-device', 'local-workspace', 'fp-answer', 'answers', 'darwin', 'active', ?,
                 '{}', ?, ?, 1)`,
        [now, now, now]
      );
      await client.run(
        `INSERT INTO execution_targets
           (id, workspace_id, device_id, owner_workspace_user_id, type, label, status,
            connection_json, created_at, updated_at, revision)
         VALUES ('answer-target', 'local-workspace', 'answer-device', NULL, 'local', 'answers',
                 'active', '{}', ?, ?, 1)`,
        [now, now]
      );
      const job = await createLocalTargetMutationRequest({
        ctx,
        projectId,
        missionId: asked.missionId,
        executionTargetId: 'answer-target',
        kind: 'capability_call',
        capability: 'sendLatchMessage',
        input: { providerSessionId: 'ses_x', operationId: asked.requestId, text: 'Yes' },
        operationId: asked.requestId
      });
      assert.equal((await delivery(asked.missionId, asked.requestId)).stage, 'queued');
      assert.deepEqual(await cancelQueuedLocalTargetMutation({ ctx, requestId: job.id }), {
        cancelled: true
      });
      assert.deepEqual(await cancelQueuedLocalTargetMutation({ ctx, requestId: job.id }), {
        cancelled: false
      });
      const after = await delivery(asked.missionId, asked.requestId);
      assert.deepEqual([after.stage, after.failureCode], ['failed', 'not_dispatched']);
    });
  });
}
