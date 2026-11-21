import assert from 'node:assert/strict';
import test from 'node:test';

import { findAgentSessionCodec } from '../dist/agent-session/codec-registry.generated.js';
import {
  createThreadTracker,
  nativeEventName,
  normalizeProjectedFrame,
  projectNotification,
  trackNotification
} from '../dist/agent-session/codex-app-server/events.js';
import { createFakeChannel } from '../dist/agent-session/codex-app-server/fake-channel.js';
import {
  importSessionHistory,
  importThreadTurns
} from '../dist/agent-session/codex-app-server/history.js';
import { runCodexAppServerSupervisor } from '../dist/agent-session/codex-app-server/supervisor.js';
import { threadIdOf, ThreadTree } from '../dist/agent-session/codex-app-server/threads.js';
import type { MessageTransport } from '../dist/agent-session/codex-app-server/transport.js';

/**
 * Child threads and history import for the Codex app-server adapter (coo:1325.nagv).
 *
 * Thread shapes are the ones a live 0.170.0 server returned in the probe recorded for this
 * objective: a spawned child announced by its parent's `subAgentActivity` item, `thread/read`
 * on the child (inherited `sessionId`, `parentThreadId` and `forkedFromId` both the parent), and
 * a `thread/fork` whose history begins with the source's turn.
 */

const ROOT = '01a1faeb-d29d-77a2-91b0-89021afec101';
const CHILD = '01a1faeb-e92a-7711-8210-2250b334ce2f';
const FORK = '01a1faec-2574-7e33-b31f-1a6f3abb3cd7';
const FOREIGN = '01a1fb00-0000-7000-8000-000000000000';
const ROOT_TURN = '01a1faeb-d30f-7761-a52a-b80145730805';
const CHILD_TURN = '01a1faeb-e98e-7f92-9764-6130255aed13';

const childThread = {
  id: CHILD,
  sessionId: ROOT,
  parentThreadId: ROOT,
  forkedFromId: ROOT,
  source: {
    subAgent: {
      thread_spawn: {
        parent_thread_id: ROOT,
        depth: 1,
        agent_path: '/root/child',
        agent_nickname: 'Carver',
        agent_role: null
      }
    }
  },
  agentNickname: 'Carver',
  agentRole: null
};
const forkThread = {
  id: FORK,
  sessionId: FORK,
  parentThreadId: null,
  forkedFromId: ROOT,
  source: 'vscode'
};
const foreignThread = {
  id: FOREIGN,
  sessionId: FOREIGN,
  parentThreadId: null,
  forkedFromId: null,
  source: 'cli'
};
const spawnedItem = {
  type: 'subAgentActivity',
  id: 'call_2a2dae9d5eb745319b730abb1a5b95d5',
  kind: 'started',
  agentThreadId: CHILD,
  agentPath: '/root/child'
};

const codecFor = () => {
  const codec = findAgentSessionCodec('codex-app-server');
  assert.ok(codec);
  return codec;
};

const tick = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function memoryTransport(): {
  transport: MessageTransport;
  sent: Record<string, unknown>[];
  deliver: (message: unknown) => void;
  close: () => void;
} {
  const sent: Record<string, unknown>[] = [];
  const listeners: ((text: string) => void)[] = [];
  const closeListeners: ((reason: string) => void)[] = [];
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener('closed');
  };
  return {
    sent,
    transport: {
      send: text => sent.push(JSON.parse(text) as Record<string, unknown>),
      onMessage: listener => listeners.push(listener),
      onClose: listener => closeListeners.push(listener),
      close
    },
    deliver: message => {
      for (const listener of listeners) listener(JSON.stringify(message));
    },
    close
  };
}

/** Answer the oldest unanswered request with this method; returns its params. */
async function respond(
  memory: ReturnType<typeof memoryTransport>,
  answered: Set<unknown>,
  method: string,
  result: unknown
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const request = memory.sent.find(
      message => message.method === method && message.id !== undefined && !answered.has(message.id)
    );
    if (request) {
      answered.add(request.id);
      memory.deliver({ id: request.id, result });
      return (request.params ?? {}) as Record<string, unknown>;
    }
    await tick(5);
  }
  throw new Error(`no ${method} request`);
}

const INIT = { userAgent: 'overlord/0.170.0 (x) (overlord; test)' };

