import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

import { findAgentSessionCodec } from '../dist/agent-session/codec-registry.generated.js';
import {
  codexDecisionFor,
  commandApprovalCard,
  DecisionRouter,
  deferToPerson,
  fileChangeApprovalCard,
  policyDecision,
  userInputAnswer,
  userInputCard
} from '../dist/agent-session/codex-app-server/decisions.js';
import {
  createThreadTracker,
  nativeEventName,
  normalizeProjectedFrame,
  projectNotification,
  trackNotification
} from '../dist/agent-session/codex-app-server/events.js';
import { createFakeChannel } from '../dist/agent-session/codex-app-server/fake-channel.js';
import { runCodexAppServerSidecar } from '../dist/agent-session/codex-app-server/index.js';
import { codexAppServerInjectPath } from '../dist/agent-session/codex-app-server/inject.js';
import {
  buildThreadStartParams,
  CODEX_APP_SERVER_MIN_VERSION,
  isSupportedVersion,
  OPT_OUT_NOTIFICATION_METHODS,
  parseCliVersion,
  parseServerVersion,
  PINNED_CLIENT_METHODS,
  PINNED_SERVER_REQUESTS
} from '../dist/agent-session/codex-app-server/protocol.js';
import { JsonRpcPeer, NoResponse } from '../dist/agent-session/codex-app-server/rpc.js';
import {
  buildServerEnv,
  prepareSocketDirectory,
  startServerWatchdog
} from '../dist/agent-session/codex-app-server/server.js';
import { runCodexAppServerSupervisor } from '../dist/agent-session/codex-app-server/supervisor.js';
import {
  connectWebSocket,
  encodeClientFrame,
  type MessageTransport,
  parseServerFrame
} from '../dist/agent-session/codex-app-server/transport.js';
import { findHarnessDescriptor } from '../dist/agent-session/descriptor.js';
import { resolveInjectPath, runAgentSessionInbox } from '../dist/agent-session/inbox.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

// ── protocol ──────────────────────────────────────────────────────────────────

test('protocol: the pinned surface is the reviewed list', () => {
  assert.deepEqual(
    [...PINNED_CLIENT_METHODS],
    [
      'initialize',
      'thread/start',
      'thread/resume',
      'thread/read',
      'thread/list',
      'thread/turns/list',
      'turn/start',
      'turn/steer',
      'turn/interrupt'
    ]
  );
  assert.deepEqual(
    [...PINNED_SERVER_REQUESTS],
    [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/tool/requestUserInput'
    ]
  );
  assert.ok(OPT_OUT_NOTIFICATION_METHODS.includes('item/commandExecution/outputDelta'));
});

test('protocol: version parsing and gate', () => {
  assert.equal(
    parseServerVersion('overlord/0.170.0 (Mac OS 27.2.1; arm64) xterm-256color (overlord; 1)'),
    '0.170.0'
  );
  assert.equal(parseServerVersion('garbage'), null);
  assert.equal(parseCliVersion('codex-cli 0.171.0\n'), '0.171.0');
  assert.equal(isSupportedVersion(CODEX_APP_SERVER_MIN_VERSION), true);
  assert.equal(isSupportedVersion('0.171.0'), true);
  assert.equal(isSupportedVersion('0.169.9'), false);
  assert.equal(isSupportedVersion(null), false);
});

test('protocol: every thread is started with approvalsReviewer user, persistent', () => {
  const params = buildThreadStartParams({ cwd: '/repo', model: 'm', effort: 'low' });
  assert.equal(params.approvalsReviewer, 'user');
  assert.equal(params.ephemeral, false);
  assert.deepEqual(params.config, { model_reasoning_effort: 'low' });
});

// ── transport ─────────────────────────────────────────────────────────────────

test('transport: client frames are masked and round-trip through the parser', () => {
  for (const size of [5, 300, 70_000]) {
    const payload = Buffer.alloc(size, 'a');
    const frame = encodeClientFrame(payload, 0x1, Buffer.from([1, 2, 3, 4]));
    assert.equal(frame[1]! & 0x80, 0x80, 'client frames carry the mask bit');
    const parsed = parseServerFrame(frame);
    assert.ok(parsed);
    assert.equal(parsed.opcode, 0x1);
    assert.equal(parsed.fin, true);
    assert.equal(parsed.payload.toString(), payload.toString());
    assert.equal(parsed.consumed, frame.length);
  }
  assert.equal(parseServerFrame(Buffer.from([0x81])), null, 'partial frame waits for more bytes');
});

