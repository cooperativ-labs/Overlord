import { migrateDatabase, openDatabase } from '@overlord/database';
import Database from 'better-sqlite3';
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateUserTokenSecret } from '../auth/src/index.ts';
import { runOvld } from '../test/support/cli.ts';

import { seedAuthenticatedOperator } from './test-helpers.ts';

/**
 * Phase 3 end-to-end verification for `project_automation` tokens (contract v151,
 * plan `planning/feature-plans/project-scoped-tokens-and-token-auto-tags.md` §7–§9).
 *
 * The real backend process is booted on a throwaway SQLite database so every
 * surface an automation touches is exercised over HTTP exactly as a customer
 * integration would: REST, `POST /api/protocol/:subcommand`, the CLI client,
 * hosted MCP, `/sync/changes`, and the SSE stream. Project P is selected on the
 * token; project Q shares P's workspace and project R lives in a second
 * workspace of the same organization. Q and R must be invisible everywhere.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORGANIZATION_ID = 'test-organization';
const WS_A = 'automation-ws-a';
const WS_B = 'automation-ws-b';
const PROFILE_ID = 'operator-user';
const WS_A_USER = 'automation-ws-a-member';
const WS_B_USER = 'automation-ws-b-member';
const TOKEN_LABEL = 'Feedback importer';
const RENAMED_LABEL = 'Feedback importer v2';
const RANDOM_UUID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

interface Fixture {
  projectId: string;
  missionId: string;
  missionDisplayId: string;
  objectiveId: string;
  objectiveDisplayId: string;
  attachmentStorageKey: string;
  attachmentId: string;
  sessionKey: string;
}

type Json = Record<string, any>;

interface ApiResponse {
  status: number;
  text: string;
  json: any;
}

let tempDir = '';
let dbPath = '';
let baseUrl = '';
let backend: ChildProcess | null = null;
let backendLog = '';
let fullSecret = '';
let fullTokenId = '';
let automationSecret = '';
let automationTokenId = '';
let P: Fixture;
let Q: Fixture;
let R: Fixture;
let readDb: Database.Database;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function request(
  token: string | null,
  method: string,
  route: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {}
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof Uint8Array) {
    payload = new Blob([Uint8Array.from(body)]);
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, { method, headers, body: payload });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json };
}

const full = (method: string, route: string, body?: unknown, headers?: Record<string, string>) =>
  request(fullSecret, method, route, body, headers);
const auto = (method: string, route: string, body?: unknown, headers?: Record<string, string>) =>
  request(automationSecret, method, route, body, headers);

async function expectOk(promise: Promise<ApiResponse>, label: string): Promise<any> {
  const response = await promise;
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${label}: expected success, got ${response.status} ${response.text.slice(0, 300)}`
  );
  return response.json;
}

async function expectNotFound(promise: Promise<ApiResponse>, label: string): Promise<void> {
  const response = await promise;
  assert.equal(
    response.status,
    404,
    `${label}: expected 404, got ${response.status} ${response.text.slice(0, 300)}`
  );
}

function protocol(token: string, subcommand: string, flags: Record<string, string | boolean>) {
  return request(token, 'POST', `/api/protocol/${subcommand}`, { flags });
}

async function mcpCall(token: string, name: string, args: Json, id = 1): Promise<Json> {
  const response = await request(token, 'POST', '/mcp', {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args }
  });
  assert.equal(
    response.status,
    200,
    `MCP ${name}: ${response.status} ${response.text.slice(0, 300)}`
  );
  return response.json as Json;
}

function assertNoLeak(text: string, label: string): void {
  for (const [name, fixture] of [
    ['Q', Q],
    ['R', R]
  ] as const) {
    for (const needle of [
      fixture.projectId,
      fixture.missionId,
      fixture.missionDisplayId,
      fixture.objectiveId,
      fixture.attachmentStorageKey,
      `Project ${name}`
    ]) {
      assert.ok(!text.includes(needle), `${label} leaked ${name} identifier ${needle}`);
    }
  }
}

/** Row counts for every business table; denied calls must leave them unchanged. */
function snapshotRowCounts(): Record<string, number> {
  const tables = readDb
    .prepare(
      `SELECT name FROM sqlite_schema
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT IN ('schema_migrations', 'entity_changes')
          AND name NOT LIKE '%_fts%'`
    )
    .all() as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const row = readDb.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get() as {
      count: number;
    };
    counts[name] = row.count;
  }
  return counts;
}

class SseReader {
  readonly events: Array<{ event: string; id: number | null; data: any }> = [];
  private buffer = '';
  private readonly controller = new AbortController();
  private done: Promise<void> = Promise.resolve();