type PostedEvent = {
  subagentId: string | null;
  correlationId: string | null;
  nativeEvent: string | null;
  kind: string;
  payload: { paths?: string[]; detail?: string };
};

function postedEvents(channel: ReturnType<typeof createFakeChannel>): {
  nativeSessionId: unknown;
  event: PostedEvent;
}[] {
  return channel.calls
    .filter(call => call.path === '/events')
    .map(call => {
      const body = call.body as { nativeSessionId: unknown; events: PostedEvent[] };
      return { nativeSessionId: body.nativeSessionId, event: body.events[0]! };
    });
}

// ── thread tree ───────────────────────────────────────────────────────────────

test('threads: a parent item admits the child it spawns; nothing else does', () => {
  const tree = new ThreadTree(ROOT);
  assert.deepEqual(tree.admitFromItem(FOREIGN, spawnedItem), [], 'a foreign emitter admits none');
  assert.equal(tree.has(CHILD), false);
  const [child] = tree.admitFromItem(ROOT, spawnedItem);
  assert.deepEqual(child, {
    id: CHILD,
    relation: 'subagent',
    parentId: ROOT,
    depth: 1,
    agentPath: '/root/child',
    nickname: null,
    role: null
  });
  assert.deepEqual(
    tree.admitFromItem(CHILD, {
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      receiverThreadIds: ['grandchild']
    })[0]?.depth,
    2,
    'a spawnAgent call admits its receivers one level deeper'
  );
  assert.deepEqual(
    tree.admitFromItem(ROOT, {
      type: 'collabAgentToolCall',
      tool: 'wait',
      receiverThreadIds: ['w']
    }),
    [],
    'only a spawn admits'
  );
  assert.equal(tree.childCount, 2);
});

test('threads: lineage from thread objects — subagent before fork, fork, inherited session', () => {
  const tree = new ThreadTree(ROOT);
  // LIVE: a child reports forkedFromId (its parent) as well as parentThreadId.
  assert.equal(tree.admitThread(childThread)?.relation, 'subagent');
  assert.equal(tree.get(CHILD)?.nickname, 'Carver');
  assert.equal(tree.get(CHILD)?.agentPath, '/root/child');
  assert.equal(tree.admitThread(forkThread)?.relation, 'fork');
  assert.equal(tree.admitThread(foreignThread), null, 'a new session is not this session');
  const inherited = new ThreadTree(ROOT);
  assert.equal(
    inherited.admitThread({ id: 'late', sessionId: ROOT, parentThreadId: null })?.parentId,
    ROOT,
    'root-session inheritance: the shared session id is enough'
  );
  // Known nodes are enriched, not replaced.
  const enriched = new ThreadTree(ROOT);
  enriched.admitFromItem(ROOT, spawnedItem);
  enriched.admitThread(childThread);
  assert.equal(enriched.get(CHILD)?.nickname, 'Carver');
});

test('threads: an unknown thread is looked up once; an unanswered lookup is retried', async () => {
  const tree = new ThreadTree(ROOT);
  let reads = 0;
  const read = async (id: string) => {
    reads += 1;
    return id === CHILD ? childThread : foreignThread;
  };
  const [a, b] = await Promise.all([tree.resolve(FOREIGN, read), tree.resolve(FOREIGN, read)]);
  assert.equal(a, null);
  assert.equal(b, null);
  assert.equal(await tree.resolve(FOREIGN, read), null);
  assert.equal(reads, 1, 'concurrent and later callers share one lookup');
  assert.equal(tree.isForeign(FOREIGN), true);
  assert.equal((await tree.resolve(CHILD, read))?.relation, 'subagent');

  const flaky = new ThreadTree(ROOT);
  let attempts = 0;
  const failing = async () => {
    attempts += 1;
    throw new Error('transport closed');
  };
  assert.equal(await flaky.resolve(CHILD, failing), null);
  assert.equal(flaky.isForeign(CHILD), false, 'no answer is not a verdict');
  assert.equal((await flaky.resolve(CHILD, async () => childThread))?.id, CHILD);
  assert.equal(attempts, 1);
});

