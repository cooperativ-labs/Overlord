import type { Request, Response } from 'express';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { mock } from 'node:test';

// The OAuth handlers mint and revoke real USER_TOKENs, so these tests run
// against a real migrated SQLite database with an authenticated ADMIN operator
// (the approval endpoint is `requirePermission`-gated).
const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-oauth-test-'));
const { bootstrapIntegrationTestDb } = await import('./test-helpers.ts');
const { db } = await bootstrapIntegrationTestDb({
  sqlitePath: path.join(tempDir, 'oauth.sqlite')
});
const oauth = await import('./oauth.ts');
const { hashUserTokenSecret, USER_TOKEN_PREFIX } = await import('@overlord/auth');
const { setActiveProfileId } = await import('./db.ts');
const { resolveAuthorizedWorkspaces } = await import('./auth.ts');
const { verifyUserToken } = await import('@overlord/auth');
const { authDomainDatabase } = await import('./db.ts');
const { DEFAULT_TEST_ORGANIZATION_ID } = await import('./test-helpers.ts');

setActiveProfileId('operator-user');

const REDIRECT_URI = 'http://127.0.0.1:9876/callback';
const MCP_RESOURCE = 'https://overlord.example.test/mcp';
const CODE_VERIFIER = 'test-code-verifier-0123456789';
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER).digest('base64url');

type MockResponse = Response & { statusCode: number; payload: unknown };

function mockResponse(): MockResponse {
  const res = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.payload = body;
      return res;
    },
    redirect(url: string) {
      res.payload = url;
    }
  };
  return res as unknown as MockResponse;
}

function requestWith(body: Record<string, unknown>): Request {
  return {
    body,
    query: {},
    protocol: 'https',
    get: (name: string) => (name.toLowerCase() === 'host' ? 'overlord.example.test' : undefined)
  } as unknown as Request;
}

function registerClient(clientName: string): string {
  const res = mockResponse();
  oauth.handleOAuthRegister(
    requestWith({ client_name: clientName, redirect_uris: [REDIRECT_URI] }),
    res
  );
  assert.equal(res.statusCode, 201);
  return (res.payload as { client_id: string }).client_id;
}

async function approveAndGetCode(
  clientId: string,
  consent: Record<string, unknown> = {
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    workspaceIds: ['local-workspace'],
    allWorkspaces: false
  }
): Promise<string> {
  const res = mockResponse();
  await oauth.handleOAuthApprove(
    requestWith({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: CODE_CHALLENGE,
      resource: MCP_RESOURCE,
      state: 'test-state',
      decision: 'approve',
      ...consent
    }),
    res
  );
  const { redirectTo } = res.payload as { redirectTo: string };
  const code = new URL(redirectTo).searchParams.get('code');
  assert.ok(code, 'approval must redirect back with an authorization code');
  return code;
}

