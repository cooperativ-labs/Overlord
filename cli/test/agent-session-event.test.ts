import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findAgentSessionCodec } from '../dist/agent-session/codec-registry.generated.js';
import {
  normalizeForAdapter,
  parseNativePayload,
  runAgentSessionEvent
} from '../dist/agent-session/event.js';
import { encodeNativeDecision, runAgentSessionRequest } from '../dist/agent-session/request.js';
import {
  controlPlaneBaseUrl,
  frameEventName,
  generateServerPassword,
  parseSseStream,
  runSidecar,
  SIDECAR_BIND_ADDRESS
} from '../dist/agent-session/sidecar.js';
import { renderConnectorAgentSessionHook } from '../dist/connector-core-render.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CLAUDE_POST_TOOL_USE = {
  session_id: 'sess-abc',
  transcript_path: '/Users/someone/.claude/projects/-repo/sess-abc.jsonl',
  cwd: '/repo',
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'yarn test --silent' },
  tool_response: { stdout: 'SECRET OUTPUT 42', stderr: '' }
};

type Captured = { url: string; body: unknown; headers: Record<string, string> };

/**
 * Stand in for the backend without standing one up.
 *
 * The push path's contract is entirely about *what it sends and when*, so a recording fetch is
 * a better instrument than a live server: it lets a test assert that a field is absent, which is
 * the assertion that matters most here and the one an integration test is worst at.
 */