test('threads: frame context and card origin carry ids and bounded labels only', () => {
  const tree = new ThreadTree(ROOT);
  tree.admitThread(childThread);
  tree.admitThread(forkThread);
  assert.deepEqual(tree.frameContext(ROOT), { rootThreadId: ROOT });
  assert.deepEqual(tree.frameContext(CHILD), {
    rootThreadId: ROOT,
    subagentThreadId: CHILD,
    parentThreadId: ROOT,
    lineage: `subagent /root/child of ${ROOT} (depth 1)`
  });
  assert.equal(tree.frameContext(FORK)?.lineage, `fork of ${ROOT}`);
  assert.equal(tree.cardOrigin(ROOT), null);
  assert.deepEqual(tree.cardOrigin(CHILD), {
    threadId: CHILD,
    relation: 'subagent',
    parentThreadId: ROOT,
    depth: 1,
    agentPath: '/root/child',
    nickname: 'Carver'
  });
  assert.equal(threadIdOf({ thread: { id: 'x' } }), 'x');
  assert.equal(threadIdOf({ status: 'disabled' }), null);
});

// ── events ────────────────────────────────────────────────────────────────────

test('events: a child frame is correlated with the root and names the child', () => {
  const tree = new ThreadTree(ROOT);
  tree.admitFromItem(ROOT, spawnedItem);
  const codec = codecFor();
  const [frame] = projectNotification({
    method: 'item/completed',
    params: {
      threadId: CHILD,
      turnId: CHILD_TURN,
      item: {
        type: 'fileChange',
        id: 'exec-f6cb83ed-662d-4e02-9a5f-dfb15ad4e227',
        status: 'completed',
        changes: [{ path: '/repo/child.txt', kind: { type: 'add' }, diff: 'from child\n' }]
      }
    },
    cwd: '/repo',
    thread: tree.frameContext(CHILD)
  });
  const event = normalizeProjectedFrame({ codec, frame: frame! });
  assert.equal(event?.kind, 'file.edited');
  assert.equal(event?.subagentId, CHILD);
  assert.equal(event?.correlationId, ROOT);
  assert.deepEqual(event?.payload.paths, ['child.txt']);
  assert.ok(!JSON.stringify(event).includes('from child'));

  // The parent's announcement is the child's start, in the parent's turn.
  assert.equal(
    nativeEventName('item/completed', { item: spawnedItem }),
    'item/completed:subAgentActivity:started'
  );
  const [announced] = projectNotification({
    method: 'item/completed',
    params: { threadId: ROOT, turnId: ROOT_TURN, item: spawnedItem },
    cwd: '/repo',
    thread: tree.frameContext(ROOT)
  });
  const started = normalizeProjectedFrame({ codec, frame: announced! });
  assert.equal(started?.kind, 'session.started');
  assert.equal(started?.subagentId, CHILD);
  assert.equal(started?.correlationId, ROOT);
  assert.equal(started?.nativeTurnId, ROOT_TURN);
  assert.equal(started?.payload.detail, '/root/child');

  // A root frame is unchanged by the tree: same correlation, no subagent.
  const [rootFrame] = projectNotification({
    method: 'turn/started',
    params: { threadId: ROOT, turn: { id: ROOT_TURN, status: 'inProgress' } },
    cwd: '/repo',
    thread: tree.frameContext(ROOT)
  });
  const rootEvent = normalizeProjectedFrame({ codec, frame: rootFrame! });
  const [bare] = projectNotification({
    method: 'turn/started',
    params: { threadId: ROOT, turn: { id: ROOT_TURN, status: 'inProgress' } },
    cwd: '/repo'
  });
  assert.equal(rootEvent?.subagentId, null);
  assert.equal(rootEvent?.eventId, normalizeProjectedFrame({ codec, frame: bare! })?.eventId);
});

test('events: a child file change is tracked for its approval card; its turns are not', () => {
  const tracker = createThreadTracker(ROOT);
  trackNotification(tracker, 'turn/started', { threadId: CHILD, turn: { id: CHILD_TURN } });
  assert.equal(tracker.activeTurnId, null, 'inbox input goes to the root turn only');
  trackNotification(tracker, 'item/started', {
    threadId: CHILD,
    item: {
      type: 'fileChange',
      id: 'exec-c',
      changes: [{ path: '/repo/child.txt', kind: { type: 'add' } }]
    }
  });
  assert.deepEqual(tracker.fileChanges.get('exec-c'), [{ path: '/repo/child.txt', kind: 'add' }]);
});

// ── history ───────────────────────────────────────────────────────────────────