test('approval exposes live organizations and grants only the selected explicit workspace', async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
     VALUES ('oauth-second-workspace', ?, 'oauth-second', 'OAuth Second', 'local', '{}', ?, ?, 1)`
  ).run(DEFAULT_TEST_ORGANIZATION_ID, now, now);
  db.prepare(
    `INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES ('oauth-second-member', 'oauth-second-workspace', 'operator-user', 'auth:oauth-second', 'active', '{}', ?, ?, 1)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO role_assignments (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id, assigned_by_workspace_user_id, created_at, updated_at, revision)
     VALUES ('oauth-second-admin', 'oauth-second-workspace', 'oauth-second-member', 'ADMIN', '', '', 'oauth-second-member', ?, ?, 1)`
  ).run(now, now);

  const requestInfo = mockResponse();
  const clientId = registerClient('Scoped Consent Client');
  await oauth.handleOAuthRequestInfo(
    requestWith({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: CODE_CHALLENGE,
      resource: MCP_RESOURCE
    }),
    requestInfo
  );
  const organizations = (
    requestInfo.payload as { organizations: Array<{ id: string; workspaces: unknown[] }> }
  ).organizations;
  assert.equal(
    organizations.find(organization => organization.id === DEFAULT_TEST_ORGANIZATION_ID)?.workspaces
      .length,
    2
  );

  const code = await approveAndGetCode(clientId, {
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    workspaceIds: ['oauth-second-workspace'],
    allWorkspaces: false
  });
  const exchanged = await exchangeCode({ code, clientId });
  const accessToken = (exchanged.payload as { access_token: string }).access_token;
  const verified = await verifyUserToken(authDomainDatabase(), accessToken);
  assert.ok(verified);
  const authorized = await resolveAuthorizedWorkspaces('operator-user', verified);
  assert.deepEqual(
    authorized.workspaces.map(workspace => workspace.workspaceId),
    ['oauth-second-workspace']
  );

  db.prepare(
    `UPDATE workspace_users SET status = 'disabled' WHERE id = 'oauth-second-member'`
  ).run();
  const afterRemoval = await resolveAuthorizedWorkspaces('operator-user', verified);
  assert.deepEqual(
    afterRemoval.workspaces,
    [],
    'live membership removal narrows consent immediately'
  );
});

test('all-workspaces approval is organization-bounded and includes a future membership', async () => {
  const clientId = registerClient('All Workspaces Client');
  const code = await approveAndGetCode(clientId, {
    organizationId: DEFAULT_TEST_ORGANIZATION_ID,
    allWorkspaces: true,
    workspaceIds: []
  });
  const exchanged = await exchangeCode({ code, clientId });
  const verified = await verifyUserToken(
    authDomainDatabase(),
    (exchanged.payload as { access_token: string }).access_token
  );
  assert.ok(verified?.allWorkspaces);
  assert.equal(verified?.organizationId, DEFAULT_TEST_ORGANIZATION_ID);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
     VALUES ('oauth-future-workspace', ?, 'oauth-future', 'OAuth Future', 'local', '{}', ?, ?, 1)`
  ).run(DEFAULT_TEST_ORGANIZATION_ID, now, now);
  db.prepare(
    `INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES ('oauth-future-member', 'oauth-future-workspace', 'operator-user', 'auth:oauth-future', 'active', '{}', ?, ?, 1)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO role_assignments (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id, assigned_by_workspace_user_id, created_at, updated_at, revision)
     VALUES ('oauth-future-admin', 'oauth-future-workspace', 'oauth-future-member', 'ADMIN', '', '', 'oauth-future-member', ?, ?, 1)`
  ).run(now, now);
  const afterFutureMembership = await resolveAuthorizedWorkspaces('operator-user', verified!);
  assert.ok(
    afterFutureMembership.workspaces.some(
      workspace => workspace.workspaceId === 'oauth-future-workspace'
    )
  );
});

