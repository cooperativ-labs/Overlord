import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

/**
 * The project tag and resource DELETE routes answer only after the deletion
 * has finished, so a failure reaches the caller as its error status.
 */

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4327';

const { createIntegrationTestDb } = await import('./test-helpers.ts');
const { tempDir } = await createIntegrationTestDb('overlord-project-delete-routes-');
const { createProject, createProjectTag, createUserToken, listProjectTags } =
  await import('./repository.ts');
const { app } = await import('./app.ts');

const UNKNOWN_PROJECT = '00000000-0000-4000-8000-000000000000';

let server: Server;
let baseUrl = '';
let secret = '';

before(async () => {
  secret = (await createUserToken({ label: 'delete-routes' })).secret;
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

function del(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${secret}` }
  });
}

describe('project delete routes', () => {
  it('report a missing project instead of acknowledging the request', async () => {
    assert.equal((await del(`/api/projects/${UNKNOWN_PROJECT}/tags/missing`)).status, 404);
    assert.equal((await del(`/api/projects/${UNKNOWN_PROJECT}/resources/missing`)).status, 404);
  });

  it('answer after the tag is removed', async () => {
    const project = await createProject({ name: 'Delete Routes' });
    const tag = await createProjectTag(project.id, { label: 'transient' });
    const response = await del(`/api/projects/${project.id}/tags/${tag.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await listProjectTags(project.id)).map(item => item.id),
      []
    );
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});
