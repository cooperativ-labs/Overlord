import type { ChatEventPageDto, ChatThreadSnapshotDto } from '@overlord/contract';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { event, message, snapshot } from './chat-fixtures.ts';
import { type ChatStreamDeps, ChatThreadStream, SseFrameParser } from './thread-stream.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 500; i += 1) {
    if (check()) return;
    await tick();
  }
  assert.fail(`timed out waiting for ${label}`);
}

/** A controllable SSE response body. */
function sseStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: c => void (controller = c) });
  return {
    response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    raw: (text: string) => controller.enqueue(encoder.encode(text)),
    frame: (frame: unknown) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)),
    close: () => controller.close()
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function harness(options: {
  snapshots: Array<() => ChatThreadSnapshotDto>;
  streams: Array<(after: number, signal: AbortSignal) => Response | Promise<Response>>;
  polls?: Array<(after: number) => ChatEventPageDto>;
}) {
  const calls = {
    snapshot: 0,
    streamAfter: [] as number[],
    pollAfter: [] as number[],
    sleeps: [] as number[]
  };
  const deps: ChatStreamDeps = {
    loadSnapshot: async () => {
      const next = options.snapshots[Math.min(calls.snapshot, options.snapshots.length - 1)]!;
      calls.snapshot += 1;
      return next();
    },
    openStream: async (_id, after, signal) => {
      calls.streamAfter.push(after);
      const next = options.streams.shift();
      if (!next)
        return new Promise<Response>((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        );
      return next(after, signal);
    },
    poll: async (_id, after) => {
      calls.pollAfter.push(after);
      const next = options.polls?.shift();
      return next ? next(after) : { events: [], cursor: after, hasMore: false };
    },
    sleep: async ms => {
      calls.sleeps.push(ms);
      await tick();
    },
    random: () => 1
  };
  const stream = new ChatThreadStream('thread-1', deps, { pollWindowMs: 60_000 });
  return { stream, calls };
}

describe('SSE frame parser', () => {
  it('reassembles fragmented frames and accepts CRLF', () => {
    const parser = new SseFrameParser();
    assert.deepEqual(parser.push('da'), []);
    assert.deepEqual(parser.push('ta: {"a"'), []);
    assert.deepEqual(parser.push(':1}\n'), []);
    assert.deepEqual(parser.push('\n: comment\r\ndata: 2\r\n\r\n'), ['{"a":1}', '2']);
  });
});

describe('chat thread stream', () => {
  it('subscribes from the snapshot cursor, applies in order, and drops duplicates', async () => {
    const live = sseStream();
    const { stream, calls } = harness({
      snapshots: [() => snapshot({ eventCursor: 5, messages: [message()] })],
      streams: [() => live.response]
    });
    stream.start();
    await until(() => stream.getView().status === 'live', 'live');
    assert.deepEqual(calls.streamAfter, [5]);
    const delta = event(6, {
      kind: 'message.delta',
      messageId: 'm-assistant',
      blockId: 'b1',
      text: 'Hello'
    });
    live.frame({ type: 'event', event: delta });
    live.frame({ type: 'event', event: delta });
    live.frame({ type: 'heartbeat', at: '' });
    live.frame({
      type: 'event',
      event: event(7, { kind: 'message.delta', messageId: 'm-assistant', blockId: 'b1', text: '!' })
    });
    await until(() => stream.getView().state?.cursor === 7, 'cursor 7');
    const block = stream.getView().state!.messages[0]!.blocks[0]!;
    assert.equal(block.kind === 'text' && block.text, 'Hello!');
    stream.stop();
  });

  it('reloads the snapshot on a sequence gap and resubscribes from the new cursor', async () => {
    const first = sseStream();
    const second = sseStream();
    const { stream, calls } = harness({
      snapshots: [() => snapshot({ eventCursor: 1 }), () => snapshot({ eventCursor: 9 })],
      streams: [() => first.response, () => second.response]
    });
    stream.start();
    await until(() => stream.getView().status === 'live', 'live');
    first.frame({
      type: 'event',
      event: event(3, { kind: 'thread.updated', thread: snapshot().thread })
    });
    await until(() => calls.streamAfter.length === 2, 'resubscribe');
    assert.equal(calls.snapshot, 2);
    assert.deepEqual(calls.streamAfter, [1, 9]);
    stream.stop();
  });

  it('recovers from snapshot_required frames and 409 responses', async () => {
    const first = sseStream();
    const { stream, calls } = harness({
      snapshots: [
        () => snapshot({ eventCursor: 2 }),
        () => snapshot({ eventCursor: 40 }),
        () => snapshot({ eventCursor: 50 })
      ],
      streams: [
        () => first.response,
        () => jsonResponse(409, { error: 'expired', code: 'snapshot_required' }),
        () => sseStream().response
      ]
    });
    stream.start();
    await until(() => stream.getView().status === 'live', 'live');
    first.frame({ type: 'snapshot_required', retainedFromSeq: 30 });
    await until(() => calls.streamAfter.length === 3, 'third subscription');
    assert.equal(calls.snapshot, 3);
    assert.deepEqual(calls.streamAfter, [2, 40, 50]);
    stream.stop();
  });

  it('reconnects from the cursor when the stream closes, without implying completion', async () => {
    const first = sseStream();
    const { stream, calls } = harness({
      snapshots: [() => snapshot({ eventCursor: 0 })],
      streams: [() => first.response, () => sseStream().response]
    });
    stream.start();
    await until(() => stream.getView().status === 'live', 'live');
    first.frame({
      type: 'event',
      event: event(1, { kind: 'run.updated', run: { ...snapshotRun() } })
    });
    first.close();
    await until(() => calls.streamAfter.length === 2, 'reconnect');
    assert.deepEqual(calls.streamAfter, [0, 1]);
    assert.equal(calls.snapshot, 1, 'a reconnect resumes from the cursor without a snapshot');
    assert.equal(stream.getView().state?.activeRun?.state, 'running');
    stream.stop();
  });

  it('falls back to polling after repeated failures and keeps applying events', async () => {
    const unavailable = () => jsonResponse(503, { error: 'down' });
    const { stream, calls } = harness({
      snapshots: [() => snapshot({ eventCursor: 4 })],
      streams: [unavailable, unavailable, unavailable],
      polls: [
        after => ({
          events: [
            event(after + 1, {
              kind: 'thread.updated',
              thread: { ...snapshot().thread, title: 'Polled', revision: 2 }
            })
          ],
          cursor: after + 1,
          hasMore: false
        })
      ]
    });
    stream.start();
    await until(() => calls.pollAfter.length >= 1, 'poll');
    assert.equal(calls.pollAfter[0], 4);
    await until(() => stream.getView().state?.thread.title === 'Polled', 'polled event');
    assert.equal(stream.getView().status, 'polling');
    assert.ok(
      calls.sleeps.slice(0, 2).every((ms, i) => ms === 1000 * 2 ** i),
      'exponential backoff'
    );
    stream.stop();
  });

  it('stops on authentication failure and on chat_unavailable', async () => {
    const auth = harness({
      snapshots: [() => snapshot()],
      streams: [() => jsonResponse(401, { error: 'no' })]
    });
    auth.stream.start();
    await until(() => auth.stream.getView().status === 'unauthorized', 'unauthorized');
    await tick();
    assert.equal(auth.calls.streamAfter.length, 1);

    const local = harness({
      snapshots: [() => snapshot()],
      streams: [() => jsonResponse(404, { error: 'x', code: 'chat_unavailable' })]
    });
    local.stream.start();
    await until(() => local.stream.getView().status === 'unavailable', 'unavailable');
  });

  it('replaces revoked content from a fresh authorized snapshot', async () => {
    const first = sseStream();
    const original = message({
      state: 'complete',
      blocks: [
        {
          id: 'b1',
          kind: 'text',
          text: 'From the note',
          fallbackText: 'From the note',
          evidenceIds: []
        }
      ]
    });
    const withheld = message({
      state: 'complete',
      revision: 2,
      blocks: [
        {
          id: 'u',
          kind: 'unavailable',
          reason: 'source_access_lost',
          regenerable: true,
          fallbackText: 'Withheld'
        }
      ]
    });
    const { stream, calls } = harness({
      snapshots: [
        () => snapshot({ eventCursor: 1, messages: [original] }),
        () => snapshot({ eventCursor: 2, messages: [withheld] })
      ],
      streams: [() => first.response, () => sseStream().response]
    });
    stream.start();
    await until(() => stream.getView().status === 'live', 'live');
    first.frame({
      type: 'event',
      event: event(2, { kind: 'content.invalidated', messageIds: ['m-assistant'], proposalIds: [] })
    });
    await until(() => calls.snapshot === 2, 'authorized snapshot');
    const blocks = stream.getView().state!.messages[0]!.blocks;
    assert.deepEqual(
      blocks.map(block => block.kind),
      ['unavailable']
    );
    assert.equal(blocks[0]!.kind === 'unavailable' && blocks[0]!.regenerable, true);
    stream.stop();
  });
});

function snapshotRun() {
  return {
    id: 'run-1',
    threadId: 'thread-1',
    triggerMessageId: 'm',
    state: 'running' as const,
    outcome: null,
    failureCode: null,
    continueAvailable: false,
    continuedFromRunId: null,
    usage: { toolCalls: 0, activeProcessingMs: 0, gatheredContentBytes: 0 },
    cancelRequestedAt: null,
    createdAt: '',
    updatedAt: '',
    completedAt: null,
    revision: 1
  };
}