  async open(token: string, route: string, headers: Record<string, string> = {}): Promise<void> {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...headers },
      signal: this.controller.signal
    });
    assert.equal(response.status, 200, `SSE ${route}: ${response.status}`);
    assert.ok(response.body, 'SSE stream has a body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    this.done = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          this.buffer += decoder.decode(value, { stream: true });
          let index = this.buffer.indexOf('\n\n');
          while (index !== -1) {
            this.parse(this.buffer.slice(0, index));
            this.buffer = this.buffer.slice(index + 2);
            index = this.buffer.indexOf('\n\n');
          }
        }
      } catch {
        // Aborted by close().
      }
    })();
  }

  private parse(block: string): void {
    if (!block.trim() || block.startsWith(':')) return;
    let event = 'message';
    let id: number | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('id: ')) id = Number(line.slice(4));
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (data.length === 0) return;
    this.events.push({ event, id, data: JSON.parse(data.join('\n')) });
  }

  changes(): Array<{
    projectId: string | null;
    missionId: string | null;
    workspaceId: string;
    entityType: string;
  }> {
    return this.events
      .filter(entry => entry.event === 'change')
      .flatMap(entry => entry.data.changes as Array<any>);
  }

  async waitFor(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for SSE event; received ${JSON.stringify(this.events)}`);
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.done;
  }
}

function insertToken(
  db: Database.Database,
  { id, label, scope }: { id: string; label: string; scope: 'full' }
): string {
  const minted = generateUserTokenSecret();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_tokens (
       id, workspace_id, organization_id, all_workspaces, profile_id, label, scope,
       token_prefix, token_hash, hash_algorithm, status, last_used_context_json,
       metadata_json, created_at, updated_at, revision
     ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 'sha256', 'active', '{}', '{}', ?, ?, 1)`
  ).run(id, WS_A, ORGANIZATION_ID, PROFILE_ID, label, scope, minted.prefix, minted.hash, now, now);
  return minted.secret;
}

async function waitForBackend(): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (backend?.exitCode !== null && backend?.exitCode !== undefined) {
      throw new Error(`backend exited with ${backend.exitCode}\n${backendLog}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`backend did not start\n${backendLog}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function createProject(name: string, workspaceId: string): Promise<string> {
  const project = await expectOk(
    full('POST', '/api/projects', { name, workspaceId }),
    `create ${name}`
  );
  return project.id as string;
}

async function seedProjectFixture(name: string, workspaceId: string): Promise<Fixture> {
  const projectId = await createProject(name, workspaceId);
  const mission = await expectOk(
    full('POST', '/api/missions', {
      projectId,
      title: `${name} feedback triage`,
      objectives: [
        { objective: `Investigate ${name} feedback` },
        { objective: `Resolve ${name} feedback` }
      ]
    }),
    `create ${name} mission`
  );
  const objectives = await expectOk(
    full('GET', `/api/missions/${mission.id}/objectives`),
    `list ${name} objectives`
  );
  assert.equal(objectives.length, 2);
  const objective = objectives[0];
  await expectOk(
    protocol(fullSecret, 'discuss-objective', { '--mission-id': mission.displayId }),
    `discuss ${name}`
  );
  const attached = await expectOk(
    protocol(fullSecret, 'attach', {
      '--mission-id': mission.displayId,
      '--objective-id': objective.displayId,
      '--agent': 'claude'
    }),
    `attach ${name}`
  );
  const sessionKey = attached.session.sessionKey as string;
  assert.ok(sessionKey);
  await expectOk(
    protocol(fullSecret, 'update', {
      '--mission-id': mission.displayId,
      '--session-key': sessionKey,
      '--summary': `Working on ${name}`,
      '--phase': 'execute'
    }),
    `update ${name}`
  );
  await expectOk(
    protocol(fullSecret, 'add-artifact', {
      '--mission-id': mission.displayId,
      '--session-key': sessionKey,
      '--type': 'note',
      '--label': `${name} plan`,
      '--content-text': `Plan for ${name}`
    }),
    `artifact ${name}`
  );
  const attachment = await expectOk(
    full(
      'POST',
      `/api/objectives/${objective.id}/attachments`,
      new TextEncoder().encode(`attachment for ${name}`),
      { 'Content-Type': 'text/plain', 'x-upload-filename': `${name}-notes.txt` }
    ),
    `attachment ${name}`
  );
  await expectOk(
    protocol(fullSecret, 'deliver', {
      '--mission-id': mission.displayId,
      '--session-key': sessionKey,
      '--summary': `Delivered ${name}`
    }),
    `deliver ${name}`
  );
  return {
    projectId,
    missionId: mission.id,
    missionDisplayId: mission.displayId,
    objectiveId: objective.id,
    objectiveDisplayId: objective.displayId,
    attachmentStorageKey: attachment.storageKey,
    attachmentId: attachment.id,
    sessionKey
  };
}

before(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-project-automation-e2e-'));
  dbPath = path.join(tempDir, 'overlord.sqlite');
  const storageDir = path.join(tempDir, 'storage');
  mkdirSync(storageDir, { recursive: true });

  const seed = openDatabase({ databasePath: dbPath });
  migrateDatabase(seed);
  seedAuthenticatedOperator({
    db: seed,
    organizationId: ORGANIZATION_ID,
    workspaceId: WS_A,
    profileId: PROFILE_ID,
    workspaceUserId: WS_A_USER
  });
  seedAuthenticatedOperator({
    db: seed,
    organizationId: ORGANIZATION_ID,
    workspaceId: WS_B,
    profileId: PROFILE_ID,
    workspaceUserId: WS_B_USER
  });
  seed.prepare(`UPDATE storage_buckets SET local_path = ?`).run(storageDir);
  fullTokenId = 'automation-e2e-full-token';
  fullSecret = insertToken(seed, { id: fullTokenId, label: 'Operator CLI', scope: 'full' });
  seed.close();

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OVERLORD_SQLITE_PATH: dbPath,
    OVERLORD_WEB_HOST: '127.0.0.1',
    OVERLORD_WEB_PORT: String(port),
    OVERLORD_MCP_ENABLED: 'true',
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? 'project-automation-e2e-secret-32-chars-minimum',
    BETTER_AUTH_URL: baseUrl,
    BACKEND_URL: baseUrl,
    OVERLORD_BACKEND_URL_DEV: baseUrl
  };
  delete env.DATABASE_URL;
  delete env.OVERLORD_BACKEND_URL;
  backend = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(repoRoot, 'backend', 'index.ts')],
    {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  backend.stdout?.on('data', chunk => {
    backendLog += String(chunk);
  });
  backend.stderr?.on('data', chunk => {
    backendLog += String(chunk);
  });
  await waitForBackend();
  readDb = new Database(dbPath, { readonly: true });

  P = await seedProjectFixture('Project P', WS_A);
  Q = await seedProjectFixture('Project Q', WS_A);
  R = await seedProjectFixture('Project R', WS_B);

  const issued = await expectOk(
    full('POST', '/api/user-tokens', {
      label: TOKEN_LABEL,
      scope: 'project_automation',
      projectIds: [P.projectId]
    }),
    'issue automation token'
  );
  automationSecret = issued.secret;
  automationTokenId = issued.token.id;
  assert.equal(issued.token.scope, 'project_automation');
  assert.deepEqual(
    issued.token.projects.map((project: Json) => project.id),
    [P.projectId]
  );
});