test('approval fails closed when memberships span organizations and no organization is selected', async () => {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, settings_json, created_at, updated_at, revision) VALUES ('oauth-other-org', 'OAuth Other', '{}', ?, ?, 1)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workspaces (id, organization_id, slug, name, kind, settings_json, created_at, updated_at, revision)
     VALUES ('oauth-other-workspace', 'oauth-other-org', 'oauth-other', 'OAuth Other Workspace', 'local', '{}', ?, ?, 1)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO workspace_users (id, workspace_id, profile_id, member_key, status, metadata_json, created_at, updated_at, revision)
     VALUES ('oauth-other-member', 'oauth-other-workspace', 'operator-user', 'auth:oauth-other', 'active', '{}', ?, ?, 1)`
  ).run(now, now);
  db.prepare(
    `INSERT INTO role_assignments (id, workspace_id, workspace_user_id, role_key, resource_type, resource_id, assigned_by_workspace_user_id, created_at, updated_at, revision)
     VALUES ('oauth-other-admin', 'oauth-other-workspace', 'oauth-other-member', 'ADMIN', '', '', 'oauth-other-member', ?, ?, 1)`
  ).run(now, now);
  const clientId = registerClient('Ambiguous Organization Client');
  await assert.rejects(
    () =>
      oauth.handleOAuthApprove(
        requestWith({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256',
          code_challenge: CODE_CHALLENGE,
          resource: MCP_RESOURCE,
          decision: 'approve',
          workspaceIds: ['local-workspace'],
          allWorkspaces: false
        }),
        mockResponse()
      ),
    (error: unknown) => error instanceof Error && (error as { status?: number }).status === 400
  );
});

async function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri?: string;
  codeVerifier?: string;
  resource?: string;
}): Promise<MockResponse> {
  const res = mockResponse();
  await oauth.handleOAuthToken(
    requestWith({
      grant_type: 'authorization_code',
      code: params.code,
      client_id: params.clientId,
      redirect_uri: params.redirectUri ?? REDIRECT_URI,
      code_verifier: params.codeVerifier ?? CODE_VERIFIER,
      resource: params.resource ?? MCP_RESOURCE
    }),
    res
  );
  return res;
}

function mintedTokenRow(clientName: string): { status: string; token_hash: string } {
  const row = db
    .prepare(
      `SELECT status, token_hash FROM user_tokens
        WHERE label = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(`OAuth MCP: ${clientName}`) as { status: string; token_hash: string } | undefined;
  assert.ok(row, `approval must have minted a token for ${clientName}`);
  return row;
}

test('authorization-code exchange delivers the minted USER_TOKEN', async () => {
  const clientId = registerClient('Happy Path Client');
  const code = await approveAndGetCode(clientId);

  const res = await exchangeCode({ code, clientId });
  assert.equal(res.statusCode, 200);
  const { access_token } = res.payload as { access_token: string };

  assert.ok(access_token.startsWith(USER_TOKEN_PREFIX), 'access token is a USER_TOKEN secret');
  const row = mintedTokenRow('Happy Path Client');
  assert.equal(row.status, 'active');
  assert.equal(
    row.token_hash,
    hashUserTokenSecret(access_token),
    'the delivered secret hashes to the stored token_hash (mint and verify share one format)'
  );
});

test('a failed PKCE exchange consumes the code and revokes the minted token', async () => {
  const clientId = registerClient('PKCE Failure Client');
  const code = await approveAndGetCode(clientId);

  const failed = await exchangeCode({ code, clientId, codeVerifier: 'wrong-verifier' });
  assert.equal(failed.statusCode, 400);
  assert.equal((failed.payload as { error: string }).error, 'invalid_grant');
  assert.equal(
    mintedTokenRow('PKCE Failure Client').status,
    'revoked',
    'the token the code would have delivered must not stay active'
  );

  // Single-use: retrying with the correct verifier cannot resurrect the code.
  const retry = await exchangeCode({ code, clientId });
  assert.equal(retry.statusCode, 400);
  assert.equal((retry.payload as { error: string }).error, 'invalid_grant');
});

test('a client mismatch on exchange revokes the minted token', async () => {
  const clientId = registerClient('Mismatch Client');
  const otherClientId = registerClient('Some Other Client');
  const code = await approveAndGetCode(clientId);

  const failed = await exchangeCode({ code, clientId: otherClientId });
  assert.equal(failed.statusCode, 400);
  assert.equal((failed.payload as { error: string }).error, 'invalid_grant');
  assert.equal(mintedTokenRow('Mismatch Client').status, 'revoked');
});

test('a resource mismatch on exchange revokes the minted token', async () => {
  const clientId = registerClient('Resource Mismatch Client');
  const code = await approveAndGetCode(clientId);

  const failed = await exchangeCode({
    code,
    clientId,
    resource: 'https://another.example.test/mcp'
  });
  assert.equal(failed.statusCode, 400);
  assert.equal((failed.payload as { error: string }).error, 'invalid_target');
  assert.equal(mintedTokenRow('Resource Mismatch Client').status, 'revoked');
});

