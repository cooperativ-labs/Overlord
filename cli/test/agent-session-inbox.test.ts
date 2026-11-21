import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelClient } from '../dist/agent-session/client.js';
import {
  type ClaimedInput,
  CLAUDE_HEADLESS_STOP_WAIT_MS,
  emitClaimedInput,
  encodeClaudeStopBlock,
  encodeCodexStopBlock,
  encodeCursorFollowup,
  hasRunningBackgroundTasks,
  INBOX_POLL_INTERVAL_MS,
  isHeadlessHarnessSession,
  MAX_INBOX_WAIT_MS,
  resolveInboxWaitMs,
  resolveInjectPath,
  runAgentSessionInbox
} from '../dist/agent-session/inbox.js';

test('resolveInjectPath: Claude Stop is turn-boundary; everything else is mid-turn', () => {
  assert.equal(
    resolveInjectPath({ agent: 'claude', payload: { hook_event_name: 'Stop' } }),
    'claude-turn-boundary'
  );
  assert.equal(
    resolveInjectPath({ agent: 'claude', payload: { hook_event_name: 'SessionStart' } }),
    'claude-mid-turn'
  );
  assert.equal(
    resolveInjectPath({ agent: 'claude', payload: { hook_event_name: 'PostToolUse' } }),
    'claude-mid-turn'
  );
});

test('resolveInjectPath: Cursor mid-turn is unsupported; stop is turn-boundary', () => {
  assert.equal(
    resolveInjectPath({ agent: 'cursor', payload: { event: 'stop' } }),
    'cursor-turn-boundary'
  );
  assert.equal(
    resolveInjectPath({ agent: 'cursor', payload: { event: 'beforeShellExecution' } }),
    'unsupported'
  );
});

test('resolveInjectPath: Codex only injects at Stop, where Codex creates a continuation prompt', () => {
  assert.equal(
    resolveInjectPath({ agent: 'codex', payload: { hook_event_name: 'Stop' } }),
    'codex-turn-boundary'
  );
  assert.equal(
    resolveInjectPath({ agent: 'codex', payload: { hook_event_name: 'SessionStart' } }),
    'unsupported'
  );
});

test('native inject codecs produce exact harness bytes', () => {
  assert.equal(
    encodeClaudeStopBlock('Also update the changelog'),
    '{"decision":"block","reason":"Also update the changelog"}\n'
  );
  assert.equal(
    encodeCursorFollowup('Also update the changelog'),
    '{"followup_message":"Also update the changelog"}\n'
  );
  assert.equal(
    encodeCodexStopBlock('Also update the changelog'),
    '{"decision":"block","reason":"Also update the changelog"}\n'
  );
});

function fakeClient(handlers: {
  emitted?: (body: unknown) => { emitted: boolean };
  acknowledged?: () => unknown;
  failed?: () => unknown;
}): ChannelClient & { calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  return {
    calls,
    async post(path, body) {
      calls.push({ path, body });
      if (path.endsWith('/emitted')) {
        return { ok: true, value: handlers.emitted?.(body) ?? { emitted: true } };
      }
      if (path.endsWith('/acknowledged')) {
        handlers.acknowledged?.();
        return { ok: true, value: { acknowledged: true } };
      }
      if (path.endsWith('/failed')) {
        handlers.failed?.();
        return { ok: true, value: { failed: true } };
      }
      return { ok: true, value: {} };
    },
    async get() {
      return { ok: false, reason: 'network' };
    }
  };
}

const SAMPLE: ClaimedInput = {
  id: 'input-1',
  kind: 'instruction',
  body: 'Also update the changelog',
  leaseId: 'lease-1',
  leaseExpiresAt: null
};

test('Claude mid-turn reports Delivered and acknowledges', async () => {
  const client = fakeClient({});
  const result = await emitClaimedInput({
    agent: 'claude',
    path: 'claude-mid-turn',
    input: SAMPLE,
    client
  });
  assert.equal(result.report, 'Delivered');
  assert.equal(result.exitCode, 2);
  assert.equal(result.stderr, '[Overlord] Also update the changelog');
  assert.equal(result.stdout, '');
  assert.equal(client.calls[0]?.body?.deliveryOutcome, 'delivered');
  assert.ok(client.calls.some(call => call.path.endsWith('/acknowledged')));
});