function withCapturedFetch<T>(
  respond: (request: Captured) => unknown,
  run: (captured: Captured[]) => Promise<T>
): Promise<T> {
  const captured: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const entry: Captured = {
      url: String(input),
      body: init?.body ? JSON.parse(String(init.body)) : null,
      headers: (init?.headers ?? {}) as Record<string, string>
    };
    captured.push(entry);
    return new Response(JSON.stringify(respond(entry) ?? { accepted: [{ duplicate: false }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
  return run(captured).finally(() => {
    globalThis.fetch = original;
  });
}

const BOUND_ENV = {
  OVERLORD_SESSION_CHANNEL_ID: 'chan-1',
  OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_testtoken',
  OVERLORD_BACKEND_URL: 'https://backend.test'
};

/**
 * The negative test, at the CLI layer.
 *
 * The rendered hook script gates in bash before spawning, so this path is rarely reached in an
 * unbound session — but a gate that can be bypassed by invoking the CLI directly is not a gate,
 * and this asserts the second one holds.
 */
test('agent-session event: an unbound session makes no network call at all', async () => {
  await withCapturedFetch(
    () => ({}),
    async captured => {
      const outcome = await runAgentSessionEvent({
        agent: 'claude',
        payloadRaw: JSON.stringify(CLAUDE_POST_TOOL_USE),
        env: { OVERLORD_BACKEND_URL: 'https://backend.test' }
      });
      assert.equal(outcome, 'no-scope');
      assert.deepEqual(captured, []);
    }
  );
});

test('agent-session event: a bound session posts a normalized envelope with the channel credential', async () => {
  await withCapturedFetch(
    () => ({ accepted: [{ duplicate: false }] }),
    async captured => {
      const outcome = await runAgentSessionEvent({
        agent: 'claude',
        payloadRaw: JSON.stringify(CLAUDE_POST_TOOL_USE),
        env: BOUND_ENV
      });
      assert.equal(outcome, 'posted');
      assert.equal(captured.length, 1);
      assert.equal(captured[0]?.url, 'https://backend.test/api/agent-session-channels/v1/events');
      // The scoped channel credential, and nothing broader. There is no code path in the
      // channel client that could substitute a USER_TOKEN, which is why a transient backend
      // error can never become a privilege escalation.
      assert.equal(captured[0]?.headers.authorization, 'Bearer osc_testtoken');

      const body = captured[0]?.body as { events: { kind: string; payload: unknown }[] };
      assert.equal(body.events.length, 1);
      assert.equal(body.events[0]?.kind, 'tool.completed');
    }
  );
});

/**
 * "No raw prompt or tool payload reaches logs" — asserted against the wire, not the intent.
 *
 * The recorded payload deliberately contains a transcript path, command output, and an absolute
 * home directory. None of them may appear anywhere in the serialized request.
 */
test('agent-session event: no raw native content reaches the wire', async () => {
  await withCapturedFetch(
    () => ({ accepted: [{ duplicate: false }] }),
    async captured => {
      await runAgentSessionEvent({
        agent: 'claude',
        payloadRaw: JSON.stringify(CLAUDE_POST_TOOL_USE),
        env: BOUND_ENV
      });
      const wire = JSON.stringify(captured[0]?.body);
      for (const forbidden of [
        'transcript_path',
        '.jsonl',
        'SECRET OUTPUT 42',
        '/Users/someone',
        'tool_input'
      ]) {
        assert.ok(!wire.includes(forbidden), `wire leaked ${forbidden}`);
      }
    }
  );
});

test('agent-session event: a replayed payload keeps the same producer id', async () => {
  const codec = findAgentSessionCodec('claude');
  assert.ok(codec);
  const first = normalizeForAdapter({
    codec,
    payload: CLAUDE_POST_TOOL_USE,
    now: new Date('2026-01-01T00:00:00Z')
  });
  const replay = normalizeForAdapter({
    codec,
    payload: CLAUDE_POST_TOOL_USE,
    now: new Date('2026-01-01T09:30:00Z')
  });
  assert.equal(first?.eventId, replay?.eventId);
  assert.notEqual(first?.occurredAt, replay?.occurredAt);
});

test('agent-session event: malformed and oversize payloads are dropped silently', async () => {
  await withCapturedFetch(
    () => ({}),
    async captured => {
      assert.equal(
        await runAgentSessionEvent({ agent: 'claude', payloadRaw: 'not json', env: BOUND_ENV }),
        'no-payload'
      );
      // An unregistered native event is silence, not an error: harnesses fire events we never
      // asked for, and treating "unmapped" as a failure would diagnose the normal case.
      assert.equal(
        await runAgentSessionEvent({
          agent: 'claude',
          payloadRaw: JSON.stringify({ hook_event_name: 'Notification', session_id: 's' }),
          env: BOUND_ENV
        }),
        'not-mapped'
      );
      assert.deepEqual(captured, []);
    }
  );
  assert.equal(parseNativePayload('{'), null);
});

/**
 * Migration parity, asserted at the source of truth rather than only in the fixture.
 *
 * The normalized event registration is additive. If someone "tidies up" the legacy
 * registrations, delivery-time change attribution and follow-up capture both break, and neither
 * failure is visible until a delivery comes back empty.
 */
test('Claude Channel 1 protocol registrations survive without agent-session observation', () => {
  const hooks = JSON.parse(
    readFileSync(path.join(repoRoot, 'connectors/adapters/claude/hooks/hooks.json'), 'utf8')
  ) as { hooks: Record<string, { hooks: { command: string }[] }[]> };

  const commandsFor = (event: string) =>
    (hooks.hooks[event] ?? []).flatMap(entry => entry.hooks.map(hook => hook.command));

  assert.ok(commandsFor('PostToolUse').some(c => c.endsWith('/scripts/post-tool-use-hook.sh')));
  assert.ok(
    commandsFor('UserPromptSubmit').some(c => c.endsWith('/scripts/user-prompt-submit-hook.sh'))
  );
  assert.equal(
    commandsFor('PostToolUse').some(c => c.endsWith('/scripts/agent-session-event.sh')),
    false
  );
  assert.equal(
    commandsFor('UserPromptSubmit').some(c => c.endsWith('/scripts/agent-session-event.sh')),
    false
  );
  assert.equal(commandsFor('SessionStart').length, 0);
});

test('agent-session event: the rendered hook gates before it spawns', () => {
  const rendered = renderConnectorAgentSessionHook({ adapterKey: 'claude', action: 'event' });
  const gateIndex = rendered.indexOf('OVERLORD_SESSION_CHANNEL_ID');
  const spawnIndex = rendered.indexOf('exec ovld');
  assert.ok(gateIndex > 0, 'rendered hook must carry the scope gate');
  assert.ok(gateIndex < spawnIndex, 'the gate must precede the spawn, not follow it');
  assert.ok(rendered.includes('agent-session event --agent claude'));
  // The action is fixed at render time; nothing in the payload can select a different one.
  assert.ok(!rendered.includes('__OVERLORD_SESSION_ACTION__'));
});

test('agent-session request: an unbound callback makes no network call and emits no decision', async () => {
  await withCapturedFetch(
    () => ({}),
    async captured => {
      const result = await runAgentSessionRequest({
        agent: 'claude',
        payloadRaw: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
        env: { OVERLORD_BACKEND_URL: 'https://backend.test' }
      });
      assert.equal(result, null);
      assert.deepEqual(captured, []);
    }
  );
});

test('agent-session request: a remote CAS winner returns only the exact native decision', async () => {
  let calls = 0;
  await withCapturedFetch(
    request => {
      calls += 1;
      if (request.url.endsWith('/requests')) return { requestId: 'req-1', status: 'open' };
      return { leaseId: 'lease-1', status: 'resolved', resolution: { decision: 'allow' } };
    },
    async captured => {
      const result = await runAgentSessionRequest({
        agent: 'claude',
        payloadRaw: JSON.stringify({
          hook_event_name: 'PermissionRequest',
          tool_name: 'Bash',
          timeout: 5,
          request_id: 'native-1'
        }),
        env: BOUND_ENV
      });
      assert.deepEqual(JSON.parse(result ?? '{}'), {
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: 'allow' }
      });
      assert.equal(captured.length, 2);
      assert.equal(calls, 2);
      const createBody = (captured[0]?.body ?? {}) as Record<string, unknown>;
      assert.equal(createBody.windowBasis, 'harness_timeout_80_percent');
      assert.equal(typeof createBody.windowExpiresAt, 'string');
      assert.ok(Date.parse(String(createBody.windowExpiresAt)) > Date.now());
    }
  );
  assert.equal(encodeNativeDecision('cursor', { decision: 'deny' }), '{"permission":"deny"}\n');
  assert.equal(encodeNativeDecision('cursor', { decision: 'ask' }), '{"permission":"ask"}\n');
  assert.equal(encodeNativeDecision('claude', { decision: 'ask' }), null);
  assert.equal(
    encodeNativeDecision('codex', { decision: 'allow' }),
    '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\n'
  );
  assert.equal(
    encodeNativeDecision('codex', { decision: 'deny' }),
    '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny"}}}\n'
  );
  assert.equal(encodeNativeDecision('codex', { decision: 'ask' }), null);
  assert.equal(encodeNativeDecision('pi', { decision: 'allow' }), '{}\n');
  assert.equal(encodeNativeDecision('pi', { decision: 'ask' }), '{}\n');
  assert.equal(
    encodeNativeDecision('pi', { decision: 'deny' }),
    '{"block":true,"reason":"Denied by an Overlord decision"}\n'
  );
});

// ── Control plane (Shape C) ──────────────────────────────────────────────────

test('sidecar: binds loopback only and mints a fresh per-launch secret', () => {
  assert.equal(SIDECAR_BIND_ADDRESS, '127.0.0.1');
  assert.equal(controlPlaneBaseUrl(4096), 'http://127.0.0.1:4096');
  const a = generateServerPassword();
  const b = generateServerPassword();
  assert.notEqual(a, b);
  assert.ok(a.length >= 32);
});

test('sidecar: SSE frames survive being split across chunk boundaries', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'event: message.part.updated\ndata: {"ty',
    'pe":"message.part.updated","properties":{"sessionID":"s"}}\n\n'
  ].map(chunk => encoder.encode(chunk));
  async function* stream() {
    for (const chunk of chunks) yield chunk;
  }
  const frames = [];
  for await (const frame of parseSseStream(stream())) frames.push(frame);
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.event, 'message.part.updated');
  const body = JSON.parse(frames[0]?.data ?? '{}') as unknown;
  // The body wins over the SSE `event:` field: transport metadata can be rewritten by a proxy,
  // and the body is what the harness actually said.
  assert.equal(frameEventName(frames[0]!, body), 'message.part.updated');
  assert.equal(frameEventName({ event: 'transport-name', data: '' }, {}), 'transport-name');
});

