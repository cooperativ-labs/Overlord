import type { AgentRequestListResponse, HumanAgentRequestDto } from '@overlord/contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { ReactNode } from 'react';

import { useMissionOpenAgentRequests, useResolveAgentRequest } from './queries/missions.ts';
import {
  fetchCompleteOpenAgentRequests,
  groupOpenRequestsByObjective,
  openAgentRequestState
} from './open-agent-requests.ts';
import { keys } from './query-keys.ts';
import { invalidateRealtimeChanges } from './realtime-invalidation.ts';

function request(id: string, overrides: Partial<HumanAgentRequestDto> = {}): HumanAgentRequestDto {
  return {
    id,
    channelId: 'channel',
    missionId: 'mission-1',
    objectiveId: 'objective-1',
    kind: 'question',
    summary: `Request ${id}`,
    options: [],
    allowsFreeText: true,
    status: 'open',
    resolution: null,
    revision: 1,
    windowExpiresAt: null,
    releasedReason: null,
    applicationState: 'pending',
    resolvedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    delivery: { mode: 'read_only', reason: 'no_latch_session', state: 'pending', observedAt: null },
    ...overrides
  } as HumanAgentRequestDto;
}

function page(
  requests: HumanAgentRequestDto[],
  nextCursor: string | null
): AgentRequestListResponse {
  return {
    requests,
    page: { complete: nextCursor === null, nextCursor, limit: 200, status: 'open' }
  };
}

describe('fetchCompleteOpenAgentRequests', () => {
  it('follows every cursor, deduplicates and orders oldest first', async () => {
    const pages: Record<string, AgentRequestListResponse> = {
      start: page([request('b', { createdAt: '2026-01-02T00:00:00.000Z' }), request('a')], 'c1'),
      c1: page(
        [
          // Seen again on a later page (arrival during paging): the later copy wins.
          request('b', { createdAt: '2026-01-02T00:00:00.000Z', revision: 2 }),
          request('c', { createdAt: '2026-01-03T00:00:00.000Z', kind: 'choice' })
        ],
        null
      )
    };
    const cursors: Array<string | null> = [];
    const result = await fetchCompleteOpenAgentRequests(async cursor => {
      cursors.push(cursor);
      return pages[cursor ?? 'start']!;
    });
    assert.deepEqual(cursors, [null, 'c1']);
    assert.equal(result.complete, true);
    assert.equal(result.pages, 2);
    assert.deepEqual(
      result.requests.map(item => item.id),
      ['a', 'b', 'c']
    );
    assert.equal(result.requests[1]!.revision, 2);
  });

  it('is partial, never complete, when it stops at the page bound or on a cursor loop', async () => {
    const bounded = await fetchCompleteOpenAgentRequests(async () => page([request('x')], 'more'), {
      maxPages: 3
    });
    assert.equal(bounded.complete, false);
    let calls = 0;
    const looping = await fetchCompleteOpenAgentRequests(async () => {
      calls += 1;
      return page([request(`r${calls}`)], 'same');
    });
    assert.equal(looping.complete, false);
    assert.equal(calls, 2);
  });

  it('never claims completeness from a legacy response without page metadata', async () => {
    const legacy = await fetchCompleteOpenAgentRequests(async () => ({
      requests: [request('a'), request('closed', { status: 'resolved' })]
    }));
    assert.equal(legacy.complete, false);
    assert.deepEqual(
      legacy.requests.map(item => item.id),
      ['a']
    );
  });

  it('rejects the whole read when any page fails', async () => {
    await assert.rejects(
      fetchCompleteOpenAgentRequests(async cursor => {
        if (cursor) throw new Error('page 2 failed');
        return page([request('a')], 'c1');
      }),
      /page 2 failed/
    );
  });
});

describe('open-request helpers', () => {
  it('groups by objective and maps state', () => {
    const grouped = groupOpenRequestsByObjective([
      request('a'),
      request('b', { objectiveId: 'objective-2' }),
      request('c'),
      request('d', { objectiveId: null })
    ]);
    assert.deepEqual(
      [...grouped.entries()].map(([id, list]) => [id, list.map(item => item.id)]),
      [
        ['objective-1', ['a', 'c']],
        ['objective-2', ['b']]
      ]
    );
    assert.equal(
      openAgentRequestState({ hasData: false, isError: false, complete: false }),
      'loading'
    );
    assert.equal(
      openAgentRequestState({ hasData: true, isError: false, complete: false }),
      'partial'
    );
    assert.equal(
      openAgentRequestState({ hasData: true, isError: false, complete: true }),
      'complete'
    );
    assert.equal(openAgentRequestState({ hasData: true, isError: true, complete: true }), 'error');
  });

  it('nests the collection under the prefix that realtime and answers invalidate', () => {
    const prefix = keys.missionAgentRequests('mission-1');
    const collection = keys.missionOpenAgentRequests('mission-1');
    assert.deepEqual(collection.slice(0, prefix.length), [...prefix]);
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    client.setQueryData(collection, { requests: [], complete: true, pages: 1 });
    const mode = invalidateRealtimeChanges(client, [
      {
        seq: 1,
        workspaceId: 'workspace-1',
        entityType: 'agent_request',
        entityId: 'request-1',
        operation: 'update',
        projectId: 'project-1',
        missionId: 'mission-1',
        objectiveId: 'objective-1',
        changedFields: ['status'],
        occurredAt: '2026-06-29T00:00:00.000Z'
      }
    ]);
    assert.equal(mode, 'targeted');
    assert.equal(client.getQueryState(collection)?.isInvalidated, true);
    client.clear();
  });
});