test('Cursor turn-boundary reports Queued(turn-boundary) and never acknowledges', async () => {
  const client = fakeClient({});
  const result = await emitClaimedInput({
    agent: 'cursor',
    path: 'cursor-turn-boundary',
    input: SAMPLE,
    client
  });
  assert.equal(result.report, 'Queued(turn-boundary)');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"followup_message":"Also update the changelog"}\n');
  assert.equal(client.calls[0]?.body?.deliveryOutcome, 'queued_turn_boundary');
  assert.equal(
    client.calls.some(call => call.path.endsWith('/acknowledged')),
    false
  );
});

test('Codex Stop reports Delivered because Codex creates a continuation prompt from the reason', async () => {
  const client = fakeClient({});
  const result = await emitClaimedInput({
    agent: 'codex',
    path: 'codex-turn-boundary',
    input: SAMPLE,
    client
  });
  assert.equal(result.report, 'Delivered');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, '{"decision":"block","reason":"Also update the changelog"}\n');
  assert.equal(client.calls[0]?.body?.deliveryOutcome, 'delivered');
  assert.ok(client.calls.some(call => call.path.endsWith('/acknowledged')));
});

// ---------------------------------------------------------------- bounded inbox wait (n938)

const HEADLESS = { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };
const INTERACTIVE = { CLAUDE_CODE_ENTRYPOINT: 'cli' };
const RUNNING = [{ id: 'a1', type: 'subagent', status: 'running', agent_type: 'general-purpose' }];