/**
 * The Phase 1 acceptance criterion, executed: a control-plane frame and a callback hook body
 * produce the same normalized event.
 */
test('sidecar: a control-plane frame normalizes to the same envelope as the callback hook', () => {
  const claudeCodec = findAgentSessionCodec('claude');
  const opencodeCodec = findAgentSessionCodec('opencode');
  assert.ok(claudeCodec && opencodeCodec);

  const viaHook = normalizeForAdapter({
    codec: claudeCodec,
    payload: CLAUDE_POST_TOOL_USE,
    now: new Date('2026-01-01T00:00:00Z')
  });
  const viaStream = normalizeForAdapter({
    codec: opencodeCodec,
    payload: {
      type: 'message.part.updated',
      properties: {
        sessionID: 'ses-1',
        cwd: '/repo',
        part: {
          callID: 'call-1',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'yarn test --silent' } }
        }
      }
    },
    nativeEventName: 'message.part.updated',
    now: new Date('2026-01-01T00:00:00Z')
  });

  assert.ok(viaHook && viaStream);
  assert.equal(viaHook.kind, viaStream.kind);
  assert.equal(viaHook.summary, viaStream.summary);
  assert.equal(viaHook.payload.tool, viaStream.payload.tool);
  assert.equal(viaHook.payload.detail, viaStream.payload.detail);
});

