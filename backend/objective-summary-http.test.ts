import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { listenForTest, type TestServer } from './http/test-app-fixture.ts';

/**
 * The objective summary REST surface through the real app (ADR 0059):
 * request validation of the new body fields and route, the ObjectiveDto brief
 * projection, and stable failure codes. Run under the API conformance report,
 * every response here is also checked against its OpenAPI operation (ADR 0051).
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4327';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-objective-summary-http-');
const { createProject, createUserToken } = await import('./repository.ts');
const { app } = await import('./app.ts');

const LONG =
  `Rebuild the objective summary surfaces. ${'Keep every prohibition and file path exact. '.repeat(9)}`.trim();

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

before(async () => {
  secret = (await createUserToken({ label: 'objective-summary-http' })).secret;
  server = await listenForTest(app);
  baseUrl = server.baseUrl;
});

describe('objective summary REST surface', () => {
  it('creates, edits, removes and re-summarizes through REST', async () => {
    const project = await createProject({ name: `HTTP summaries ${Date.now()}` });
    const mission = await call('POST', '/api/missions', {
      projectId: project.id,
      objectives: [{ instructions: LONG, summary: 'Written by a person.' }]
    });
    assert.equal(mission.status, 200, JSON.stringify(mission.body));
    const objective = mission.body.objectives[0];
    assert.equal(objective.summary, 'Written by a person.');
    assert.equal(objective.summarySource, 'user');
    assert.equal(objective.summaryEligible, true);

    const added = await call('POST', '/api/objectives', {
      missionId: mission.body.id,
      instructionText: LONG,
      summary: 'A second summary.'
    });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.summary, 'A second summary.');

    const edited = await call('PATCH', `/api/objectives/${objective.id}`, {
      summary: 'Edited by a person.',
      expectedSummaryRevision: objective.summaryRevision
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.summary, 'Edited by a person.');

    const conflict = await call('PATCH', `/api/objectives/${objective.id}`, {
      summary: 'Stale.',
      expectedSummaryRevision: objective.summaryRevision
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'summary_conflict');
    assert.equal(conflict.body.details.summary, 'Edited by a person.');

    const invalid = await call('PATCH', `/api/objectives/${objective.id}`, { summary: 7 });
    assert.equal(invalid.status, 400);

    const removed = await call('PATCH', `/api/objectives/${objective.id}`, { summary: null });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.summary, null);
    assert.equal(removed.body.summarySuppressed, true);

    const retry = await call('POST', `/api/objectives/${objective.id}/summary-requests`, {
      mode: 'retry'
    });
    assert.equal(retry.status, 409);
    assert.equal(retry.body.code, 'summary_not_failed');

    const badMode = await call('POST', `/api/objectives/${objective.id}/summary-requests`, {
      mode: 'later'
    });
    assert.equal(badMode.status, 400);

    const summarized = await call('POST', `/api/objectives/${objective.id}/summary-requests`, {
      mode: 'summarize'
    });
    assert.equal(summarized.status, 200, JSON.stringify(summarized.body));
    assert.equal(summarized.body.summarySuppressed, false);
    assert.equal(summarized.body.summaryStatus, 'pending');

    const missing = await call(
      'POST',
      '/api/objectives/00000000-0000-4000-8000-000000000000/summary-requests',
      { mode: 'summarize' }
    );
    assert.equal(missing.status, 404);
  });
});

after(async () => {
  await server.close();
  rmSync(tempDir, { recursive: true, force: true });
});