test('headless is read from CLAUDE_CODE_ENTRYPOINT (sdk-*), only for Claude', () => {
  assert.equal(isHeadlessHarnessSession({ agent: 'claude', env: HEADLESS }), true);
  assert.equal(
    isHeadlessHarnessSession({ agent: 'claude', env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' } }),
    true
  );
  assert.equal(isHeadlessHarnessSession({ agent: 'claude', env: INTERACTIVE }), false);
  assert.equal(isHeadlessHarnessSession({ agent: 'claude', env: {} }), false);
  assert.equal(isHeadlessHarnessSession({ agent: 'codex', env: HEADLESS }), false);
});

test('running background tasks are read from the native array and the templated JSON string', () => {
  assert.equal(hasRunningBackgroundTasks({ background_tasks: RUNNING }), true);
  assert.equal(hasRunningBackgroundTasks({ background_tasks: JSON.stringify(RUNNING) }), true);
  assert.equal(hasRunningBackgroundTasks({ background_tasks: [] }), false);
  assert.equal(hasRunningBackgroundTasks({ background_tasks: '[]' }), false);
  assert.equal(
    hasRunningBackgroundTasks({ background_tasks: [{ ...RUNNING[0], status: 'completed' }] }),
    false
  );
  assert.equal(hasRunningBackgroundTasks({ background_tasks: 'not json' }), false);
  assert.equal(hasRunningBackgroundTasks({}), false);
});

test('only a final Claude Stop in a headless session waits by default', () => {
  const stop = { hook_event_name: 'Stop', stop_hook_active: false };
  assert.equal(
    resolveInboxWaitMs({ agent: 'claude', payload: stop, env: HEADLESS }),
    CLAUDE_HEADLESS_STOP_WAIT_MS
  );
  // A held Stop after a block still waits: the operator may follow up again.
  assert.equal(
    resolveInboxWaitMs({
      agent: 'claude',
      payload: { ...stop, stop_hook_active: true },
      env: HEADLESS
    }),
    CLAUDE_HEADLESS_STOP_WAIT_MS
  );
  assert.equal(resolveInboxWaitMs({ agent: 'claude', payload: stop, env: INTERACTIVE }), 0);
  assert.equal(
    resolveInboxWaitMs({
      agent: 'claude',
      payload: { ...stop, background_tasks: JSON.stringify(RUNNING) },
      env: HEADLESS
    }),
    0
  );
  assert.equal(
    resolveInboxWaitMs({
      agent: 'claude',
      payload: { hook_event_name: 'SubagentStop' },
      env: HEADLESS
    }),
    0
  );
  assert.equal(
    resolveInboxWaitMs({
      agent: 'claude',
      payload: { hook_event_name: 'PostToolUse' },
      env: HEADLESS
    }),
    0
  );
  assert.equal(
    resolveInboxWaitMs({ agent: 'codex', payload: { hook_event_name: 'Stop' }, env: HEADLESS }),
    0
  );
});

test('an explicit wait wins and is bounded', () => {
  const stop = { hook_event_name: 'Stop' };
  assert.equal(
    resolveInboxWaitMs({ agent: 'claude', payload: stop, env: HEADLESS, requestedMs: 0 }),
    0
  );
  assert.equal(
    resolveInboxWaitMs({ agent: 'claude', payload: stop, env: INTERACTIVE, requestedMs: 5_000 }),
    5_000
  );
  assert.equal(
    resolveInboxWaitMs({ agent: 'claude', payload: stop, env: {}, requestedMs: 10_000_000 }),
    MAX_INBOX_WAIT_MS
  );
  assert.equal(resolveInboxWaitMs({ agent: 'claude', payload: stop, env: {}, requestedMs: -1 }), 0);
});

/** A channel client whose claim answers from a script, on a fake clock. */
function pollingClient(claims: Array<'empty' | 'input' | 'error'>) {
  const clock = { now: 0, sleeps: [] as number[] };
  const client = fakeClient({});
  const basePost = client.post.bind(client);
  let claimCount = 0;
  client.post = (async (path: string, body: unknown, options?: { timeoutMs?: number }) => {
    if (path === '/inputs/claim') {
      client.calls.push({ path, body });
      const next = claims[Math.min(claimCount, claims.length - 1)];
      claimCount += 1;
      if (next === 'error') return { ok: false, reason: 'network' };
      return { ok: true, value: { input: next === 'input' ? SAMPLE : null } };
    }
    return basePost(path, body, options);
  }) as ChannelClient['post'];
  return {
    client,
    clock,
    claimCount: () => claimCount,
    now: () => clock.now,
    sleepFor: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.now += ms;
    }
  };
}

const CHANNEL_ENV = {
  OVERLORD_SESSION_CHANNEL_ID: 'chan-1',
  OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_test'
};

test('headless final Stop polls until an instruction arrives, then emits it at once', async () => {
  const fake = pollingClient(['empty', 'empty', 'input']);
  const result = await runAgentSessionInbox({
    agent: 'claude',
    payloadRaw: JSON.stringify({ hook_event_name: 'Stop', background_tasks: '[]' }),
    env: { ...CHANNEL_ENV, ...HEADLESS },
    client: fake.client,
    now: fake.now,
    sleepFor: fake.sleepFor
  });
  assert.equal(result.report, 'Delivered');
  assert.equal(result.stdout, encodeClaudeStopBlock(SAMPLE.body));
  assert.equal(fake.claimCount(), 3);
  assert.deepEqual(fake.clock.sleeps, [INBOX_POLL_INTERVAL_MS, INBOX_POLL_INTERVAL_MS]);
});

test('headless final Stop gives up empty at the wait bound', async () => {
  const fake = pollingClient(['empty']);
  const result = await runAgentSessionInbox({
    agent: 'claude',
    payloadRaw: JSON.stringify({ hook_event_name: 'Stop' }),
    env: { ...CHANNEL_ENV, ...HEADLESS },
    client: fake.client,
    now: fake.now,
    sleepFor: fake.sleepFor
  });
  assert.equal(result.report, 'Empty');
  assert.equal(result.stdout, '');
  assert.equal(fake.clock.now, CLAUDE_HEADLESS_STOP_WAIT_MS);
  assert.equal(fake.claimCount(), CLAUDE_HEADLESS_STOP_WAIT_MS / INBOX_POLL_INTERVAL_MS + 1);
});

test('interactive Stop claims once and answers at once', async () => {
  const fake = pollingClient(['empty']);
  const result = await runAgentSessionInbox({
    agent: 'claude',
    payloadRaw: JSON.stringify({ hook_event_name: 'Stop' }),
    env: { ...CHANNEL_ENV, ...INTERACTIVE },
    client: fake.client,
    now: fake.now,
    sleepFor: fake.sleepFor
  });
  assert.equal(result.report, 'Empty');
  assert.equal(fake.claimCount(), 1);
  assert.deepEqual(fake.clock.sleeps, []);
});

test('a failed claim ends the wait instead of retrying a broken channel', async () => {
  const fake = pollingClient(['empty', 'error', 'input']);
  const result = await runAgentSessionInbox({
    agent: 'claude',
    payloadRaw: JSON.stringify({ hook_event_name: 'Stop' }),
    env: { ...CHANNEL_ENV, ...HEADLESS },
    client: fake.client,
    now: fake.now,
    sleepFor: fake.sleepFor
  });
  assert.equal(result.report, 'Empty');
  assert.equal(fake.claimCount(), 2);
});