after(async () => {
  readDb?.close();
  if (backend && backend.exitCode === null) {
    backend.kill('SIGTERM');
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => {
        backend?.kill('SIGKILL');
        resolve();
      }, 5_000);
      backend?.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe('issuance', () => {
  it('requires selected projects and rejects projects outside the owner reach', async () => {
    const missing = await full('POST', '/api/user-tokens', {
      label: 'no projects',
      scope: 'project_automation'
    });
    assert.equal(missing.status, 400, missing.text);
    const unknown = await full('POST', '/api/user-tokens', {
      label: 'unknown project',
      scope: 'project_automation',
      projectIds: [RANDOM_UUID]
    });
    assert.equal(unknown.status, 404, unknown.text);
    const wrongPreset = await full('POST', '/api/user-tokens', {
      label: 'full with projects',
      scope: 'full',
      projectIds: [P.projectId]
    });
    assert.equal(wrongPreset.status, 400, wrongPreset.text);
  });

  it('consents only to the workspace owning the selected project', async () => {
    const consent = readDb
      .prepare(
        `SELECT all_workspaces,
                (SELECT group_concat(workspace_id) FROM user_token_workspaces WHERE token_id = t.id) AS workspaces,
                (SELECT group_concat(project_id) FROM user_token_projects WHERE token_id = t.id) AS projects
           FROM user_tokens t WHERE t.id = ?`
      )
      .get(automationTokenId) as { all_workspaces: number; workspaces: string; projects: string };
    assert.deepEqual(consent, { all_workspaces: 0, workspaces: WS_A, projects: P.projectId });
    const workspaces = await expectOk(
      auto('GET', '/api/authorized-workspaces'),
      'authorized workspaces'
    );
    const text = JSON.stringify(workspaces);
    assert.ok(text.includes(WS_A));
    assert.ok(!text.includes(WS_B), 'second workspace must not be listed');
  });
});

describe('reads inside the selected project', () => {
  it('serves project P, its statuses, tags, missions, objectives, events, sessions, deliveries, artifacts, attachments and context', async () => {
    const projects = await expectOk(auto('GET', '/api/projects'), 'projects');
    assert.deepEqual(
      projects.map((project: Json) => project.id),
      [P.projectId]
    );
    const project = await expectOk(auto('GET', `/api/projects/${P.projectId}`), 'project P');
    assert.equal(project.id, P.projectId);
    const statuses = await expectOk(
      auto('GET', `/api/projects/${P.projectId}/statuses`),
      'statuses'
    );
    assert.ok(Array.isArray(statuses) && statuses.length > 0);
    await expectOk(auto('GET', `/api/projects/${P.projectId}/tags`), 'tags');
    const missions = await expectOk(
      auto('GET', `/api/projects/${P.projectId}/missions?includeObjectives=1`),
      'missions'
    );
    assert.ok(missions.some((mission: Json) => mission.id === P.missionId));
    assertNoLeak(JSON.stringify(missions), 'project missions');

    for (const ref of [P.missionId, P.missionDisplayId]) {
      const detail = await expectOk(auto('GET', `/api/missions/${ref}`), `mission ${ref}`);
      assert.equal(detail.id, P.missionId);
      assert.ok(detail.objectives.length === 2);
    }
    const objectives = await expectOk(
      auto('GET', `/api/missions/${P.missionId}/objectives`),
      'objectives'
    );
    assert.equal(objectives.length, 2);
    const events = await expectOk(auto('GET', `/api/missions/${P.missionId}/events`), 'events');
    assert.ok(JSON.stringify(events).includes('Working on Project P'));
    const deliveries = await expectOk(
      auto('GET', `/api/missions/${P.missionId}/deliveries`),
      'deliveries'
    );
    assert.ok(JSON.stringify(deliveries).includes('Delivered Project P'));
    const artifacts = await expectOk(
      auto('GET', `/api/missions/${P.missionId}/artifacts`),
      'artifacts'
    );
    assert.ok(artifacts.some((artifact: Json) => artifact.label === 'Project P plan'));
    await expectOk(auto('GET', `/api/missions/${P.missionId}/context`), 'context');
    await expectOk(auto('GET', `/api/missions/${P.missionId}/file-changes`), 'file changes');
    const attachments = await expectOk(
      auto('GET', `/api/objectives/${P.objectiveId}/attachments`),
      'attachments'
    );
    assert.ok(attachments.some((attachment: Json) => attachment.id === P.attachmentId));
    const file = await auto(
      'GET',
      `/api/storage/attachments/${encodeURIComponent(P.attachmentStorageKey)}`
    );
    assert.equal(file.status, 200, file.text);
    assert.equal(file.text, 'attachment for Project P');

    const context = await expectOk(
      protocol(automationSecret, 'load-context', { '--mission-id': P.missionDisplayId }),
      'load-context'
    );
    assert.equal(context.mission.id, P.missionId);
    assert.ok(Array.isArray(context.history), 'load-context exposes session history');
    assert.ok(
      JSON.stringify(context).includes(P.sessionKey.slice(0, 4)) ||
        JSON.stringify(context).includes('claude'),
      'session metadata is readable'
    );
    const listDeliveries = await expectOk(
      protocol(automationSecret, 'list-deliveries', { '--mission-id': P.missionDisplayId }),
      'list-deliveries'
    );
    assert.ok(JSON.stringify(listDeliveries).includes('Delivered Project P'));
    const attachmentList = await expectOk(
      protocol(automationSecret, 'attachment-list', {
        '--mission-id': P.missionDisplayId,
        '--objective-id': P.objectiveDisplayId
      }),
      'attachment-list'
    );
    assert.ok(attachmentList.some((attachment: Json) => attachment.id === P.attachmentId));
    const downloadUrl = await expectOk(
      protocol(automationSecret, 'attachment-download-url', {
        '--mission-id': P.missionDisplayId,
        '--attachment-id': P.attachmentId
      }),
      'attachment-download-url'
    );
    assert.ok(String(downloadUrl.url).includes('/api/storage/attachments/'));
    const projectStatuses = await expectOk(
      protocol(automationSecret, 'statuses', { '--project-id': P.projectId }),
      'statuses'
    );
    assert.ok(JSON.stringify(projectStatuses).length > 2);
    const discovered = await expectOk(
      protocol(automationSecret, 'discover-project', { '--project-id': P.projectId }),
      'discover-project'
    );
    assert.ok(JSON.stringify(discovered).includes(P.projectId));
    await expectOk(protocol(automationSecret, 'auth-status', {}), 'auth-status');
  });

  it('hides Q and the other workspace from every list, search, sync and pagination total', async () => {
    const search = await expectOk(auto('GET', '/api/search/v3?q=feedback&limit=50'), 'search v3');
    const searchText = JSON.stringify(search);
    assert.ok(searchText.includes(P.missionId), 'search finds the P mission');
    assertNoLeak(searchText, 'search v3');
    const totals = JSON.stringify(search).match(/"total":(\d+)/g) ?? [];
    for (const total of totals) {
      assert.ok(
        Number(total.split(':')[1]) <= 1,
        `pagination total counts hidden missions: ${total}`
      );
    }
    const scopedToQ = await auto('GET', `/api/search/v3?q=feedback&projectIds=${Q.projectId}`);
    assert.equal(scopedToQ.status, 404, scopedToQ.text);
    const scopedToR = await auto('GET', `/api/search/v3?q=feedback&projectIds=${R.projectId}`);
    assert.equal(scopedToR.status, 404, scopedToR.text);

    const protocolSearch = await expectOk(
      protocol(automationSecret, 'search-missions', {
        '--query': 'feedback',
        '--response-version': '3'
      }),
      'protocol search v3'
    );
    assertNoLeak(JSON.stringify(protocolSearch), 'protocol search');
    for (const version of ['1', '2']) {
      const legacy = await protocol(automationSecret, 'search-missions', {
        '--query': 'feedback',
        '--response-version': version
      });
      assert.ok(
        legacy.status === 404 || !JSON.stringify(legacy.json).includes(Q.missionId),
        `protocol search v${version} leaked Q`
      );
      assertNoLeak(legacy.text, `protocol search v${version}`);
    }
    const searchAlias = await protocol(automationSecret, 'search', { '--query': 'feedback' });
    assertNoLeak(searchAlias.text, 'protocol search alias');

    const sync = await expectOk(auto('GET', '/sync/changes?after=0'), 'sync changes');
    assert.ok(sync.changes.length > 0, 'P changes are visible');
    for (const change of sync.changes) {
      assert.equal(change.projectId, P.projectId, JSON.stringify(change));
      assert.equal(change.workspaceId, WS_A);
    }
    assert.equal(sync.hasMore, false);
    const fullSync = await expectOk(full('GET', '/sync/changes?after=0'), 'full sync');
    assert.ok(
      fullSync.changes.some((change: Json) => change.projectId === Q.projectId),
      'control: the full token sees Q rows in the same feed'
    );
  });

  it('returns 404 for Q and R by UUID, display id, storage key and agent request id', async () => {
    for (const fixture of [Q, R]) {
      await expectNotFound(auto('GET', `/api/projects/${fixture.projectId}`), 'project');
      await expectNotFound(auto('GET', `/api/projects/${fixture.projectId}/statuses`), 'statuses');
      await expectNotFound(auto('GET', `/api/projects/${fixture.projectId}/tags`), 'tags');
      await expectNotFound(auto('GET', `/api/projects/${fixture.projectId}/missions`), 'missions');
      await expectNotFound(auto('GET', `/api/missions/${fixture.missionId}`), 'mission uuid');
      await expectNotFound(
        auto('GET', `/api/missions/${fixture.missionDisplayId}`),
        'mission display id'
      );
      for (const sub of [
        'objectives',
        'events',
        'deliveries',
        'artifacts',
        'context',
        'file-changes'
      ]) {
        await expectNotFound(auto('GET', `/api/missions/${fixture.missionId}/${sub}`), sub);
      }
      await expectNotFound(
        auto('GET', `/api/objectives/${fixture.objectiveId}/attachments`),
        'attachments'
      );
      await expectNotFound(
        auto('GET', `/api/storage/attachments/${encodeURIComponent(fixture.attachmentStorageKey)}`),
        'storage key'
      );
      await expectNotFound(
        protocol(automationSecret, 'load-context', { '--mission-id': fixture.missionDisplayId }),
        'load-context'
      );
      await expectNotFound(
        protocol(automationSecret, 'load-context', { '--mission-id': fixture.missionId }),
        'load-context uuid'
      );
      await expectNotFound(
        protocol(automationSecret, 'statuses', { '--project-id': fixture.projectId }),
        'statuses'
      );
      await expectNotFound(
        protocol(automationSecret, 'discover-project', { '--project-id': fixture.projectId }),
        'discover-project'
      );
      await expectNotFound(
        protocol(automationSecret, 'list-deliveries', { '--mission-id': fixture.missionDisplayId }),
        'list-deliveries'
      );
      await expectNotFound(
        protocol(automationSecret, 'attachment-list', {
          '--mission-id': fixture.missionDisplayId,
          '--objective-id': fixture.objectiveDisplayId
        }),
        'attachment-list'
      );
    }
    await expectNotFound(
      auto('GET', `/api/agent-requests?objectiveId=${Q.objectiveDisplayId}`),
      'agent requests'
    );
    await expectNotFound(auto('GET', `/api/agent-requests/${RANDOM_UUID}`), 'agent request id');
    await expectNotFound(
      auto('GET', `/api/objectives/${P.objectiveId}`),
      'objective detail is off the allowlist'
    );
  });
});

describe('realtime', () => {
  it('filters SSE catch-up and live broadcast to the selected project', async () => {
    const stream = new SseReader();
    await stream.open(automationSecret, '/api/stream?after=0');
    await stream.waitFor(() => stream.events.some(entry => entry.event === 'hello'));
    await stream.waitFor(() => stream.changes().length > 0);
    await new Promise(resolve => setTimeout(resolve, 700));
    const catchUp = stream.changes();
    assert.ok(
      catchUp.some(change => change.missionId === P.missionId),
      'catch-up includes P'
    );
    for (const change of catchUp) {
      assert.equal(change.projectId, P.projectId, JSON.stringify(change));
    }
    assert.ok(
      !stream.events.some(entry => entry.event === 'refresh'),
      'no coarse refresh for automations'
    );

    const seenBefore = stream.changes().length;
    const hiddenMission = await expectOk(
      full('POST', '/api/missions', {
        projectId: Q.projectId,
        title: 'Q live event',
        firstObjective: 'Hidden'
      }),
      'create Q mission'
    );
    await new Promise(resolve => setTimeout(resolve, 1_500));
    const afterHidden = stream.changes().slice(seenBefore);
    assert.deepEqual(
      afterHidden.filter(change => change.projectId !== P.projectId),
      [],
      `live broadcast leaked non-P rows: ${JSON.stringify(afterHidden)}`
    );
    assert.ok(!JSON.stringify(stream.events).includes(hiddenMission.id));

    const visibleMission = await expectOk(
      full('POST', '/api/missions', {
        projectId: P.projectId,
        title: 'P live event',
        firstObjective: 'Visible'
      }),
      'create P mission'
    );
    await stream.waitFor(() =>
      stream.changes().some(change => change.missionId === visibleMission.id)
    );
    await stream.close();

    const resumed = new SseReader();
    await resumed.open(automationSecret, '/realtime', { 'Last-Event-ID': '0' });
    await resumed.waitFor(() =>
      resumed.changes().some(change => change.missionId === visibleMission.id)
    );
    assert.ok(
      !JSON.stringify(resumed.events).includes(hiddenMission.id),
      'reconnect catch-up hides Q'
    );
    await resumed.close();
  });
});

describe('mission creation', () => {
  it('creates a mission with initial objectives in P through REST, protocol create, the CLI client and hosted MCP', async () => {
    const rest = await expectOk(
      auto('POST', '/api/missions', {
        projectId: P.projectId,
        title: 'REST feedback',
        objectives: [{ objective: 'Triage REST feedback' }, { objective: 'Reply to REST feedback' }]
      }),
      'REST create'
    );
    assert.deepEqual(rest.createdByToken, { tokenId: automationTokenId, label: TOKEN_LABEL });
    assert.equal(rest.assignedWorkspaceUserId, null, 'automation missions default to unassigned');
    assert.equal(rest.createdByKind, 'human');
    const restObjectives = await expectOk(
      auto('GET', `/api/missions/${rest.id}/objectives`),
      'REST objectives'
    );
    assert.equal(restObjectives.length, 2);

    const assigned = await expectOk(
      auto('POST', '/api/missions', {
        projectId: P.projectId,
        title: 'Assigned feedback',
        firstObjective: 'Explicit assignee',
        assignedWorkspaceUserId: WS_A_USER
      }),
      'REST create assigned'
    );
    assert.equal(assigned.assignedWorkspaceUserId, WS_A_USER);

    const viaProtocol = await expectOk(
      protocol(automationSecret, 'create', {
        '--project-id': P.projectId,
        '--title': 'Protocol feedback',
        '--objectives-json': JSON.stringify([
          { objective: 'Triage protocol feedback' },
          { objective: 'Reply to protocol feedback' }
        ])
      }),
      'protocol create'
    );
    const protocolDetail = await expectOk(
      auto('GET', `/api/missions/${viaProtocol.mission.id}`),
      'protocol detail'
    );
    assert.deepEqual(protocolDetail.createdByToken, {
      tokenId: automationTokenId,
      label: TOKEN_LABEL
    });
    assert.equal(protocolDetail.objectives.length, 2);
    assert.equal(protocolDetail.assignedWorkspaceUserId, null);

    const cliCwd = path.join(tempDir, 'cli-cwd');
    mkdirSync(cliCwd, { recursive: true });
    const cliEnv: NodeJS.ProcessEnv = {
      OVERLORD_USER_TOKEN: automationSecret,
      OVLD_USER_TOKEN: undefined,
      USER_TOKEN: undefined,
      OVERLORD_BACKEND_URL: baseUrl,
      OVERLORD_BACKEND_URL_DEV: baseUrl
    };
    const cli = await runOvld({
      args: [
        'protocol',
        'create',
        '--project-id',
        P.projectId,
        '--title',
        'CLI feedback',
        '--objectives-json',
        JSON.stringify([
          { objective: 'Triage CLI feedback' },
          { objective: 'Reply to CLI feedback' }
        ])
      ],
      cwd: cliCwd,
      env: cliEnv
    });
    assert.equal(cli.exitCode, 0, cli.stderr);
    const cliCreated = JSON.parse(cli.stdout) as Json;
    const cliDetail = await expectOk(
      auto('GET', `/api/missions/${cliCreated.mission.id}`),
      'CLI detail'
    );
    assert.deepEqual(cliDetail.createdByToken, { tokenId: automationTokenId, label: TOKEN_LABEL });
    assert.equal(cliDetail.objectives.length, 2);
    const cliDenied = await runOvld({ args: ['user-token', 'list'], cwd: cliCwd, env: cliEnv });
    assert.notEqual(cliDenied.exitCode, 0, 'token management is denied to the automation');
    const cliPrompt = await runOvld({
      args: [
        'protocol',
        'prompt',
        '--project-id',
        P.projectId,
        '--objective',
        'Denied',
        '--agent',
        'claude-code'
      ],
      cwd: cliCwd,
      env: cliEnv
    });
    assert.notEqual(cliPrompt.exitCode, 0, 'prompt is denied to the automation');

    const initialize = await request(automationSecret, 'POST', '/mcp', {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {}
    });
    assert.equal(initialize.status, 200, initialize.text);
    const created = await mcpCall(automationSecret, 'overlord_create_mission', {
      projectId: P.projectId,
      objective: 'Triage MCP feedback',
      title: 'MCP feedback'
    });
    assert.ok(!created.result?.isError, JSON.stringify(created));
    const mcpMission = JSON.parse(created.result.content[0].text) as Json;
    const mcpDetail = await expectOk(
      auto('GET', `/api/missions/${mcpMission.mission.id}`),
      'MCP detail'
    );
    assert.deepEqual(mcpDetail.createdByToken, { tokenId: automationTokenId, label: TOKEN_LABEL });
    assert.equal(mcpDetail.objectives.length, 1);

    const denied = await mcpCall(automationSecret, 'overlord_create_mission', {
      projectId: Q.projectId,
      objective: 'Should fail'
    });
    assert.equal(denied.result?.isError, true, JSON.stringify(denied));
    for (const [name, args] of [
      ['overlord_create_inbox_item', { title: 'Inbox', objective: 'Denied' }],
      [
        'overlord_add_objectives',
        { missionId: P.missionDisplayId, objectives: [{ objective: 'Denied' }] }
      ],
      ['overlord_record_work', { projectId: P.projectId, objective: 'Denied', summary: 'Denied' }],
      ['overlord_attach_session', { missionId: P.missionDisplayId }],
      ['overlord_create_project', { name: 'Denied' }],
      ['overlord_launch_objective', { objectiveId: P.objectiveDisplayId }]
    ] as const) {
      const response = await mcpCall(automationSecret, name, args as Json);
      assert.equal(response.result?.isError, true, `${name}: ${JSON.stringify(response)}`);
    }
  });
});

describe('denied surfaces', () => {
  it('returns 404 from the allowlist guard and leaves no partial writes', async () => {
    const before = snapshotRowCounts();
    const restCases: Array<[string, string, unknown?]> = [
      [
        'POST',
        `/api/protocol/prompt`,
        { flags: { '--project-id': P.projectId, '--objective': 'Denied' } }
      ],
      [
        'POST',
        `/api/protocol/record-work`,
        { flags: { '--project-id': P.projectId, '--objective': 'Denied', '--summary': 'Denied' } }
      ],
      [
        'POST',
        `/api/protocol/add-objectives`,
        {
          flags: {
            '--mission-id': P.missionDisplayId,
            '--objectives-json': '[{"objective":"Denied"}]'
          }
        }
      ],
      ['POST', `/api/protocol/attach`, { flags: { '--mission-id': P.missionDisplayId } }],
      ['POST', `/api/protocol/connect`, { flags: { '--mission-id': P.missionDisplayId } }],
      [
        'POST',
        `/api/protocol/update`,
        {
          flags: {
            '--mission-id': P.missionDisplayId,
            '--session-key': P.sessionKey,
            '--summary': 'Denied'
          }
        }
      ],
      [
        'POST',
        `/api/protocol/deliver`,
        {
          flags: {
            '--mission-id': P.missionDisplayId,
            '--session-key': P.sessionKey,
            '--summary': 'Denied'
          }
        }
      ],
      [
        'POST',
        `/api/protocol/add-artifact`,
        { flags: { '--mission-id': P.missionDisplayId, '--type': 'note', '--label': 'Denied' } }
      ],
      [
        'POST',
        `/api/protocol/write-context`,
        { flags: { '--mission-id': P.missionDisplayId, '--key': 'k', '--value': 'v' } }
      ],
      ['POST', `/api/protocol/read-context`, { flags: { '--mission-id': P.missionDisplayId } }],
      [
        'POST',
        `/api/protocol/discuss-objective`,
        { flags: { '--mission-id': P.missionDisplayId } }
      ],
      [
        'POST',
        `/api/protocol/launch-objective`,
        { flags: { '--objective-id': P.objectiveDisplayId } }
      ],
      [
        'POST',
        `/api/protocol/create-project`,
        { flags: { '--name': 'Denied', '--workspace-id': WS_A } }
      ],
      ['POST', `/api/protocol/delete-missions`, { flags: { '--mission-ids': P.missionDisplayId } }],
      [
        'POST',
        `/api/protocol/create`,
        { flags: { '--unassigned-to-project': true, '--objective': 'Denied' } }
      ],
      ['POST', `/api/protocol/create`, { flags: { '--inbox': true, '--objective': 'Denied' } }],
      [
        'POST',
        `/api/protocol/create`,
        { flags: { '--project-id': Q.projectId, '--objective': 'Denied' } }
      ],
      [
        'POST',
        `/api/protocol/create`,
        { flags: { '--project-id': R.projectId, '--objective': 'Denied' } }
      ],
      ['POST', `/api/protocol/discover-project`, { flags: {} }],
      ['POST', `/api/protocol/list-organizations`, { flags: {} }],
      ['POST', `/api/objectives`, { missionId: P.missionId, objective: 'Denied' }],
      ['POST', `/api/objectives/${P.objectiveId}/launch`, {}],
      ['POST', `/api/objectives/${P.objectiveId}/attachments`, new TextEncoder().encode('denied')],
      ['DELETE', `/api/objectives/${P.objectiveId}/attachments/${P.attachmentId}`],
      ['PATCH', `/api/objectives/${P.objectiveId}`, { objective: 'Denied' }],
      ['PATCH', `/api/missions/${P.missionId}`, { title: 'Denied' }],
      ['DELETE', `/api/missions/${P.missionId}`],
      ['POST', `/api/missions/${P.missionId}/artifacts`, { type: 'note', label: 'Denied' }],
      ['PUT', `/api/missions/${P.missionId}/context`, { entries: [] }],
      ['POST', `/api/missions/${P.missionId}/session-channel`, {}],
      [
        'POST',
        `/api/missions`,
        { projectId: Q.projectId, title: 'Denied', firstObjective: 'Denied' }
      ],
      [
        'POST',
        `/api/missions`,
        { projectId: R.projectId, title: 'Denied', firstObjective: 'Denied' }
      ],
      ['POST', `/api/inbox`, { title: 'Denied', objectives: ['Denied'] }],
      ['GET', `/api/inbox`],
      ['GET', `/api/inbox/missions`],
      ['GET', `/api/workspace/my-missions`],
      ['GET', `/api/activity-feed`],
      ['GET', `/api/missions/search?q=feedback`],
      ['GET', `/api/missions/search/v2?q=feedback`],
      ['POST', `/api/projects`, { name: 'Denied', workspaceId: WS_A }],
      ['PATCH', `/api/projects/${P.projectId}`, { name: 'Denied' }],
      ['DELETE', `/api/projects/${P.projectId}`],
      ['GET', `/api/workspaces/${WS_A}/projects`],
      ['GET', `/api/user-tokens`],
      ['POST', `/api/user-tokens`, { label: 'Denied' }],
      ['PATCH', `/api/user-tokens/${automationTokenId}`, { label: 'Denied' }],
      ['POST', `/api/user-tokens/${automationTokenId}/revoke`],
      ['GET', `/api/webhooks`],
      ['POST', `/api/webhooks`, { url: 'https://example.invalid', events: [] }],
      ['GET', `/api/workspaces`],
      ['POST', `/api/workspaces`, { name: 'Denied' }],
      ['PATCH', `/api/workspaces/${WS_A}`, { name: 'Denied' }],
      ['GET', `/api/workspaces/${WS_A}/members`],
      ['POST', `/api/workspaces/${WS_A}/invitations`, { email: 'denied@example.invalid' }],
      ['POST', `/api/onboarding`, { organizationName: 'Denied' }],
      ['GET', `/api/organizations`],
      ['GET', `/api/meta`],
      ['GET', `/api/profile`],
      ['GET', `/api/notifications`],
      ['GET', `/api/runner/status`],
      ['GET', `/ext/github/projects`],
      ['GET', `/ext/everhour/projects`]
    ];
    for (const [method, route, body] of restCases) {
      const response = await auto(method, route, body);
      assert.equal(
        response.status,
        404,
        `${method} ${route}: ${response.status} ${response.text.slice(0, 200)}`
      );
      assert.ok(
        !response.text.includes('Permission denied'),
        `${method} ${route} should fail closed as 404`
      );
      assertNoLeak(response.text, `${method} ${route}`);
    }
    const after = snapshotRowCounts();
    assert.deepEqual(after, before, 'denied calls must not write rows');
  });

  it('keeps the loopback fallback and the full token unaffected', async () => {
    const mine = await expectOk(full('GET', '/api/user-tokens'), 'full token lists tokens');
    assert.ok(mine.some((token: Json) => token.id === automationTokenId));
    const qDetail = await expectOk(
      full('GET', `/api/missions/${Q.missionId}`),
      'full token reads Q'
    );
    assert.equal(qDetail.id, Q.missionId);
    const rDetail = await expectOk(
      full('GET', `/api/missions/${R.missionId}`),
      'full token reads R'
    );
    assert.equal(rDetail.id, R.missionId);
    const myMissions = await expectOk(full('GET', '/api/workspace/my-missions'), 'my missions');
    assert.ok(JSON.stringify(myMissions).length > 2);
  });
});

describe('attribution', () => {
  it('snapshots the label per mission; rename affects later missions only, revoke and delete keep it readable', async () => {
    const first = await expectOk(
      auto('POST', '/api/missions', {
        projectId: P.projectId,
        title: 'Before rename',
        firstObjective: 'Before'
      }),
      'create before rename'
    );
    assert.deepEqual(first.createdByToken, { tokenId: automationTokenId, label: TOKEN_LABEL });

    await expectOk(
      full('PATCH', `/api/user-tokens/${automationTokenId}`, { label: RENAMED_LABEL }),
      'rename'
    );
    const second = await expectOk(
      auto('POST', '/api/missions', {
        projectId: P.projectId,
        title: 'After rename',
        firstObjective: 'After'
      }),
      'create after rename'
    );
    assert.deepEqual(second.createdByToken, { tokenId: automationTokenId, label: RENAMED_LABEL });
    const firstAgain = await expectOk(
      full('GET', `/api/missions/${first.id}`),
      'first after rename'
    );
    assert.deepEqual(firstAgain.createdByToken, { tokenId: automationTokenId, label: TOKEN_LABEL });

    // Missions created by other token presets or the full token also carry
    // attribution, but the fixture missions created above were stamped with the
    // operator token, never with the automation token.
    const fixtureMission = await expectOk(
      full('GET', `/api/missions/${P.missionId}`),
      'fixture mission'
    );
    assert.deepEqual(fixtureMission.createdByToken, {
      tokenId: fullTokenId,
      label: 'Operator CLI'
    });

    await expectOk(full('POST', `/api/user-tokens/${automationTokenId}/revoke`), 'revoke');
    const revoked = await auto('GET', `/api/projects/${P.projectId}`);
    assert.equal(revoked.status, 401, 'revoked automation token no longer authenticates');
    const afterRevoke = await expectOk(
      full('GET', `/api/projects/${P.projectId}/missions?includeAllCompleted=1`),
      'missions after revoke'
    );
    const byId = new Map<string, Json>(afterRevoke.map((mission: Json) => [mission.id, mission]));
    assert.deepEqual(byId.get(first.id)?.createdByToken, {
      tokenId: automationTokenId,
      label: TOKEN_LABEL
    });
    assert.deepEqual(byId.get(second.id)?.createdByToken, {
      tokenId: automationTokenId,
      label: RENAMED_LABEL
    });

    await expectOk(full('DELETE', `/api/user-tokens/${automationTokenId}`), 'soft delete');
    const tokens = await expectOk(full('GET', '/api/user-tokens'), 'tokens after delete');
    assert.ok(!tokens.some((token: Json) => token.id === automationTokenId));
    const afterDelete = await expectOk(
      full('GET', `/api/missions/${second.id}`),
      'mission after delete'
    );
    assert.deepEqual(afterDelete.createdByToken, {
      tokenId: automationTokenId,
      label: RENAMED_LABEL
    });
    const detail = await expectOk(full('GET', `/api/search/v3?q=rename`), 'search after delete');
    assert.ok(JSON.stringify(detail).includes(second.id));
  });
});
