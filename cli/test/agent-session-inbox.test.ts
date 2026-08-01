import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChannelClient } from '../dist/agent-session/client.js';
import {
  type ClaimedInput,
  emitClaimedInput,
  encodeClaudeStopBlock,
  encodeCodexStopBlock,
  encodeCursorFollowup,
  resolveInjectPath
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
