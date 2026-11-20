import type { DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { listenForTest, routerTestApp, type TestServer } from './http/test-app-fixture.ts';

process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret-32-chars-min';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4319';
const ambientDirectory = mkdtempSync(path.join(tmpdir(), 'ovld-request-paging-'));
process.env.OVERLORD_SQLITE_PATH = path.join(ambientDirectory, 'ambient.sqlite');
after(() => rmSync(ambientDirectory, { recursive: true, force: true }));

const { bindWebappDatabaseClient, conformanceAdapters, createConformanceDatabase } =
  await import('./test-helpers.ts');
const dbModule = await import('./db.ts');

const { createAgentRequestHumanRouter, decodeAgentRequestCursor, parseAgentRequestPageQuery } =
  await import('./agent-session-routes.ts');
const { createSessionChannel } = await import('../packages/core/service/agent-session/channels.ts');
const { createRequest } = await import('../packages/core/service/agent-session/requests.ts');
const { insertObjective } = await import('../packages/core/service/missions.ts');
const { createProject } = await import('../packages/core/service/projects.ts');
const { protocolCreate } = await import('../packages/core/service/protocol.ts');
const { seedServiceOperator } = await import('../packages/core/service/test-helpers.ts');
const { createServiceContext } = await import('../packages/core/service/context.ts');

/**
 * The opt-in paged read of `GET /api/agent-requests` (contract paged-read extension): status is filtered before
 * the limit, pages are oldest first on (createdAt, id), cursors are bound to their scope, and
 * the legacy unpaged read keeps its newest-first 200-row shape without a `page` member.
 */

type PageBody = {
  requests: Array<{ id: string; status: string; kind: string; objectiveId: string | null }>;
  page?: { complete: boolean; nextCursor: string | null; limit: number; status: string | null };
};

for (const adapter of conformanceAdapters()) {
  describe(`agent-request pagination [${adapter}]`, () => {
    let client: DatabaseClient;
    let cleanup: () => Promise<void>;
    let baseUrl = '';
    let server: TestServer;
    let missionId = '';
    let missionDisplayId = '';
    let objectiveId = '';
    let siblingObjectiveId = '';
    let templateRequestId = '';
    let channelId = '';
    let siblingChannelId = '';
    let insertSeq = 0;

    const BASE_TIME = Date.parse('2026-01-01T00:00:00.000Z');
    const at = (offsetSeconds: number) => new Date(BASE_TIME + offsetSeconds * 1000).toISOString();

    /** Clone the template request with a chosen id, objective, kind, status and timestamp. */
    async function insertRequest(input: {
      id?: string;
      objective?: 'primary' | 'sibling';
      kind?: 'question' | 'choice' | 'permission';
      status?: 'open' | 'resolved' | 'expired' | 'cancelled';
      createdAt: string;
    }): Promise<string> {
      insertSeq += 1;
      const id = input.id ?? `req-${String(insertSeq).padStart(5, '0')}`;
      const sibling = input.objective === 'sibling';
      await client.run(
        `INSERT INTO agent_requests (
       id, workspace_id, project_id, mission_id, objective_id, channel_id, session_id,
       kind, summary, details_json, options_json, allows_free_text, status,
       application_state, created_at, updated_at, revision
     ) SELECT ?, workspace_id, project_id, mission_id, ?, ?, session_id,
              ?, ?, details_json, options_json, allows_free_text, ?,
              application_state, ?, ?, 1
         FROM agent_requests WHERE id = ?`,
        [
          id,
          sibling ? siblingObjectiveId : objectiveId,
          sibling ? siblingChannelId : channelId,
          input.kind ?? 'question',
          `Request ${id}`,
          input.status ?? 'open',
          input.createdAt,
          input.createdAt,
          templateRequestId
        ]
      );
      return id;
    }

    async function get(query: string): Promise<{ status: number; body: any }> {
      const response = await fetch(`${baseUrl}/api/agent-requests?${query}`);
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    }

    /** Follow every page and return the concatenated ids plus the page count. */
    async function readAll(query: string): Promise<{ ids: string[]; pages: number }> {
      const ids: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const { status, body } = await get(
          `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        );
        assert.equal(status, 200, JSON.stringify(body));
        const page = body as PageBody;
        assert.ok(page.page, 'a paged read carries page metadata');
        ids.push(...page.requests.map(request => request.id));
        cursor = page.page.nextCursor;
        assert.equal(page.page.complete, cursor === null);
        pages += 1;
        assert.ok(pages < 100, 'paging terminates');
      } while (cursor);
      return { ids, pages };
    }

    before(async () => {
      const database = await createConformanceDatabase(adapter, 'ovld_request_paging');
      client = database.db;
      cleanup = database.cleanup;
      await bindWebappDatabaseClient({ client });
      const app = routerTestApp(
        app => {
          app.use('/api/agent-requests', createAgentRequestHumanRouter());
        },
        { json: false }
      );
      server = await listenForTest(app);
      baseUrl = server.baseUrl;

      await seedServiceOperator({ db: client });
      await dbModule.setActiveWorkspace('local-workspace');
      const ctx = await createServiceContext({ db: client, source: 'protocol' });
      const project = await createProject({ ctx, name: 'Paging', slug: 'paging' });
      const mission = await protocolCreate({
        ctx,
        projectId: project.id,
        objectives: [{ instructions: 'Paging test' }]
      });
      missionId = mission.mission.id;
      missionDisplayId = mission.mission.displayId;
      objectiveId = mission.objectives[0]!.id;
      const sibling = await insertObjective({
        ctx,
        missionId,
        instructionText: 'Sibling paging scope',
        state: 'pending_delivery'
      });
      siblingObjectiveId = sibling.id;
      const primary = await createSessionChannel({
        ctx,
        missionId,
        objectiveId,
        projectId: project.id
      });
      channelId = primary.channel.id;
      const siblingChannel = await createSessionChannel({
        ctx,
        missionId,
        objectiveId: siblingObjectiveId,
        projectId: project.id
      });
      siblingChannelId = siblingChannel.channel.id;
      const template = await createRequest({
        ctx,
        channel: primary.channel,
        kind: 'question',
        summary: 'Template'
      });
      templateRequestId = template.id;
      // The template is the oldest row and is closed so it never appears in an open read.
      await client.run(
        `UPDATE agent_requests SET status = 'cancelled', created_at = ? WHERE id = ?`,
        [at(-10_000), templateRequestId]
      );
    });

    after(async () => {
      await server.close();
      await cleanup();
    });

    describe('agent-request page parameters', () => {
      it('treats the absence of every paging parameter as the legacy read', () => {
        assert.equal(parseAgentRequestPageQuery({ status: null, limit: null, cursor: null }), null);
        assert.deepEqual(
          parseAgentRequestPageQuery({ status: 'open', limit: null, cursor: null }),
          {
            status: 'open',
            limit: 100,
            cursor: null
          }
        );
      });

      it('rejects unsupported status, out-of-range limits and malformed cursors', () => {
        for (const limit of ['0', '201', '01', '2.5', 'abc', '']) {
          assert.throws(
            () => parseAgentRequestPageQuery({ status: null, limit, cursor: null }),
            /limit/,
            limit
          );
        }
        assert.throws(() =>
          parseAgentRequestPageQuery({ status: 'resolved', limit: null, cursor: null })
        );
        assert.throws(() => parseAgentRequestPageQuery({ status: null, limit: null, cursor: '' }));
        assert.throws(() =>
          parseAgentRequestPageQuery({ status: null, limit: null, cursor: 'x'.repeat(513) })
        );
        const scope = { missionId: 'm', objectiveId: null, status: 'open' as const };
        assert.throws(() => decodeAgentRequestCursor('not base64!', scope));
        assert.throws(() =>
          decodeAgentRequestCursor(Buffer.from('{"v":2}').toString('base64url'), scope)
        );
      });
    });

    describe('GET /api/agent-requests paged open read', () => {
      let oldOpenId = '';
      let siblingOpenId = '';

      before(async () => {
        // One old open question, then 205 newer closed requests: the legacy read cannot see it.
        oldOpenId = await insertRequest({ id: 'old-open', createdAt: at(0) });
        for (let index = 0; index < 205; index += 1) {
          await insertRequest({
            status: index % 3 === 0 ? 'resolved' : index % 3 === 1 ? 'expired' : 'cancelled',
            kind: index % 2 === 0 ? 'question' : 'permission',
            createdAt: at(100 + index)
          });
        }
        // An open choice on a pending-delivery sibling objective.
        siblingOpenId = await insertRequest({
          id: 'sibling-choice',
          objective: 'sibling',
          kind: 'choice',
          createdAt: at(400)
        });
      });

      it('keeps the legacy newest-first 200-row shape, which displaces the old open request', async () => {
        const { status, body } = await get(`missionId=${encodeURIComponent(missionId)}`);
        assert.equal(status, 200);
        assert.equal('page' in body, false, 'the legacy read has no page member');
        assert.equal(body.requests.length, 200);
        assert.equal(body.requests[0].id, siblingOpenId, 'newest first');
        assert.equal(
          body.requests.some((request: { id: string }) => request.id === oldOpenId),
          false
        );
      });

      it('filters by status before the limit, so the old open request is returned', async () => {
        const { status, body } = await get(
          `missionId=${encodeURIComponent(missionDisplayId)}&status=open`
        );
        assert.equal(status, 200);
        const page = body as PageBody;
        assert.deepEqual(
          page.requests.map(request => request.id),
          [oldOpenId, siblingOpenId],
          'oldest first, both question and choice, including the pending-delivery objective'
        );
        assert.deepEqual(page.page, {
          complete: true,
          nextCursor: null,
          limit: 100,
          status: 'open'
        });
        assert.ok(page.requests.every(request => request.status === 'open'));
      });

      it('narrows to one objective', async () => {
        const { body } = await get(
          `missionId=${encodeURIComponent(missionId)}&objectiveId=${encodeURIComponent(
            siblingObjectiveId
          )}&status=open`
        );
        assert.deepEqual(
          (body as PageBody).requests.map(request => request.id),
          [siblingOpenId]
        );
      });

      it('pages through several pages of open requests with identical timestamps exactly once', async () => {
        const tied = at(500);
        const tiedIds: string[] = [];
        for (let index = 0; index < 7; index += 1) {
          tiedIds.push(await insertRequest({ id: `tied-${index}`, createdAt: tied }));
        }
        const { ids, pages } = await readAll(
          `missionId=${encodeURIComponent(missionId)}&status=open&limit=3`
        );
        assert.equal(pages, 3);
        assert.deepEqual(ids, [oldOpenId, siblingOpenId, ...tiedIds]);
        assert.equal(new Set(ids).size, ids.length, 'no duplicates across pages');
        await client.run(`UPDATE agent_requests SET status = 'resolved' WHERE id LIKE 'tied-%'`);
      });

      it('preserves native timestamp precision across page boundaries', async () => {
        const firstId = await insertRequest({
          id: 'precision-a',
          createdAt:
            adapter === 'postgres' ? '2025-12-01T00:00:00.123456Z' : '2025-12-01T00:00:00.123Z'
        });
        const secondId = await insertRequest({
          id: 'precision-b',
          createdAt:
            adapter === 'postgres' ? '2025-12-01T00:00:00.123457Z' : '2025-12-01T00:00:00.124Z'
        });
        try {
          const query = `missionId=${encodeURIComponent(missionId)}&status=open&limit=1`;
          const first = (await get(query)).body as PageBody;
          assert.deepEqual(
            first.requests.map(request => request.id),
            [firstId]
          );
          const second = (
            await get(`${query}&cursor=${encodeURIComponent(first.page!.nextCursor!)}`)
          ).body as PageBody;
          assert.deepEqual(
            second.requests.map(request => request.id),
            [secondId]
          );
        } finally {
          await client.run(`DELETE FROM agent_requests WHERE id IN ('precision-a', 'precision-b')`);
        }
      });

      it('includes a request that arrives during paging and drops one resolved during paging', async () => {
        const extra = [
          await insertRequest({ id: 'page-a', createdAt: at(600) }),
          await insertRequest({ id: 'page-b', createdAt: at(601) }),
          await insertRequest({ id: 'page-c', createdAt: at(602) })
        ];
        const query = `missionId=${encodeURIComponent(missionId)}&status=open&limit=2`;
        const first = (await get(query)).body as PageBody;
        assert.deepEqual(
          first.requests.map(request => request.id),
          [oldOpenId, siblingOpenId]
        );
        // While the client holds the cursor: one request is resolved and one new one arrives.
        await client.run(`UPDATE agent_requests SET status = 'resolved' WHERE id = ?`, [extra[1]]);
        const arrived = await insertRequest({ id: 'page-new', createdAt: at(700) });
        const ids = [...first.requests.map(request => request.id)];
        let cursor = first.page!.nextCursor;
        while (cursor) {
          const next = (await get(`${query}&cursor=${encodeURIComponent(cursor)}`))
            .body as PageBody;
          ids.push(...next.requests.map(request => request.id));
          cursor = next.page!.nextCursor;
        }
        assert.deepEqual(ids, [oldOpenId, siblingOpenId, extra[0], extra[2], arrived]);
        await client.run(
          `UPDATE agent_requests SET status = 'resolved' WHERE id IN ('page-a', 'page-c', 'page-new')`
        );
      });

      it('pages an unfiltered read oldest first when only limit is supplied', async () => {
        const { body } = await get(`missionId=${encodeURIComponent(missionId)}&limit=2`);
        const page = body as PageBody;
        assert.equal(page.page?.status, null);
        assert.equal(page.page?.complete, false);
        assert.equal(page.requests[0]!.id, templateRequestId, 'oldest row, whatever its status');
      });
    });

    describe('agent-request cursor scope and authorization', () => {
      it('rejects a cursor issued for another objective or status', async () => {
        await insertRequest({ id: 'scope-1', createdAt: at(800) });
        await insertRequest({ id: 'scope-2', createdAt: at(801) });
        const first = (await get(`missionId=${encodeURIComponent(missionId)}&status=open&limit=1`))
          .body as PageBody;
        const cursor = first.page!.nextCursor!;
        assert.ok(cursor);
        const otherObjective = await get(
          `missionId=${encodeURIComponent(missionId)}&objectiveId=${encodeURIComponent(
            objectiveId
          )}&status=open&cursor=${encodeURIComponent(cursor)}`
        );
        assert.equal(otherObjective.status, 400);
        assert.equal(otherObjective.body.code, 'invalid_input');
        const otherStatus = await get(
          `missionId=${encodeURIComponent(missionId)}&cursor=${encodeURIComponent(cursor)}`
        );
        assert.equal(otherStatus.status, 400);
        const garbage = await get(
          `missionId=${encodeURIComponent(missionId)}&status=open&cursor=${encodeURIComponent('@@@')}`
        );
        assert.equal(garbage.status, 400);
      });

      it('requires a mission scope for a paged read', async () => {
        const response = await get('status=open');
        assert.equal(response.status, 400);
        assert.equal(response.body.code, 'invalid_input');
        const legacy = await get('');
        assert.equal(legacy.status, 200);
        assert.equal('page' in legacy.body, false);
      });

      it('rejects a cursor from another mission and answers 404 for a mission the caller cannot see', async () => {
        const ctx = await createServiceContext({ db: client, source: 'protocol' });
        const project = await createProject({ ctx, name: 'Paging other', slug: 'paging-other' });
        const other = await protocolCreate({
          ctx,
          projectId: project.id,
          objectives: [{ instructions: 'Other mission' }]
        });
        const issued = (await get(`missionId=${encodeURIComponent(missionId)}&status=open&limit=1`))
          .body as PageBody;
        const cursor = encodeURIComponent(issued.page!.nextCursor!);
        const crossMission = await get(
          `missionId=${encodeURIComponent(other.mission.id)}&status=open&cursor=${cursor}`
        );
        assert.equal(crossMission.status, 400);
        assert.equal(crossMission.body.code, 'invalid_input');

        // A mission no membership can resolve: authorization fails before the cursor is read.
        const unknown = '00000000-0000-4000-8000-000000000000';
        const hidden = await get(`missionId=${unknown}&status=open&cursor=${cursor}`);
        assert.equal(hidden.status, 404);
        assert.equal(hidden.body.code, 'mission_not_found');

        // Suspend the caller's membership: the same valid read and cursor now answer 404 on every page.
        const membership = await client.get<{ id: string; status: string }>(
          `SELECT id, status FROM workspace_users WHERE workspace_id = 'local-workspace' AND status = 'active'
        ORDER BY created_at ASC LIMIT 1`
        );
        assert.ok(membership);
        await client.run(`UPDATE workspace_users SET status = 'disabled' WHERE id = ?`, [
          membership.id
        ]);
        try {
          const suspended = await get(
            `missionId=${encodeURIComponent(missionId)}&status=open&cursor=${cursor}`
          );
          assert.equal(suspended.status, 404);
          assert.equal(suspended.body.code, 'mission_not_found');
        } finally {
          await client.run(`UPDATE workspace_users SET status = ? WHERE id = ?`, [
            membership.status,
            membership.id
          ]);
        }
      });
    });

    describe('dismissed requests in the paged open read (ADR 0063)', () => {
      it('returns a dismissed open request with the caller dismissal on every page read', async () => {
        const dismissedId = await insertRequest({ id: 'dismissed-open', createdAt: at(900) });
        const response = await fetch(`${baseUrl}/api/agent-requests/${dismissedId}/dismissal`, {
          method: 'POST'
        });
        const text = await response.text();
        assert.equal(response.status, 200, text);
        const result = JSON.parse(text) as {
          changed: boolean;
          request: { dismissed: boolean; dismissedAt: string; status: string };
        };
        assert.equal(result.changed, true);
        assert.equal(result.request.status, 'open');
        assert.ok(!Number.isNaN(Date.parse(result.request.dismissedAt)));

        const { ids } = await readAll(`missionId=${encodeURIComponent(missionId)}&status=open`);
        assert.ok(ids.includes(dismissedId), 'a dismissed open request stays in status=open');
        const { body } = await get(
          `missionId=${encodeURIComponent(missionId)}&status=open&limit=200`
        );
        const row = (
          body as {
            requests: Array<{ id: string; dismissed: boolean; dismissedAt: string | null }>;
          }
        ).requests.find(request => request.id === dismissedId);
        assert.equal(row?.dismissed, true);
        assert.equal(row?.dismissedAt, result.request.dismissedAt);

        const restored = await fetch(`${baseUrl}/api/agent-requests/${dismissedId}/dismissal`, {
          method: 'DELETE'
        });
        assert.equal(restored.status, 200);
        assert.equal(
          ((await restored.json()) as { request: { dismissed: boolean } }).request.dismissed,
          false
        );
      });
    });
  });
}