function serverFrame(text: string, opcode = 0x1): Buffer {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x80 | opcode, payload.length])
      : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

/** A minimal WebSocket server on a Unix socket, enough to prove the client's handshake. */
function startWsServer(
  socketPath: string,
  { status = 101, onRequest }: { status?: number; onRequest?: (header: string) => void } = {}
): Promise<{ server: net.Server; received: string[]; sockets: net.Socket[] }> {
  const received: string[] = [];
  const sockets: net.Socket[] = [];
  return new Promise(resolve => {
    const server = net.createServer(socket => {
      sockets.push(socket);
      let buffer = Buffer.alloc(0);
      let upgraded = false;
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        if (!upgraded) {
          const end = buffer.indexOf('\r\n\r\n');
          if (end < 0) return;
          const header = buffer.subarray(0, end).toString();
          buffer = buffer.subarray(end + 4);
          onRequest?.(header);
          if (status !== 101) {
            socket.end(`HTTP/1.1 ${status} Unauthorized\r\n\r\n`);
            return;
          }
          const key = /sec-websocket-key:\s*(.+)/i.exec(header)?.[1]?.trim() ?? '';
          const accept = createHash('sha1')
            .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
            .digest('base64');
          upgraded = true;
          // Upgrade response plus a ping and a text frame in the same chunk.
          socket.write(
            Buffer.concat([
              Buffer.from(
                `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
              ),
              serverFrame('hi', 0x9),
              serverFrame('{"method":"hello"}')
            ])
          );
        }
        for (;;) {
          const frame = parseServerFrame(buffer);
          if (!frame) return;
          buffer = buffer.subarray(frame.consumed);
          received.push(`${frame.opcode}:${frame.payload.toString()}`);
        }
      });
    });
    server.listen(socketPath, () => resolve({ server, received, sockets }));
  });
}

test('transport: WebSocket over a Unix socket — handshake, early frame, ping/pong, send', async () => {
  const dir = mkdtempSync('/tmp/cx-ws-');
  const socketPath = path.join(dir, 's.sock');
  let header = '';
  const { server, received } = await startWsServer(socketPath, {
    onRequest: value => {
      header = value;
    }
  });
  try {
    const transport = await connectWebSocket({ kind: 'unix', socketPath });
    const messages: string[] = [];
    transport.onMessage(text => messages.push(text));
    transport.send('{"id":1,"method":"initialize"}');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(messages, ['{"method":"hello"}'], 'a frame in the upgrade chunk is not lost');
    assert.ok(received.includes('10:hi'), 'ping answered with pong');
    assert.ok(received.includes('1:{"id":1,"method":"initialize"}'));
    assert.doesNotMatch(header, /^origin:/im, 'no Origin header (Codex refuses browsers)');
    assert.doesNotMatch(header, /^authorization:/im, 'no bearer on a Unix socket');
    transport.close();
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('transport: a refused upgrade rejects the connection', async () => {
  const dir = mkdtempSync('/tmp/cx-ws-');
  const socketPath = path.join(dir, 's.sock');
  const { server } = await startWsServer(socketPath, { status: 401 });
  try {
    await assert.rejects(connectWebSocket({ kind: 'unix', socketPath }), /upgrade refused/);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── rpc ───────────────────────────────────────────────────────────────────────

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

const tick = (ms = 10): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('rpc: unknown server requests are refused, NoResponse stays silent', async () => {
  const memory = memoryTransport();
  const rpc = new JsonRpcPeer(memory.transport);
  rpc.handleServerRequest('item/tool/requestUserInput', async () => NoResponse.instance);
  memory.deliver({ id: 7, method: 'mcpServer/elicitation/request', params: {} });
  memory.deliver({ id: 8, method: 'item/tool/requestUserInput', params: {} });
  await tick();
  assert.deepEqual(memory.sent, [
    {
      id: 7,
      error: { code: -32601, message: 'mcpServer/elicitation/request is not handled by Overlord' }
    }
  ]);
});

test('rpc: overload (-32001) is retried, other errors are not', async () => {
  const memory = memoryTransport();
  const rpc = new JsonRpcPeer(memory.transport, { sleep: async () => undefined });
  const pending = rpc.request('thread/read', { threadId: 't' });
  await tick();
  memory.deliver({ id: 1, error: { code: -32001, message: 'busy' } });
  await tick();
  memory.deliver({ id: 2, result: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
  const failing = rpc.request('turn/steer', {});
  await tick();
  memory.deliver({ id: 3, error: { code: -32600, message: 'no active turn to steer' } });
  await assert.rejects(failing, /no active turn/);
});

// ── events ────────────────────────────────────────────────────────────────────

test('events: native names and per-change fan-out', () => {
  assert.equal(
    nativeEventName('item/completed', { item: { type: 'commandExecution' } }),
    'item/completed:commandExecution'
  );
  assert.equal(nativeEventName('turn/started', {}), 'turn/started');
  const frames = projectNotification({
    method: 'item/completed',
    params: {
      threadId: 't',
      turnId: 'u',
      item: {
        type: 'fileChange',
        id: 'i',
        status: 'completed',
        changes: [
          { path: '/repo/a.ts', kind: { type: 'add' }, diff: 'SECRET-CONTENT\n' },
          { path: '/repo/b.ts', kind: { type: 'update', move_path: '/repo/c.ts' }, diff: '@@' }
        ]
      }
    },
    cwd: '/repo'
  });
  assert.equal(frames.length, 2);
  const codec = findAgentSessionCodec('codex-app-server');
  assert.ok(codec);
  const events = frames.map(frame => normalizeProjectedFrame({ codec, frame }));
  assert.deepEqual(
    events.map(event => event?.payload.paths),
    [['a.ts'], ['b.ts', 'c.ts']],
    'every change, and both rename endpoints'
  );
  assert.ok(!JSON.stringify(events).includes('SECRET-CONTENT'));
});

test('events: the compiled codec equals the connector-owned YAML', () => {
  const yaml = parseYaml(
    readFileSync(
      path.join(repoRoot, 'connectors/adapters/codex-app-server/codec/codex-app-server.codec.yaml'),
      'utf8'
    )
  ) as unknown;
  assert.deepEqual(findAgentSessionCodec('codex-app-server'), yaml);
});

test('events: thread tracker follows turns, flags and pre-mutation changes', () => {
  const tracker = createThreadTracker('t');
  trackNotification(tracker, 'turn/started', { threadId: 't', turn: { id: 'u1' } });
  assert.equal(tracker.activeTurnId, 'u1');
  trackNotification(tracker, 'turn/started', { threadId: 'other', turn: { id: 'x' } });
  assert.equal(tracker.activeTurnId, 'u1', 'other threads are ignored');
  trackNotification(tracker, 'thread/status/changed', {
    threadId: 't',
    status: { type: 'active', activeFlags: ['waitingOnApproval'] }
  });
  assert.deepEqual(tracker.activeFlags, ['waitingOnApproval']);
  trackNotification(tracker, 'item/started', {
    threadId: 't',
    item: { type: 'fileChange', id: 'i', changes: [{ path: '/repo/a', kind: { type: 'add' } }] }
  });
  assert.deepEqual(tracker.fileChanges.get('i'), [{ path: '/repo/a', kind: 'add' }]);
  trackNotification(tracker, 'turn/completed', { threadId: 't', turn: { id: 'u0' } });
  assert.equal(tracker.activeTurnId, null, 'one turn per thread: any completion idles it');
});

// ── decisions ─────────────────────────────────────────────────────────────────

test('decisions: deny is decline only when offered, never a standing grant', () => {
  const untrusted = [
    'accept',
    { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['x'] } },
    'cancel'
  ];
  assert.equal(codexDecisionFor({ decision: 'allow', availableDecisions: untrusted }), 'accept');
  assert.equal(codexDecisionFor({ decision: 'deny', availableDecisions: untrusted }), 'cancel');
  assert.equal(
    codexDecisionFor({ decision: 'deny', availableDecisions: ['accept', 'decline', 'cancel'] }),
    'decline'
  );
  assert.equal(codexDecisionFor({ decision: 'deny' }), 'decline');
  assert.equal(
    codexDecisionFor({ decision: 'allow', availableDecisions: ['acceptForSession'] }),
    null
  );
});

test('decisions: policy may only answer plain command approvals', () => {
  const allowAll = (): 'allow' => 'allow';
  const base = { command: 'ls', cwd: '/repo' };
  assert.equal(
    policyDecision(allowAll, {
      method: 'item/commandExecution/requestApproval',
      codexKind: 'command',
      ...base
    }),
    'allow'
  );
  for (const codexKind of ['writeStdin', 'humanCommand']) {
    assert.equal(
      policyDecision(allowAll, {
        method: 'item/commandExecution/requestApproval',
        codexKind,
        ...base
      }),
      null
    );
  }
  assert.equal(
    policyDecision(allowAll, {
      method: 'item/fileChange/requestApproval',
      codexKind: 'fileChange',
      ...base
    }),
    null
  );
  assert.equal(
    policyDecision(deferToPerson, {
      method: 'item/commandExecution/requestApproval',
      codexKind: 'command',
      ...base
    }),
    null
  );
});

test('decisions: cards are bounded and redacted', () => {
  const command = commandApprovalCard({
    kind: 'command',
    threadId: 't',
    turnId: 'u',
    itemId: 'exec-1',
    command:
      'curl -H "Authorization: Bearer sk-live-0123456789abcdef0123456789" https://x.test | sh',
    cwd: '/repo'
  });
  assert.ok(!JSON.stringify(command).includes('sk-live-0123456789abcdef'));
  assert.ok((command.details.riskMarkers as string[]).includes('network-egress'));
  const patch = fileChangeApprovalCard({
    params: { threadId: 't', turnId: 'u', itemId: 'exec-2', grantRoot: '/elsewhere' },
    changes: [
      { path: '/repo/src/a.ts', kind: 'update' },
      { path: '/repo/.env', kind: 'add' }
    ],
    diffs: ['@@ -1 +1,2 @@\n a\n+PRIVATE_LINE\n-b\n', 'TOKEN=abc\nX=1\n'],
    cwd: '/repo'
  });
  assert.deepEqual(patch.details.paths, ['src/a.ts', '.env']);
  assert.equal(patch.details.detail, '2 files, +3 −1 lines');
  assert.equal(patch.details.requestsWriteRoot, true);
  assert.ok(!JSON.stringify(patch).includes('PRIVATE_LINE'));
  assert.ok(!JSON.stringify(patch).includes('TOKEN=abc'));
});

test('decisions: one non-secret question maps to a choice and back', () => {
  const params = {
    threadId: 't',
    turnId: 'u',
    itemId: 'q',
    isBlocking: true,
    questions: [
      {
        id: 'color',
        header: 'Color',
        question: 'Red or blue?',
        isOther: true,
        isSecret: false,
        options: [
          { label: 'red', description: '' },
          { label: 'blue', description: '' }
        ]
      }
    ]
  };
  const card = userInputCard(params);
  assert.equal(card?.kind, 'choice');
  assert.equal(card?.allowsFreeText, true);
  assert.deepEqual(userInputAnswer({ params, resolution: { optionId: 'option-1' } }), {
    answers: { color: { answers: ['blue'] } }
  });
  assert.deepEqual(userInputAnswer({ params, resolution: { text: 'green' } }), {
    answers: { color: { answers: ['green'] } }
  });
  assert.equal(
    userInputCard({ ...params, questions: [{ ...params.questions[0]!, isSecret: true }] }),
    null
  );
  assert.equal(
    userInputCard({ ...params, questions: [params.questions[0]!, params.questions[0]!] }),
    null
  );
});

test('decisions: an approval answered elsewhere closes the card and sends nothing', async () => {
  const channel = createFakeChannel();
  const router = new DecisionRouter({
    client: channel,
    tracker: createThreadTracker('t'),
    cwd: () => '/repo',
    sleep: () => tick(2)
  });
  const answer = router.commandApproval(
    {
      kind: 'command',
      threadId: 't',
      turnId: 'u',
      itemId: 'exec-1',
      command: 'ls',
      availableDecisions: ['accept', 'decline']
    },
    4
  );
  await tick(20);
  await router.onServerRequestResolved({ threadId: 't', requestId: 4 });
  assert.equal(await answer, NoResponse.instance);
  assert.ok(channel.calls.some(call => call.path === '/requests/req-1/resolved-elsewhere'));
});

test('decisions: an approval asked again for the same item never inherits the earlier answer', async () => {
  // The server dedupes cards by native id; this fake mimics it by resolving the first card and
  // answering a second POST for the same native id with that resolved card.
  const resolved = { leaseId: 'l', status: 'resolved', resolution: { optionId: 'allow' } };
  const channel = createFakeChannel({
    script: {
      'POST /requests/req-1/lease': [resolved],
      'POST /requests/req-2/lease': [{ leaseId: 'l2', status: 'released', resolution: null }]
    }
  });
  const router = new DecisionRouter({
    client: channel,
    tracker: createThreadTracker('t'),
    cwd: () => '/repo',
    sleep: () => tick(1)
  });
  const params = {
    kind: 'command',
    threadId: 't',
    turnId: 'u',
    itemId: 'exec-1',
    command: 'make',
    availableDecisions: ['accept', 'decline']
  };
  assert.deepEqual(await router.commandApproval(params, 1), { decision: 'accept' });
  // Codex asks again about exec-1 (for example to run it outside the sandbox).
  const second = await router.commandApproval({ ...params, command: 'make install' }, 2);
  assert.equal(second, NoResponse.instance, 'the earlier allow is not reused');
  const cards = channel.calls.filter(call => call.method === 'POST' && call.path === '/requests');
  assert.equal(cards.length, 2);
  assert.equal((cards[0]!.body as { nativeRequestId: string }).nativeRequestId, 'exec-1');
  assert.equal((cards[1]!.body as { nativeRequestId: string }).nativeRequestId, 'exec-1#2');
});

test('decisions: a released card leaves the approval to the terminal', async () => {
  const channel = createFakeChannel({
    script: {
      'POST /requests/req-1/lease': [{ leaseId: 'l', status: 'released', resolution: null }]
    }
  });
  const router = new DecisionRouter({
    client: channel,
    tracker: createThreadTracker('t'),
    cwd: () => null
  });
  const answer = await router.fileChangeApproval({ threadId: 't', turnId: 'u', itemId: 'p' }, 1);
  assert.equal(answer, NoResponse.instance);
});

// ── inject routing ────────────────────────────────────────────────────────────

test('inject: routing is a closed choice from thread state, shared with resolveInjectPath', () => {
  assert.equal(codexAppServerInjectPath({ activeTurnId: 'u' }), 'codex-app-server-steer');
  assert.equal(codexAppServerInjectPath({ activeTurnId: null }), 'codex-app-server-turn-start');
  assert.equal(
    resolveInjectPath({ agent: 'codex-app-server', payload: { activeTurnId: 'u' } }),
    'codex-app-server-steer'
  );
  assert.equal(
    resolveInjectPath({ agent: 'codex-app-server', payload: {} }),
    'codex-app-server-turn-start'
  );
  // The hooks adapter is unchanged.
  assert.equal(
    resolveInjectPath({ agent: 'codex', payload: { hook_event_name: 'Stop' } }),
    'codex-turn-boundary'
  );
});

test('inject: the inbox command never claims for the control-plane adapter', async () => {
  const channel = createFakeChannel();
  const result = await runAgentSessionInbox({
    agent: 'codex-app-server',
    payloadRaw: '{}',
    env: {
      OVERLORD_SESSION_CHANNEL_ID: 'ch',
      OVERLORD_SESSION_CHANNEL_TOKEN: 'tok',
      OVERLORD_BACKEND_URL: 'http://x'
    },
    client: channel
  });
  assert.equal(result.report, 'Unsupported');
  assert.equal(channel.calls.length, 0);
});

// ── server ────────────────────────────────────────────────────────────────────

test('server: the app server environment is an allowlist plus the surface marker', () => {
  const env = buildServerEnv({
    PATH: '/bin',
    HOME: '/home/u',
    LC_ALL: 'C',
    CODEX_HOME: '/home/u/.codex',
    OVERLORD_USER_TOKEN: 'secret',
    OVERLORD_SESSION_CHANNEL_ID: 'ch',
    OVERLORD_SESSION_CHANNEL_TOKEN: 'tok',
    OVERLORD_OBJECTIVE_ID: 'coo:1.a',
    MISSION_ID: 'coo:1',
    SESSION_KEY: 'sess',
    Overlord_USER_TOKEN: 'secret2',
    AWS_SECRET_ACCESS_KEY: 'aws'
  });
  assert.deepEqual(env, {
    PATH: '/bin',
    HOME: '/home/u',
    LC_ALL: 'C',
    CODEX_HOME: '/home/u/.codex',
    OVERLORD_CONTROL_PLANE_SURFACE: 'codex-app-server'
  });
});

test('server: the socket directory must be owner-only', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-home-'));
  try {
    const dir = prepareSocketDirectory(home);
    assert.equal(dir, path.join(home, '.ovld', 'cx'));
    chmodSync(dir, 0o755);
    // prepare re-tightens a directory it owns
    assert.equal(prepareSocketDirectory(home), dir);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── supervisor ────────────────────────────────────────────────────────────────

const codecFor = () => {
  const codec = findAgentSessionCodec('codex-app-server');
  assert.ok(codec);
  return codec;
};

async function respond(
  memory: ReturnType<typeof memoryTransport>,
  method: string,
  result: unknown
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const request = memory.sent.find(
      message => message.method === method && message.id !== undefined
    );
    if (request) {
      memory.deliver({ id: request.id, result });
      return;
    }
    await tick(5);
  }
  throw new Error(`no ${method} request`);
}

const INIT = { userAgent: 'overlord/0.170.0 (x) (overlord; test)' };

test('supervisor: an abort interrupts the running turn and stops', async () => {
  const memory = memoryTransport();
  const controller = new AbortController();
  const channel = createFakeChannel();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: 'thr',
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    stopSignal: controller.signal
  });
  await respond(memory, 'initialize', INIT);
  await respond(memory, 'thread/resume', {
    thread: {
      id: 'thr',
      turns: [
        { id: 'done', status: 'completed' },
        { id: 'live', status: 'inProgress' }
      ]
    },
    cwd: '/repo'
  });
  await tick(20);
  controller.abort();
  await respond(memory, 'turn/interrupt', {});
  const result = await running;
  assert.equal(result.reason, 'stopped');
  assert.equal(result.interrupted, true);
  assert.deepEqual(memory.sent.find(message => message.method === 'turn/interrupt')?.params, {
    threadId: 'thr',
    turnId: 'live'
  });
});

test('supervisor: remote control enabled stops the session', async () => {
  const memory = memoryTransport();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: createFakeChannel(),
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: 'thr',
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0
  });
  await respond(memory, 'initialize', INIT);
  await respond(memory, 'thread/resume', { thread: { id: 'thr', turns: [] } });
  await tick(10);
  memory.deliver({ method: 'remoteControl/status/changed', params: { status: 'connected' } });
  assert.equal((await running).reason, 'remote-control-enabled');
});

test('supervisor: remote control that is not disabled at connect starts no thread', async () => {
  for (const status of ['connecting', 'connected', 'errored']) {
    const memory = memoryTransport();
    const running = runCodexAppServerSupervisor({
      codec: codecFor(),
      client: createFakeChannel(),
      connect: async () => memory.transport,
      cwd: '/repo',
      clientVersion: 't',
      firstPrompt: 'Run the tests.',
      maxReconnects: 0,
      heartbeatIntervalMs: 0,
      injectIntervalMs: 0,
      remoteControlWaitMs: 5000
    });
    await respond(memory, 'initialize', INIT);
    memory.deliver({ method: 'remoteControl/status/changed', params: { status } });
    assert.equal((await running).reason, 'remote-control-enabled', status);
    assert.ok(
      !memory.sent.some(
        message => message.method === 'thread/start' || message.method === 'turn/start'
      ),
      `${status}: no thread or turn was started`
    );
  }
});

test('supervisor: reconnect resumes the thread, reuses replayed cards, closes the rest', async () => {
  const connections: ReturnType<typeof memoryTransport>[] = [];
  const channel = createFakeChannel();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => {
      const memory = memoryTransport();
      connections.push(memory);
      return memory.transport;
    },
    cwd: '/repo',
    clientVersion: 't',
    maxReconnects: 1,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    reconcileWindowMs: 30,
    sleep: () => tick(1)
  });
  await tick(5);
  const first = connections[0]!;
  await respond(first, 'initialize', INIT);
  await respond(first, 'thread/start', { thread: { id: 'thr' }, cwd: '/repo' });
  await tick(5);
  const approval = (id: number, itemId: string) => ({
    id,
    method: 'item/commandExecution/requestApproval',
    params: {
      kind: 'command',
      threadId: 'thr',
      turnId: 'u',
      itemId,
      command: 'ls',
      availableDecisions: ['accept', 'decline']
    }
  });
  first.deliver(approval(0, 'exec-a'));
  first.deliver(approval(1, 'exec-b'));
  await tick(30);
  assert.equal(channel.calls.filter(call => call.path === '/requests').length, 2);
  first.close();
  await tick(10);
  const second = connections[1]!;
  await respond(second, 'initialize', INIT);
  await respond(second, 'thread/resume', { thread: { id: 'thr', turns: [] }, cwd: '/repo' });
  assert.equal(
    second.sent.find(message => message.method === 'thread/resume')?.params &&
      (
        second.sent.find(message => message.method === 'thread/resume')!.params as {
          approvalsReviewer: string;
        }
      ).approvalsReviewer,
    'user'
  );
  // Codex replays only the approval that is still pending.
  second.deliver(approval(0, 'exec-a'));
  await tick(80);
  assert.equal(
    channel.calls.filter(call => call.path === '/requests').length,
    2,
    'the replay reuses its card'
  );
  assert.ok(channel.calls.some(call => call.path === '/requests/req-2/resolved-elsewhere'));
  assert.ok(!channel.calls.some(call => call.path === '/requests/req-1/resolved-elsewhere'));
  second.close();
  assert.equal((await running).reason, 'reconnect-exhausted');
});

// ── entry gate ────────────────────────────────────────────────────────────────

test('entry: an unbound process does nothing; the flag gates a bound one', async () => {
  assert.deepEqual(await runCodexAppServerSidecar({ env: {}, codexBin: '/nonexistent/codex' }), {
    reason: 'no-scope'
  });
  assert.deepEqual(
    await runCodexAppServerSidecar({
      env: {
        OVERLORD_SESSION_CHANNEL_ID: 'ch',
        OVERLORD_SESSION_CHANNEL_TOKEN: 'tok',
        OVERLORD_BACKEND_URL: 'http://x'
      },
      codexBin: '/nonexistent/codex'
    }),
    { reason: 'flag-off' }
  );
});

test('descriptor: codex-app-server is compiled as a tier-3 controlPlane adapter', () => {
  const descriptor = findHarnessDescriptor('codex-app-server');
  assert.ok(descriptor);
  assert.equal(descriptor.integrationShape, 'controlPlane');
  assert.equal(descriptor.capabilityTier, 3);
  assert.equal(descriptor.capabilities['inject.midTurn'].status, 'supported');
  assert.equal(descriptor.capabilities['answer.structuredQuestion'].status, 'unverified');
  assert.equal(
    findHarnessDescriptor('codex')?.integrationShape,
    'callback',
    'hooks adapter unchanged'
  );
});

// ── launch integration (coo:1325.ke1y) ───────────────────────────────────────

test('supervisor: an ended objective interrupts the turn and stops (heartbeat lifecycle)', async () => {
  const memory = memoryTransport();
  const channel = createFakeChannel({
    script: {
      'POST /heartbeat': [
        { ok: true, objectiveState: 'executing', deliveryState: null },
        { ok: true, objectiveState: 'complete', deliveryState: 'delivered' }
      ]
    }
  });
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: 'thr',
    maxReconnects: 0,
    heartbeatIntervalMs: 15,
    injectIntervalMs: 0
  });
  await respond(memory, 'initialize', INIT);
  await respond(memory, 'thread/resume', {
    thread: { id: 'thr', turns: [{ id: 'live', status: 'inProgress' }] },
    cwd: '/repo'
  });
  await respond(memory, 'turn/interrupt', {});
  const result = await running;
  assert.equal(result.reason, 'objective-ended');
  assert.equal(result.interrupted, true);
});

test('supervisor: a delivered session stops only after its thread stayed idle', async () => {
  const memory = memoryTransport();
  let clock = 0;
  const delivered = { ok: true, objectiveState: 'pending_delivery', deliveryState: 'delivered' };
  const channel = createFakeChannel({
    script: { 'POST /heartbeat': Array.from({ length: 50 }, () => delivered) }
  });
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: channel,
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    threadId: 'thr',
    maxReconnects: 0,
    heartbeatIntervalMs: 5,
    injectIntervalMs: 0,
    idleAfterDeliveryMs: 1000,
    now: () => new Date(clock)
  });
  await respond(memory, 'initialize', INIT);
  await respond(memory, 'thread/resume', {
    thread: { id: 'thr', turns: [{ id: 'live', status: 'inProgress' }] },
    cwd: '/repo'
  });
  // A running turn (a follow-up) keeps a delivered session alive.
  clock = 5000;
  await tick(40);
  memory.deliver({
    method: 'turn/completed',
    params: { threadId: 'thr', turn: { id: 'live', status: 'completed' } }
  });
  await tick(30);
  clock = 5500;
  await tick(30);
  let settled = false;
  void running.then(() => {
    settled = true;
  });
  await tick(10);
  assert.equal(settled, false, 'idle for less than the window');
  clock = 7000;
  const result = await running;
  assert.equal(result.reason, 'objective-ended');
  assert.equal(result.interrupted, false);
});

test('supervisor: the thread is reported ready once its first turn started', async () => {
  const memory = memoryTransport();
  const ready: string[] = [];
  const controller = new AbortController();
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: createFakeChannel(),
    connect: async () => memory.transport,
    cwd: '/repo',
    clientVersion: 't',
    firstPrompt: 'Run the objective',
    maxReconnects: 0,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    rolloutReadyDelayMs: 0,
    onThreadReady: id => ready.push(id),
    stopSignal: controller.signal
  });
  await respond(memory, 'initialize', INIT);
  await respond(memory, 'thread/start', { thread: { id: 'thr-new' }, cwd: '/repo' });
  await respond(memory, 'turn/start', { turn: { id: 'turn-1' } });
  assert.deepEqual(ready, [], 'no rollout before the turn starts');
  memory.deliver({
    method: 'turn/started',
    params: { threadId: 'thr-new', turn: { id: 'turn-1', status: 'inProgress' } }
  });
  memory.deliver({
    method: 'turn/started',
    params: { threadId: 'thr-new', turn: { id: 'turn-1', status: 'inProgress' } }
  });
  await tick(20);
  assert.deepEqual(ready, ['thr-new'], 'reported once');
  const start = memory.sent.find(message => message.method === 'thread/start');
  assert.equal((start?.params as { approvalsReviewer?: string }).approvalsReviewer, 'user');
  controller.abort();
  await respond(memory, 'turn/interrupt', {});
  await running;
});

test('supervisor: after a server restart an idle thread gets one continuation turn', async () => {
  const connections: ReturnType<typeof memoryTransport>[] = [];
  let continuations = 1;
  const running = runCodexAppServerSupervisor({
    codec: codecFor(),
    client: createFakeChannel(),
    connect: async () => {
      const memory = memoryTransport();
      connections.push(memory);
      return memory.transport;
    },
    cwd: '/repo',
    clientVersion: 't',
    threadId: 'thr',
    maxReconnects: 1,
    heartbeatIntervalMs: 0,
    injectIntervalMs: 0,
    reconcileWindowMs: 5,
    sleep: () => tick(1),
    consumeContinuationPrompt: () => (continuations-- > 0 ? 'Continue the objective.' : null)
  });
  await tick(5);
  await respond(connections[0]!, 'initialize', INIT);
  await respond(connections[0]!, 'thread/resume', {
    thread: { id: 'thr', turns: [{ id: 'live', status: 'inProgress' }] }
  });
  await tick(10);
  assert.equal(
    connections[0]!.sent.filter(message => message.method === 'turn/start').length,
    0,
    'a running turn is never doubled'
  );
  connections[0]!.close();
  await tick(10);
  const second = connections[1]!;
  await respond(second, 'initialize', INIT);
  await respond(second, 'thread/resume', {
    thread: { id: 'thr', turns: [{ id: 'live', status: 'interrupted' }] }
  });
  await respond(second, 'turn/start', { turn: { id: 'turn-2' } });
  const start = second.sent.find(message => message.method === 'turn/start');
  assert.deepEqual(start?.params, {
    threadId: 'thr',
    input: [{ type: 'text', text: 'Continue the objective.', text_elements: [] }]
  });
  second.close();
  assert.equal((await running).reason, 'reconnect-exhausted');
});

test('server: the watchdog ends the server group when the supervisor is killed', async () => {
  const { spawn } = await import('node:child_process');
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  // Stand-ins: a "server" leading its own process group, and a "supervisor" to kill -9.
  const server = spawn('/bin/sleep', ['60'], { detached: true, stdio: 'ignore' });
  const supervisor = spawn('/bin/sleep', ['60'], { stdio: 'ignore' });
  const watchdog = startServerWatchdog(supervisor.pid!, server.pid!);
  try {
    await tick(300);
    assert.ok(alive(server.pid!), 'the server runs while the supervisor does');
    supervisor.kill('SIGKILL');
    const deadline = Date.now() + 8000;
    while (alive(server.pid!) && Date.now() < deadline) await tick(100);
    // A reaped zombie still answers kill -0 until its parent waits; `exitCode` settles that.
    await tick(100);
    assert.ok(server.exitCode !== null || server.signalCode !== null, 'the server group was ended');
  } finally {
    for (const child of [server, supervisor, watchdog]) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Already gone.
      }
    }
  }
});
