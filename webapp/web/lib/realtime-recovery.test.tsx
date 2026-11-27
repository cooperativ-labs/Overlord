import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiRequestError } from './api/request.ts';
import { RealtimeProvider, useRealtime } from './realtime.tsx';

test('resumed stream applies pages once and waits for completion even when replay is empty', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient();
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  const requests: string[] = [];
  const seenPages: number[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    assert.ok(url.includes('/realtime'), `Unexpected request ${url}`);
    return new Response(
      new ReadableStream<Uint8Array>({
        start: controller => streams.push(controller)
      })
    );
  }) as typeof fetch;
  const send = (streamIndex: number, event: string, payload: unknown, end = '\n\n') =>
    streams[streamIndex]!.enqueue(
      new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(payload)}${end}`)
    );
  function View() {
    const { state, lastSeq, lastChanges } = useRealtime();
    const pageSeq = lastChanges.at(-1)?.seq;
    if (pageSeq !== undefined && seenPages.at(-1) !== pageSeq) seenPages.push(pageSeq);
    return (
      <div>
        {state}:{lastSeq}
      </div>
    );
  }
  try {
    const result = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <View />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    const expectState = (expected: string) =>
      waitFor(() => assert.equal(result.container.textContent, expected));
    await act(async () => send(0, 'hello', { cursor: 0 }));
    await expectState('live:0');
    await act(async () => streams[0]!.close());
    await waitFor(() => assert.equal(streams.length, 2), { timeout: 6_000 });
    assert.match(requests.at(-1)!, /\/realtime\?after=0&replayComplete=1$/);
    await act(async () => send(1, 'change', { cursor: 500, changes: [{ seq: 500 }] }));
    await expectState('reconnecting:500');
    await act(async () => {
      send(1, 'change', { cursor: 501, changes: [{ seq: 501 }] }, '\n');
      streams[1]!.close();
    });
    await waitFor(() => assert.equal(streams.length, 3), { timeout: 6_000 });
    assert.match(requests.at(-1)!, /\/realtime\?after=500&replayComplete=1$/);
    await act(async () => send(2, 'change', { cursor: 501, changes: [{ seq: 501 }] }));
    await expectState('reconnecting:501');
    await act(async () => send(2, 'hello', { cursor: 503, replayComplete: true }));
    await expectState('live:503');
    await act(async () => streams[2]!.close());
    await waitFor(() => assert.equal(streams.length, 4), { timeout: 6_000 });
    assert.match(requests.at(-1)!, /\/realtime\?after=503&replayComplete=1$/);
    await act(async () => send(3, 'hello', { cursor: 505, replayComplete: true }));
    await expectState('live:505');
    assert.deepEqual(seenPages, [500, 501]);
    assert.equal(requests.length, 4, 'normal reconnect never requests the HTTP feed');
  } finally {
    cleanup();
    streams.at(-1)?.error(new Error('test finished'));
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

test('expired stream refreshes stale data and replays writes made during refresh', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  let finishRefresh!: (value: string[]) => void;
  const refresh = new Promise<string[]>(resolve => {
    finishRefresh = resolve;
  });
  let refreshCount = 0;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.includes('/realtime')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
          }
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        }
      );
    }
    if (url.includes('/sync/changes?after=10')) {
      return Response.json({
        changes: [
          {
            seq: 11,
            workspaceId: 'w',
            entityType: 'mission',
            entityId: 'm',
            operation: 'update',
            projectId: null,
            missionId: 'm',
            objectiveId: null,
            changedFields: [],
            occurredAt: '2026-01-01T00:00:00Z'
          }
        ],
        cursor: 11,
        hasMore: false
      });
    }
    if (url.includes('/sync/changes?after=11'))
      return Response.json({ changes: [], cursor: 11, hasMore: false });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  function View() {
    const state = useRealtime();
    const query = useQuery({
      queryKey: ['recovery-test'],
      queryFn: () => (++refreshCount === 1 ? refresh : Promise.resolve(['post-write'])),
      initialData: ['offline-deleted'],
      staleTime: Infinity
    });
    return (
      <div>
        {state.state}:{state.lastSeq}:{query.data.join(',')}
      </div>
    );
  }
  try {
    const result = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <View />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    await waitFor(() => assert.equal(streams.length, 1));
    const send = (index: number, event: string, body: unknown) =>
      streams[index]!.enqueue(
        new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`)
      );
    await act(async () => {
      send(0, 'hello', { type: 'hello', cursor: 1 });
    });
    await act(async () => {
      send(0, 'snapshot_required', { type: 'snapshot_required', cursor: 10 });
      streams[0]!.close();
    });
    await waitFor(() => assert.match(result.container.textContent ?? '', /reconnecting/));
    await act(async () => {
      finishRefresh(['current']);
    });
    await waitFor(() =>
      assert.match(result.container.textContent ?? '', /reconnecting:11:post-write/)
    );
    await waitFor(() => assert.equal(streams.length, 2), { timeout: 6_000 });
    assert.match(requests.at(-1)!, /\/realtime\?after=11&replayComplete=1$/);
    await act(async () => send(1, 'hello', { cursor: 11, replayComplete: true }));
    await waitFor(() => assert.match(result.container.textContent ?? '', /live:11:post-write/));
    assert.ok(requests.some(url => url.includes('/sync/changes?after=10')));
    assert.doesNotMatch(result.container.textContent ?? '', /offline-deleted/);
  } finally {
    cleanup();
    for (const stream of streams.slice(1)) stream.close();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

test('legacy stream falls back to HTTP and refreshes before replaying an expired cursor', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const streams: Array<ReadableStreamDefaultController<Uint8Array>> = [];
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/realtime')) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.push(controller);
          }
        }),
        { status: 200 }
      );
    }
    if (url.endsWith('/sync/changes?after=1')) {
      return Response.json(
        { error: 'expired', code: 'snapshot_required', cursor: 10 },
        { status: 409 }
      );
    }
    if (url.endsWith('/sync/changes?after=10'))
      return Response.json({ changes: [], cursor: 12, hasMore: false });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  function View() {
    const state = useRealtime();
    const query = useQuery({
      queryKey: ['recovery-rest'],
      queryFn: async () => ['current'],
      initialData: ['offline-deleted'],
      staleTime: Infinity
    });
    return (
      <div>
        {state.state}:{state.lastSeq}:{query.data.join(',')}
      </div>
    );
  }
  try {
    const result = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <View />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    await waitFor(() => assert.equal(streams.length, 1));
    await act(async () => {
      streams[0]!.enqueue(
        new TextEncoder().encode('event: hello\ndata: {"type":"hello","cursor":1}\n\n')
      );
      streams[0]!.close();
    });
    await waitFor(() => assert.equal(streams.length, 2), { timeout: 6000 });
    await act(async () => {
      streams[1]!.enqueue(
        new TextEncoder().encode('event: hello\ndata: {"type":"hello","cursor":10}\n\n')
      );
    });
    await waitFor(() => assert.match(result.container.textContent ?? '', /live:12:current/));
    assert.ok(calls.some(url => url.endsWith('/sync/changes?after=1')));
    assert.ok(calls.some(url => url.endsWith('/sync/changes?after=10')));
  } finally {
    cleanup();
    for (const controller of streams.slice(1)) controller.close();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

test('failed refresh remains reconnecting until a retry succeeds', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let attempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/realtime'))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          }
        }),
        { status: 200 }
      );
    if (url.includes('/sync/changes?after=10'))
      return Response.json({ changes: [], cursor: 11, hasMore: false });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  function View() {
    const state = useRealtime();
    const query = useQuery({
      queryKey: ['retry-recovery'],
      queryFn: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return ['current'];
      },
      initialData: ['old'],
      staleTime: Infinity
    });
    return (
      <div>
        {state.state}:{state.lastSeq}:{query.data?.join(',')}
      </div>
    );
  }
  try {
    const result = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <View />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    await waitFor(() => assert.ok(stream));
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          'event: hello\ndata: {"cursor":1}\n\nevent: snapshot_required\ndata: {"cursor":10}\n\n'
        )
      );
    });
    await waitFor(() => assert.equal(attempts, 1));
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          'event: change\ndata: {"type":"change","cursor":11,"changes":[]}\n\n'
        )
      );
    });
    assert.match(result.container.textContent ?? '', /reconnecting/);
    await waitFor(() => assert.match(result.container.textContent ?? '', /live:11:current/), {
      timeout: 6000
    });
  } finally {
    cleanup();
    stream?.close();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});