const turn = (id: string, items: unknown[], status = 'completed') => ({
  id,
  status,
  items,
  startedAt: 1795211121,
  completedAt: 1795211141
});
const fileChange = (id: string, file: string, status = 'completed') => ({
  type: 'fileChange',
  id,
  status,
  changes: [{ path: `/repo/${file}`, kind: { type: 'add' }, diff: 'x\n' }]
});

function fakeRpc(handlers: Record<string, (params: Record<string, unknown>) => unknown>): {
  request: <T>(method: string, params?: unknown) => Promise<T>;
  calls: { method: string; params: Record<string, unknown> }[];
} {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  return {
    calls,
    request: async <T>(method: string, params?: unknown): Promise<T> => {
      const record = (params ?? {}) as Record<string, unknown>;
      calls.push({ method, params: record });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected ${method}`);
      return handler(record) as T;
    }
  };
}

test('history: pages oldest first and replays only terminal items of finished turns', async () => {
  const rpc = fakeRpc({
    'thread/turns/list': params =>
      params.cursor === null
        ? {
            data: [
              turn('t1', [
                { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'go' }] },
                { type: 'agentMessage', id: 'm1', text: 'model text is never imported' },
                fileChange('f1', 'a.txt'),
                fileChange('f2', 'b.txt', 'inProgress')
              ])
            ],
            nextCursor: 'c2'
          }
        : { data: [turn('t2', [fileChange('f3', 'c.txt')], 'inProgress')], nextCursor: null }
  });
  const replayed: { params: Record<string, unknown>; at: Date | null }[] = [];
  const result = await importThreadTurns({
    rpc,
    threadId: ROOT,
    seenTurns: new Set(),
    replay: (_method, params, at) => {
      replayed.push({ params, at });
    },
    pageLimit: 1
  });
  assert.deepEqual(
    rpc.calls.map(call => call.params),
    [
      { threadId: ROOT, cursor: null, limit: 1, sortDirection: 'asc', itemsView: 'full' },
      { threadId: ROOT, cursor: 'c2', limit: 1, sortDirection: 'asc', itemsView: 'full' }
    ]
  );
  assert.deepEqual(
    replayed.map(entry => (entry.params.item as { id: string }).id),
    ['u1', 'f1'],
    'no model text, no unfinished item, nothing from a running turn'
  );
  assert.equal(replayed[0]!.params.turnId, 't1');
  assert.equal(replayed[0]!.at?.toISOString(), new Date(1795211141 * 1000).toISOString());
  assert.deepEqual(result, { turns: 1, items: 2, skippedInheritedTurns: 0, pages: 2 });
});

test('history: the whole tree — children listed, a fork skips the turns it inherited', async () => {
  const tree = new ThreadTree(ROOT);
  tree.admitThread(forkThread); // forked live before the reconnect
  const rpc = fakeRpc({
    'thread/turns/list': params => {
      if (params.threadId === ROOT) {
        return { data: [turn(ROOT_TURN, [fileChange('f-root', 'parent.txt')])], nextCursor: null };
      }
      if (params.threadId === FORK) {
        // LIVE: a fork's history starts with its source's turn, same ids.
        return {
          data: [
            turn(ROOT_TURN, [fileChange('f-root', 'parent.txt')]),
            turn('fork-turn', [fileChange('f-fork', 'fork.txt')])
          ],
          nextCursor: null
        };
      }
      if (params.threadId === CHILD) {
        return { data: [turn(CHILD_TURN, [fileChange('f-child', 'child.txt')])], nextCursor: null };
      }
      throw new Error('ephemeral threads do not support thread/turns/list');
    },
    'thread/list': params =>
      params.parentThreadId === ROOT
        ? { data: [{ ...childThread, sessionId: CHILD }], nextCursor: null }
        : { data: [], nextCursor: null }
  });
  const replayed: string[] = [];
  const result = await importSessionHistory({
    rpc,
    tree,
    replay: (_method, params) => {
      replayed.push(`${params.threadId as string}:${(params.item as { id: string }).id}`);
    }
  });
  assert.deepEqual(replayed, [`${ROOT}:f-root`, `${FORK}:f-fork`, `${CHILD}:f-child`]);
  assert.equal(result.skippedInheritedTurns, 1);
  assert.equal(result.threads, 3);
  assert.equal(tree.get(CHILD)?.relation, 'subagent', 'thread/list parentage admits the child');
  // thread/list reports the child's own id as sessionId (LIVE); parentage still admits it.
  assert.equal(tree.get(CHILD)?.parentId, ROOT);
});

test('history: an unreadable thread is skipped, and a stop ends the import', async () => {
  const tree = new ThreadTree(ROOT);
  tree.admitThread(childThread);
  const rpc = fakeRpc({
    'thread/turns/list': params => {
      if (params.threadId === ROOT) throw new Error('ephemeral threads do not support it');
      return { data: [turn(CHILD_TURN, [fileChange('f-child', 'child.txt')])], nextCursor: null };
    },
    'thread/list': () => ({ data: [], nextCursor: null })
  });
  const result = await importSessionHistory({ rpc, tree, replay: () => undefined });
  assert.equal(result.failedThreads, 1);
  assert.equal(result.items, 1);

  const stopped = await importSessionHistory({
    rpc,
    tree: new ThreadTree(ROOT),
    replay: () => undefined,
    shouldStop: () => true
  });
  assert.equal(stopped.threads, 0);
});

// ── supervisor ────────────────────────────────────────────────────────────────

test('supervisor: child-thread work is attributed to the session; a foreign thread is not', async () => {
  const memory = memoryTransport();
  const answered = new Set<unknown>();
  const channel = createFakeChannel();
  const captured: { event: string; context: Record<string, unknown> }[] = [];
  const controller = new AbortController();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    firstPrompt: 'Spawn a subagent.',
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    stopSignal: controller.signal,
    // As the sidecar's capture does: only completed edits and commands reach the ledger.
    capture: frame => {
      if (frame.event === 'item/completed:fileChange') captured.push(frame as never);
    }
  });
  await respond(memory, answered, 'initialize', INIT);
  await respond(memory, answered, 'thread/start', { thread: { id: ROOT }, cwd: '/repo' });
  await respond(memory, answered, 'turn/start', { turn: { id: ROOT_TURN } });
  memory.deliver({
    method: 'turn/started',
    params: { threadId: ROOT, turn: { id: ROOT_TURN, status: 'inProgress' } }
  });
  memory.deliver({
    method: 'item/completed',
    params: { threadId: ROOT, turnId: ROOT_TURN, item: spawnedItem }
  });
  memory.deliver({
    method: 'turn/started',
    params: { threadId: CHILD, turn: { id: CHILD_TURN, status: 'inProgress' } }
  });
  // The child's patch: pre-mutation item, then its approval — on this connection.
  const childChange = fileChange('exec-child', 'child.txt', 'inProgress');
  memory.deliver({
    method: 'item/started',
    params: { threadId: CHILD, turnId: CHILD_TURN, item: childChange }
  });
  memory.deliver({
    id: 0,
    method: 'item/fileChange/requestApproval',
    params: { threadId: CHILD, turnId: CHILD_TURN, itemId: 'exec-child', reason: null }
  });
  await tick(40);
  const card = channel.calls.find(call => call.path === '/requests');
  assert.ok(card, 'the child approval becomes a card');
  const details = (card.body as { details: Record<string, unknown> }).details;
  assert.deepEqual(details.paths, ['child.txt']);
  assert.deepEqual(details.subagent, {
    threadId: CHILD,
    relation: 'subagent',
    parentThreadId: ROOT,
    depth: 1,
    agentPath: '/root/child'
  });
  memory.deliver({
    method: 'item/completed',
    params: { threadId: CHILD, turnId: CHILD_TURN, item: { ...childChange, status: 'completed' } }
  });

  // A thread a person started from scratch in an attached TUI.
  memory.deliver({
    method: 'item/completed',
    params: { threadId: FOREIGN, turnId: 'ft', item: fileChange('exec-foreign', 'foreign.txt') }
  });
  memory.deliver({
    id: 1,
    method: 'item/commandExecution/requestApproval',
    params: {
      kind: 'command',
      threadId: FOREIGN,
      turnId: 'ft',
      itemId: 'exec-foreign-cmd',
      command: 'ls',
      availableDecisions: ['accept', 'decline']
    }
  });
  const lookup = await respond(memory, answered, 'thread/read', { thread: foreignThread });
  assert.deepEqual(lookup, { threadId: FOREIGN, includeTurns: false });
  await tick(40);
  assert.equal(
    memory.sent.filter(message => message.method === 'thread/read').length,
    1,
    'one lookup decides the thread for its frames and its approval'
  );

  const events = postedEvents(channel);
  assert.ok(events.every(entry => entry.nativeSessionId === ROOT));
  const childEdit = events.find(
    entry => entry.event.kind === 'file.edited' && entry.event.subagentId === CHILD
  );
  assert.ok(childEdit, 'the child edit is posted to the same channel');
  assert.equal(childEdit.event.correlationId, ROOT);
  assert.deepEqual(childEdit.event.payload.paths, ['child.txt']);
  assert.ok(
    events.some(
      entry => entry.event.kind === 'session.started' && entry.event.subagentId === CHILD
    ),
    'the spawn is recorded with the child id'
  );
  assert.ok(!JSON.stringify(events).includes('foreign.txt'), 'a foreign thread posts nothing');
  assert.equal(
    channel.calls.filter(call => call.path === '/requests').length,
    1,
    'a foreign approval gets no card'
  );
  assert.deepEqual(
    captured.map(frame => [frame.event, frame.context.subagentThreadId ?? null]),
    [['item/completed:fileChange', CHILD]],
    'change capture includes the child edit and nothing foreign'
  );

  controller.abort();
  const interrupts = new Set<string>();
  for (let index = 0; index < 2; index += 1) {
    const params = await respond(memory, answered, 'turn/interrupt', {});
    interrupts.add(`${params.threadId as string}:${params.turnId as string}`);
  }
  const result = await running;
  assert.deepEqual(
    interrupts,
    new Set([`${ROOT}:${ROOT_TURN}`, `${CHILD}:${CHILD_TURN}`]),
    'stopping the session stops the subagent too'
  );
  assert.equal(result.childThreads, 1);
  assert.ok(
    !memory.sent.some(message => message.id === 1 && 'result' in message),
    'the foreign approval is left to its own client'
  );
});

test('supervisor: a resumed session imports its tree history once, through the live path', async () => {
  const memory = memoryTransport();
  const answered = new Set<unknown>();
  const channel = createFakeChannel();
  const captured: string[] = [];
  const controller = new AbortController();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: ROOT,
    importHistory: true,
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    stopSignal: controller.signal,
    capture: frame => {
      if (frame.event === 'item/completed:fileChange') captured.push(frame.event);
    }
  });
  await respond(memory, answered, 'initialize', INIT);
  await respond(memory, answered, 'thread/resume', {
    thread: { id: ROOT, turns: [] },
    cwd: '/repo'
  });
  await respond(memory, answered, 'thread/turns/list', {
    data: [
      turn(ROOT_TURN, [
        { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Spawn a subagent.' }] },
        spawnedItem,
        fileChange('exec-root', 'parent.txt')
      ])
    ],
    nextCursor: null
  });
  await respond(memory, answered, 'thread/list', { data: [], nextCursor: null });
  const childPage = await respond(memory, answered, 'thread/turns/list', {
    data: [turn(CHILD_TURN, [fileChange('exec-child', 'child.txt')])],
    nextCursor: null
  });
  assert.equal(childPage.threadId, CHILD, 'the child announced in history is imported too');
  await respond(memory, answered, 'thread/list', { data: [], nextCursor: null });
  await tick(30);
  controller.abort();
  const result = await running;
  assert.equal(result.historyItems, 4);
  const events = postedEvents(channel).map(entry => entry.event);
  assert.deepEqual(
    events.map(event => [event.kind, event.subagentId, event.payload.paths ?? null]),
    [
      ['prompt.submitted', null, null],
      ['session.started', CHILD, null],
      ['file.edited', null, ['parent.txt']],
      ['file.edited', CHILD, ['child.txt']]
    ]
  );
  assert.deepEqual(captured, ['item/completed:fileChange', 'item/completed:fileChange']);
  assert.equal(
    memory.sent.filter(message => message.method === 'thread/turns/list').length,
    2,
    'each thread is paged once'
  );
});

test('supervisor: without importHistory a resume exchanges no history frames', async () => {
  const memory = memoryTransport();
  const answered = new Set<unknown>();
  const controller = new AbortController();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: createFakeChannel(),
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: ROOT,
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    stopSignal: controller.signal
  });
  await respond(memory, answered, 'initialize', INIT);
  await respond(memory, answered, 'thread/resume', { thread: { id: ROOT, turns: [] } });
  await tick(30);
  controller.abort();
  await running;
  assert.ok(!memory.sent.some(message => message.method === 'thread/turns/list'));
});