describe('useMissionOpenAgentRequests', () => {
  const originalFetch = globalThis.fetch;
  let queryClient: QueryClient | null = null;
  afterEach(() => {
    cleanup();
    queryClient?.clear();
    queryClient = null;
    globalThis.fetch = originalFetch;
  });

  function wrapper(client: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  it('reads every page, keeps the last collection on failure and recovers on retry', async () => {
    let fail = false;
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      urls.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (fail) return json({ error: 'down', code: 'internal' }, 500);
      const cursor = url.searchParams.get('cursor');
      return json(
        cursor
          ? page(
              [
                request('q2', { createdAt: '2026-01-02T00:00:00.000Z', objectiveId: 'objective-2' })
              ],
              null
            )
          : page([request('q1'), request('perm', { kind: 'permission' })], 'next')
      );
    }) as typeof fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    });
    queryClient = client;
    const { result } = renderHook(() => useMissionOpenAgentRequests('mission-1'), {
      wrapper: wrapper(client)
    });
    assert.equal(result.current.state, 'loading');
    assert.equal(result.current.authoritative, false);
    await waitFor(() => assert.equal(result.current.state, 'complete'));
    assert.ok(urls[0]!.includes('status=open'));
    assert.ok(urls[0]!.includes('missionId=mission-1'));
    assert.ok(urls[1]!.includes('cursor=next'));
    assert.deepEqual(
      result.current.requests.map(item => item.id),
      ['perm', 'q1', 'q2'],
      'oldest first, ties by id'
    );
    assert.deepEqual(
      result.current.blocking.map(item => item.id),
      ['q1', 'q2']
    );
    assert.deepEqual(
      result.current.blockingByObjective.get('objective-2')?.map(item => item.id),
      ['q2']
    );
    assert.equal(result.current.authoritative, true);

    fail = true;
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => assert.equal(result.current.state, 'error'));
    assert.equal(result.current.stale, true);
    assert.equal(result.current.authoritative, false, 'a failed read is never authoritative');
    assert.equal(result.current.blocking.length, 2, 'the last successful view is retained');

    fail = false;
    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => assert.equal(result.current.state, 'complete'));
    assert.equal(result.current.stale, false);
  });

  it('refreshes after an answer through the shared prefix', async () => {
    let answered = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        answered = true;
        return json({ resolved: true, request: request('q1', { status: 'resolved' }) });
      }
      if (url.includes('/api/agent-requests')) {
        return json(page(answered ? [] : [request('q1')], null));
      }
      return json({});
    }) as typeof fetch;
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity }
      }
    });
    queryClient = client;
    const { result } = renderHook(
      () => ({
        open: useMissionOpenAgentRequests('mission-1'),
        resolve: useResolveAgentRequest('mission-1')
      }),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => assert.equal(result.current.open.blocking.length, 1));
    await act(async () => {
      await result.current.resolve.mutateAsync({
        requestId: 'q1',
        resolution: { text: 'yes' },
        expectedRevision: 1
      });
    });
    await waitFor(() => assert.equal(result.current.open.blocking.length, 0));
    assert.equal(result.current.open.authoritative, true);
  });

  it('shares previously known blocking requests through partial refreshes until a complete read', async () => {
    let response: AgentRequestListResponse = page([request('old')], null);
    globalThis.fetch = (async () => json(response)) as typeof fetch;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    });
    queryClient = client;
    const { result } = renderHook(
      () => ({
        mission: useMissionOpenAgentRequests('mission-1'),
        detail: useMissionOpenAgentRequests('mission-1')
      }),
      { wrapper: wrapper(client) }
    );
    await waitFor(() => assert.equal(result.current.mission.state, 'complete'));
    response = { requests: [request('new')] };
    await act(async () => {
      await result.current.mission.retry();
    });
    await waitFor(() => assert.equal(result.current.mission.state, 'partial'));
    assert.deepEqual(
      result.current.mission.blocking.map(item => item.id),
      ['new', 'old']
    );
    assert.deepEqual(result.current.detail.blocking, result.current.mission.blocking);
    assert.equal(result.current.mission.authoritative, false);
    response = page([], null);
    await act(async () => {
      await result.current.detail.retry();
    });
    await waitFor(() => assert.equal(result.current.mission.state, 'complete'));
    assert.deepEqual(result.current.mission.blocking, []);
  });
});
