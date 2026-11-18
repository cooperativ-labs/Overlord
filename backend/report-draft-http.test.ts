import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { listenForTest, type TestServer } from './http/test-app-fixture.ts';

/**
 * Draft delivery evidence through the real app (coo:1297.c6h4, ADR 0078):
 * `update` with --report-draft-json, the `report-draft` read, a lost-response
 * batch replay, deliver with --expected-draft-revision sealing the draft, and
 * the read-only operator projection. Under the API conformance report every
 * REST response is also checked against its OpenAPI operation (ADR 0051).
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4327';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
await createIntegrationTestDb('overlord-report-draft-http-');
const { createMission, createProject, createUserToken } = await import('./repository.ts');
const { requireDatabaseClient } = await import('./db.ts');
const { app } = await import('./app.ts');

let server: TestServer;
let baseUrl = '';
let secret = '';

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

function protocol(subcommand: string, flags: Record<string, unknown>) {
  return call('POST', `/api/protocol/${subcommand}`, { flags });
}

before(async () => {
  secret = (await createUserToken({ label: 'report-draft-http' })).secret;
  server = await listenForTest(app);
  baseUrl = server.baseUrl;
});

after(async () => {
  await server?.close();
});

describe('report draft protocol and operator projection', () => {
  it('records, replays, inspects, seals and projects draft evidence', async () => {
    const project = await createProject({ name: `Draft HTTP ${Date.now()}`, color: '#123456' });
    const mission = await createMission({ projectId: project.id, firstObjective: 'Draft work' });
    const objective = mission.objectives[0]!;
    const attached = await protocol('attach', { '--objective-id': objective.displayId });
    assert.equal(attached.status, 200, JSON.stringify(attached.body));
    const sessionKey = attached.body.sessionKey as string;
    assert.equal(attached.body.reportDraft, undefined, 'no draft baseline without drafts');

    const batchA = {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--report-draft-json': JSON.stringify({
        operationId: 'http-batch-a-01',
        expectedRevision: 0,
        operations: [
          { op: 'upsert', entryId: 'risk-1', kind: 'known_risk', content: { text: 'First' } }
        ]
      })
    };
    const a = await protocol('update', batchA);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.reportDraft.revision, 1);

    const b = await protocol('update', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--summary': 'Refined.',
      '--payload-json': JSON.stringify({
        reportDraft: {
          operationId: 'http-batch-b-01',
          expectedRevision: 1,
          operations: [
            { op: 'upsert', entryId: 'risk-1', kind: 'known_risk', content: { text: 'Refined' } }
          ]
        }
      })
    });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.reportDraft.revision, 2);

    const replayA = await protocol('update', batchA);
    assert.equal(replayA.status, 200);
    assert.equal(replayA.body.eventId, a.body.eventId);
    assert.equal(replayA.body.reportDraft.replayed, true);

    const stale = await protocol('update', {
      ...batchA,
      '--report-draft-json': JSON.stringify({
        operationId: 'http-batch-c-01',
        expectedRevision: 1,
        operations: [{ op: 'withdraw', entryId: 'risk-1', reason: 'Resolved' }]
      })
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'report_draft_conflict');
    assert.equal(stale.body.details.currentRevision, 2);

    const read = await protocol('report-draft', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey
    });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.revision, 2);
    assert.deepEqual(read.body.inspection.agentReport.knownRisks, ['Refined']);

    const operatorOpen = await call('GET', `/api/objectives/${objective.id}/report-drafts`);
    assert.equal(operatorOpen.status, 200, JSON.stringify(operatorOpen.body));
    assert.equal(operatorOpen.body.drafts[0].state, 'open');
    assert.equal(operatorOpen.body.drafts[0].entries[0].content.text, 'Refined');

    // No live mission items exist before delivery.
    const items = await requireDatabaseClient().get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM mission_items WHERE mission_id = ?`,
      [mission.id]
    );
    assert.equal(Number(items?.n), 0);

    const missingRevision = await protocol('deliver', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--summary': 'Done.'
    });
    assert.equal(missingRevision.status, 409);
    assert.equal(missingRevision.body.code, 'report_draft_conflict');

    const delivered = await protocol('deliver', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--summary': 'Done.',
      '--expected-draft-revision': '2'
    });
    assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
    assert.equal(delivered.body.reportDraft.sealed, true);
    assert.deepEqual(delivered.body.reportDraft.refs, [
      { entryId: 'risk-1', ref: 'knownRisks[0]' }
    ]);

    const operatorSealed = await call(
      'GET',
      `/api/objectives/${objective.displayId}/report-drafts`
    );
    assert.equal(operatorSealed.status, 200);
    assert.equal(operatorSealed.body.drafts[0].state, 'sealed');
    assert.equal(operatorSealed.body.drafts[0].sealedDeliveryId, delivered.body.deliveryId);
    assert.equal(operatorSealed.body.drafts[0].entries[0].sealedRef, 'knownRisks[0]');

    const afterSeal = await protocol('update', batchA);
    assert.equal(afterSeal.status, 200, 'a sealed batch still replays as a receipt read');
    assert.equal(afterSeal.body.eventId, a.body.eventId);

    const missing = await call('GET', `/api/objectives/no-such-objective/report-drafts`);
    assert.equal(missing.status, 404);
  });

  it('rejects malformed draft input before any write', async () => {
    const project = await createProject({ name: `Draft HTTP bad ${Date.now()}`, color: '#123456' });
    const mission = await createMission({ projectId: project.id, firstObjective: 'Bad draft' });
    const objective = mission.objectives[0]!;
    const attached = await protocol('attach', { '--objective-id': objective.displayId });
    const sessionKey = attached.body.sessionKey as string;
    const bad = await protocol('update', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--report-draft-json': JSON.stringify({ expectedRevision: 0, operations: [] })
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'invalid_input');
    const both = await protocol('deliver', {
      '--objective-id': objective.displayId,
      '--session-key': sessionKey,
      '--summary': 'Done.',
      '--expected-draft-revision': '0',
      '--report-draft-json': JSON.stringify({ expectedRevision: 0 })
    });
    assert.equal(both.status, 400);
  });
});