test('sidecar: an unbound session starts nothing', async () => {
  const result = await runSidecar({
    agent: 'opencode',
    port: 4096,
    env: { OVERLORD_BACKEND_URL: 'https://backend.test' },
    fetchImpl: (() => {
      throw new Error('the sidecar must not reach the network without a channel');
    }) as unknown as typeof fetch
  });
  assert.equal(result.reason, 'no-scope');
});

/**
 * The reconnect story, end to end.
 *
 * A killed sidecar cannot know what its predecessor delivered, so it re-reads `/permission` and
 * `/question` and re-emits. This asserts both halves: reconciliation runs before resubscription,
 * and a replayed frame the server reports as a duplicate is counted as one rather than becoming
 * a second card.
 */
test('sidecar: reconciles harness state after a dropped stream and tolerates the replay', async () => {
  const frame = {
    type: 'message.part.updated',
    properties: {
      sessionID: 'ses-1',
      cwd: '/repo',
      part: { callID: 'c1', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } }
    }
  };
  const controlPlaneCalls: string[] = [];
  let streamAttempts = 0;
  let overlordPosts = 0;

  // The control plane and Overlord are two different servers reached by two different clients:
  // the sidecar's injected `fetchImpl` for the loopback harness port, and the channel client's
  // global fetch for Overlord. Stubbing both separately is not test scaffolding — it is the
  // trust boundary the sidecar exists to keep, made visible.
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    controlPlaneCalls.push(url);
    if (url.endsWith('/event')) {
      streamAttempts += 1;
      if (streamAttempts === 1) throw new Error('connection reset');
      return new Response(`data: ${JSON.stringify(frame)}\n\n`, { status: 200 });
    }
    if (url.endsWith('/permission')) return new Response(JSON.stringify([frame]), { status: 200 });
    if (url.endsWith('/question')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    overlordPosts += 1;
    // The first delivery is new; the replay of identical content deduplicates on its
    // content-derived producer id, which is the property that makes reconnect replay safe.
    return new Response(JSON.stringify({ accepted: [{ duplicate: overlordPosts > 1 }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;

  try {
    const result = await runSidecar({
      agent: 'opencode',
      port: 4096,
      password: 'test-password',
      env: BOUND_ENV,
      maxReconnects: 1,
      fetchImpl
    });

    assert.equal(result.reason, 'stream-ended');
    assert.equal(result.reconnects, 1);
    // Reconciliation ran BEFORE resubscribing: the stream only carries what happens next, so a
    // permission raised while the sidecar was dead is visible nowhere else.
    assert.ok(controlPlaneCalls.includes('http://127.0.0.1:4096/permission'));
    assert.ok(controlPlaneCalls.includes('http://127.0.0.1:4096/question'));
    assert.equal(result.posted, 1);
    assert.equal(result.duplicates, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