test('an expired unexchanged code revokes its token instead of orphaning it', async () => {
  const clientId = registerClient('Expiring Client');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const code = await approveAndGetCode(clientId);
    // Past the 5-minute authorization-code TTL.
    mock.timers.setTime(Date.now() + 6 * 60 * 1000);

    const res = await exchangeCode({ code, clientId });
    assert.equal(res.statusCode, 400);
    assert.equal((res.payload as { error: string }).error, 'invalid_grant');
    assert.equal(
      mintedTokenRow('Expiring Client').status,
      'revoked',
      'expiry must revoke the token the code would have delivered'
    );
  } finally {
    mock.timers.reset();
  }
});

test('the approve-time sweep revokes tokens of codes that expired unexchanged', async () => {
  const abandonedClientId = registerClient('Abandoned Client');
  const freshClientId = registerClient('Fresh Client');
  mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    await approveAndGetCode(abandonedClientId);
    mock.timers.setTime(Date.now() + 6 * 60 * 1000);

    // The next approval sweeps the expired pending code without any exchange
    // attempt ever happening for it.
    await approveAndGetCode(freshClientId);
    assert.equal(mintedTokenRow('Abandoned Client').status, 'revoked');
    assert.equal(mintedTokenRow('Fresh Client').status, 'active');
  } finally {
    mock.timers.reset();
  }
});

// A hosted backend sits behind a TLS-terminating proxy: the app itself receives
// plain HTTP, and the origin clients actually connect to is the web app's. Both
// halves of that must be right, or an approval fails `invalid_target` with the
// client having done nothing wrong.
function proxiedRequest(body: Record<string, unknown>, host: string): Request {
  return {
    body,
    query: {},
    // Express reports the hop from the proxy, not the client's TLS connection.
    protocol: 'http',
    get: (name: string) => (name.toLowerCase() === 'host' ? host : undefined)
  } as unknown as Request;
}

test('discovery metadata behind a TLS-terminating proxy advertises https, not the proxy hop', () => {
  const metadata = oauth.oauthProtectedResourceMetadata(proxiedRequest({}, 'backend.example.test'));
  assert.equal(metadata.resource, 'https://backend.example.test/mcp');
  assert.deepEqual(metadata.authorization_servers, ['https://backend.example.test']);

  const authServer = oauth.oauthAuthorizationServerMetadata(
    proxiedRequest({}, 'backend.example.test')
  );
  assert.equal(authServer.issuer, 'https://backend.example.test');

  // A loopback backend is genuinely http; Overlord Local must not be upgraded.
  assert.equal(
    oauth.oauthProtectedResourceMetadata(proxiedRequest({}, 'localhost:3000')).resource,
    'http://localhost:3000/mcp'
  );
});

test('a configured public origin wins over the backend hostname clients never see', () => {
  process.env.OVERLORD_WEBAPP_PUBLIC_URL = 'https://app.example.test/';
  try {
    assert.equal(
      oauth.oauthProtectedResourceMetadata(proxiedRequest({}, 'backend.example.test')).resource,
      'https://app.example.test/mcp'
    );
  } finally {
    delete process.env.OVERLORD_WEBAPP_PUBLIC_URL;
  }
});

test('a resource mismatch names both origins so the deployment can be fixed', async () => {
  const clientId = registerClient('Proxy Origin Client');
  const res = mockResponse();
  await assert.rejects(
    () =>
      oauth.handleOAuthRequestInfo(
        proxiedRequest(
          {
            response_type: 'code',
            client_id: clientId,
            redirect_uri: REDIRECT_URI,
            code_challenge_method: 'S256',
            code_challenge: CODE_CHALLENGE,
            // What a client that connected through the web app sends.
            resource: 'https://app.example.test/mcp'
          },
          'backend.example.test'
        ),
        res
      ),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, 'invalid_target');
      assert.match(error.message, /expected https:\/\/backend\.example\.test\/mcp/);
      assert.match(error.message, /received https:\/\/app\.example\.test\/mcp/);
      return true;
    }
  );
});