test('an active record deleted while offline loses stale data and recovery completes', async () => {
  const originalFetch = globalThis.fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  let refreshAttempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/realtime'))
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          }
        }),
        { status: 200 }
      );
    if (url.includes('/sync/changes?after=10'))
      return Response.json({ changes: [], cursor: 11, hasMore: false });
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  function View() {
    const state = useRealtime();
    const query = useQuery({
      queryKey: ['mission', 'deleted'],
      queryFn: async (): Promise<string[]> => {
        refreshAttempts += 1;
        throw new ApiRequestError('Not found', 404);
      },
      initialData: ['deleted-record'],
      staleTime: Infinity
    });
    const disabled = useQuery({
      queryKey: ['mission', 'disabled'],
      queryFn: async () => ['new'],
      enabled: false,
      initialData: ['old-disabled']
    });
    return (
      <div>
        {state.state}:{state.lastSeq}:{query.data?.join(',') ?? 'removed'}:
        {disabled.data?.join(',') ?? 'removed'}
      </div>
    );
  }
  try {
    const result = render(
      <QueryClientProvider client={client}>
        <RealtimeProvider>
          <View />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    await waitFor(() => assert.ok(stream));
    assert.equal(
      client
        .getQueryCache()
        .find({ queryKey: ['mission', 'deleted'] })
        ?.isActive(),
      true
    );
    await act(async () => {
      stream.enqueue(
        new TextEncoder().encode(
          'event: hello\ndata: {"cursor":1}\n\nevent: snapshot_required\ndata: {"cursor":10}\n\n'
        )
      );
    });
    await waitFor(() => assert.ok(refreshAttempts > 0));
    await waitFor(() =>
      assert.equal(client.getQueryState(['mission', 'deleted'])?.status, 'error')
    );
    assert.equal(client.getQueryData(['mission', 'deleted']), null);
    await waitFor(() =>
      assert.match(result.container.textContent ?? '', /live:11:removed:removed/)
    );
    assert.equal(client.getQueryData(['mission', 'deleted']), null);
    assert.equal(client.getQueryData(['mission', 'disabled']), null);
  } finally {
    cleanup();
    stream?.close();
    client.clear();
    globalThis.fetch = originalFetch;
  }
});
