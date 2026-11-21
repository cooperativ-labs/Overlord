/**
 * The Antigravity plugin's lifecycle hooks, end to end.
 *
 * Each test runs a shipped hook script from `connectors/adapters/antigravity/hooks/` the way agy
 * does — plugin folder as the working directory, the native camelCase payload on stdin — with an
 * `ovld` on PATH that is the real CLI talking to a stub backend. That pins the whole path: the
 * script's scope gate, the codec mapping of `PreInvocation` to a prompt, the per-invocation
 * prompt dedupe, and the exact Antigravity Stop answer.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

import { writeActiveSession } from '../src/active-objective-sessions.ts';
import {
  emitClaimedInput,
  encodeAntigravityInjectUserMessage,
  encodeAntigravityStopContinue,
  resolveInjectPath
} from '../src/agent-session/inbox.ts';
import {
  ANTIGRAVITY_HOOK_MIN_VERSION,
  antigravityHookVersionWarnings
} from '../src/antigravity-hooks.ts';
import { stopContinueOutput } from '../src/hook-event.ts';
import { writeCachedSessionKey } from '../src/session-key.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const cliEntry = path.join(repoRoot, 'cli', 'bin', 'ovld.mjs');
const adapterDir = path.join(repoRoot, 'connectors', 'adapters', 'antigravity');
const hooksDir = path.join(adapterDir, 'hooks');

const MISSION_ID = 'coo:910';
const OBJECTIVE_ID = 'coo:910.abcd';
const SESSION_KEY = 'sess_antigravity_hooks';
const CONVERSATION_ID = 'ec33ebf9-0cba-4100-8142-c61503f6c587';

type Payload = Record<string, unknown>;

// ---------------------------------------------------------------- stub backend

type Recorded = { path: string; body: Record<string, unknown> };

const backend = {
  server: null as Server | null,
  url: '',
  requests: [] as Recorded[],
  stopStatus: { needed: false, reason: null as string | null },
  input: null as null | { id: string; leaseId: string; body: string }
};

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function respond(pathname: string, body: Record<string, unknown>): unknown {
  if (pathname === '/api/protocol/hook-event') {
    const flags = (body.flags ?? {}) as Record<string, string>;
    if (flags['--hook-type'] === 'Stop') {
      return {
        eventId: null,
        objectiveId: 'objective-uuid',
        sessionId: 'session-uuid',
        deliveryStatus: backend.stopStatus
      };
    }
    return { eventId: 'event-uuid', objectiveId: 'objective-uuid', sessionId: 'session-uuid' };
  }
  const channel = '/api/agent-session-channels/v1';
  if (pathname === `${channel}/inputs/claim`) {
    const input = backend.input;
    backend.input = null;
    return { input };
  }
  if (pathname.endsWith('/emitted')) return { emitted: true };
  return {};
}

before(async () => {
  backend.server = createServer(async (request, response) => {
    const body = await readBody(request);
    const pathname = new URL(request.url ?? '/', 'http://stub').pathname;
    backend.requests.push({ path: pathname, body });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(respond(pathname, body)));
  });
  await new Promise<void>(resolve => backend.server?.listen(0, '127.0.0.1', resolve));
  backend.url = `http://127.0.0.1:${(backend.server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>(resolve => backend.server?.close(() => resolve()));
});

function resetBackend(): void {
  backend.requests = [];
  backend.stopStatus = { needed: false, reason: null };
  backend.input = null;
}

function hookEventBodies(): Array<{
  flags: Record<string, string>;
  fileInputs: Record<string, string>;
}> {
  return backend.requests
    .filter(r => r.path === '/api/protocol/hook-event')
    .map(r => r.body as { flags: Record<string, string>; fileInputs: Record<string, string> });
}

// ---------------------------------------------------------------- environment

type Scope = { home: string; workspace: string; pluginDir: string; binDir: string; spawn: string };

function makeScope(): Scope {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-agy-home-')));
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-agy-ws-')));
  // agy runs plugin hooks with the plugin folder as cwd, never the project.
  const pluginDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'ovld-agy-plugin-')));
  const binDir = mkdtempSync(path.join(tmpdir(), 'ovld-agy-bin-'));
  const spawnMarker = path.join(binDir, 'spawned');
  const ovldBin = path.join(binDir, 'ovld');
  writeFileSync(
    ovldBin,
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(spawnMarker)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliEntry)} "$@"\n`
  );
  chmodSync(ovldBin, 0o755);
  return { home, workspace, pluginDir, binDir, spawn: spawnMarker };
}

function seedAttach(scope: Scope): void {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = scope.home;
  try {
    writeCachedSessionKey({
      missionId: MISSION_ID,
      workingDirectory: scope.workspace,
      sessionKey: SESSION_KEY,
      objectiveId: OBJECTIVE_ID
    });
    writeActiveSession({
      workingDirectory: scope.workspace,
      missionId: MISSION_ID,
      objectiveId: OBJECTIVE_ID,
      objectiveAliases: [OBJECTIVE_ID],
      sessionKey: SESSION_KEY
    });
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

const STRIPPED_ENV =
  /^(OVERLORD_|OVLD_|MISSION_ID$|SESSION_KEY$|CLAUDE_CODE_SESSION_ID$|USER_TOKEN$|CLAUDE_PID$|CLAUDE_CODE_ENTRYPOINT$)/;

function hookEnv(scope: Scope, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!STRIPPED_ENV.test(key)) env[key] = value;
  }
  return {
    ...env,
    PATH: `${scope.binDir}:${env.PATH ?? ''}`,
    OVLD_HOME: scope.home,
    OVERLORD_BACKEND_URL: backend.url,
    OVERLORD_BACKEND_URL_DEV: backend.url,
    OVERLORD_USER_TOKEN: 'ovld_test_user_token',
    ...extra
  };
}

const launchEnv = {
  MISSION_ID,
  OVERLORD_MISSION_ID: MISSION_ID,
  OVERLORD_OBJECTIVE_ID: OBJECTIVE_ID
};

async function runHook(
  script: string,
  payload: Payload,
  { scope, env }: { scope: Scope; env: NodeJS.ProcessEnv }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn('/bin/bash', [path.join(hooksDir, script)], { cwd: scope.pluginDir, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => (stdout += data));
  child.stderr.on('data', data => (stderr += data));
  child.stdin.on('error', () => {
    // A gated hook exits before reading stdin; EPIPE is the expected outcome then.
  });
  child.stdin.end(JSON.stringify(payload));
  const code = await new Promise<number | null>(resolve => child.on('close', resolve));
  return { code, stdout, stderr };
}

function preInvocation(scope: Scope, prompt: string, invocationNum: number): Payload {
  return {
    hookEventName: 'PreInvocation',
    conversationId: CONVERSATION_ID,
    workspacePaths: [scope.workspace],
    cwd: scope.workspace,
    invocationNum,
    initialNumSteps: invocationNum * 2,
    lastUserInput: prompt,
    modelName: 'gemini-3.6-flash-medium'
  };
}

function stop(scope: Scope, extra: Payload = {}): Payload {
  return {
    hookEventName: 'Stop',
    conversationId: CONVERSATION_ID,
    workspacePaths: [scope.workspace],
    cwd: scope.workspace,
    executionNum: 1,
    terminationReason: 'model_stop',
    fullyIdle: true,
    continuation_active: false,
    ...extra
  };
}

// ---------------------------------------------------------------- PreInvocation

test('PreInvocation: one follow-up per distinct prompt, bound through the payload cwd', async () => {
  resetBackend();
  const scope = makeScope();
  seedAttach(scope);
  const env = hookEnv(scope, launchEnv);

  const first = await runHook('overlord-pre-invocation.sh', preInvocation(scope, 'Start', 0), {
    scope,
    env
  });
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, '{}\n');

  // The same prompt arrives again before every model call of the turn: no backend call.
  for (const invocation of [1, 2]) {
    const repeat = await runHook(
      'overlord-pre-invocation.sh',
      preInvocation(scope, 'Start', invocation),
      { scope, env }
    );
    assert.equal(repeat.stdout, '{}\n');
  }

  const next = await runHook(
    'overlord-pre-invocation.sh',
    preInvocation(scope, 'Also update the changelog', 3),
    { scope, env }
  );
  assert.equal(next.stdout, '{}\n');

  const bodies = hookEventBodies();
  assert.equal(bodies.length, 2, 'repeats of one prompt never reach the backend');
  assert.deepEqual(bodies[0]?.flags, {
    '--hook-type': 'UserPromptSubmit',
    '--mission-id': MISSION_ID,
    // Found through the payload cwd although the hook ran in the plugin folder.
    '--session-key': SESSION_KEY,
    '--external-session-id': CONVERSATION_ID,
    '--turn-index': '0'
  });
  assert.equal(bodies[0]?.fileInputs['--prompt-file'], 'Start');
  assert.equal(bodies[1]?.flags['--turn-index'], '1');
  assert.equal(bodies[1]?.fileInputs['--prompt-file'], 'Also update the changelog');
});

test('PreInvocation and Stop are silent and spawn nothing in an unbound session', async () => {
  resetBackend();
  const scope = makeScope();
  const env = hookEnv(scope);
  for (const [script, payload] of [
    ['overlord-pre-invocation.sh', preInvocation(scope, 'hello', 0)],
    ['overlord-stop.sh', stop(scope)]
  ] as const) {
    const result = await runHook(script, payload, { scope, env });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  assert.equal(existsSync(scope.spawn), false, 'no ovld process for an unbound session');
  assert.equal(backend.requests.length, 0);
});

// ---------------------------------------------------------------- Stop

test('Stop: the delivery reminder is Antigravity decision continue, once, and waits for idle', async () => {
  const reason = 'Objective coo:910.abcd is still executing and has not been delivered.';

  // Background work still running: no reminder and no backend call yet.
  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const scope = makeScope();
  seedAttach(scope);
  const env = hookEnv(scope, launchEnv);
  const busy = await runHook('overlord-stop.sh', stop(scope, { fullyIdle: false }), { scope, env });
  assert.equal(busy.stdout, '{}\n');
  assert.equal(backend.requests.length, 0);

  // A stop that already follows a continuation never continues again.
  const looping = await runHook('overlord-stop.sh', stop(scope, { continuation_active: true }), {
    scope,
    env
  });
  assert.equal(looping.stdout, '{}\n');
  assert.equal(backend.requests.length, 0);

  const needed = await runHook('overlord-stop.sh', stop(scope), { scope, env });
  assert.equal(needed.code, 0, needed.stderr);
  assert.deepEqual(JSON.parse(needed.stdout), {
    decision: 'continue',
    reason: `[Overlord] ${reason}`
  });
  assert.deepEqual(hookEventBodies()[0]?.flags, {
    '--hook-type': 'Stop',
    '--mission-id': MISSION_ID,
    '--session-key': SESSION_KEY,
    '--external-session-id': CONVERSATION_ID
  });

  // Once per session and objective.
  resetBackend();
  backend.stopStatus = { needed: true, reason };
  const again = await runHook('overlord-stop.sh', stop(scope), { scope, env });
  assert.equal(again.stdout, '{}\n');
  assert.equal(backend.requests.length, 0);
});

test('Stop: nothing needed answers {} so the agent stops', async () => {
  resetBackend();
  const scope = makeScope();
  seedAttach(scope);
  const result = await runHook('overlord-stop.sh', stop(scope), {
    scope,
    env: hookEnv(scope, launchEnv)
  });
  assert.equal(result.stdout, '{}\n');
  assert.equal(hookEventBodies().length, 1);
});

// ---------------------------------------------------------------- inbox

test('inbox: Antigravity Stop and PreInvocation resolve to their own inject paths', () => {
  assert.equal(
    resolveInjectPath({ agent: 'antigravity', payload: { hookEventName: 'Stop' } }),
    'antigravity-turn-boundary'
  );
  // Before agy 1.5.4 the payload names no event; only the Stop hook calls inbox then.
  assert.equal(
    resolveInjectPath({ agent: 'antigravity', payload: { conversationId: 'c' } }),
    'antigravity-turn-boundary'
  );
  assert.equal(
    resolveInjectPath({ agent: 'antigravity', payload: { hookEventName: 'PreInvocation' } }),
    'antigravity-next-invocation'
  );
  assert.equal(
    resolveInjectPath({ agent: 'antigravity', payload: { hookEventName: 'PostToolUse' } }),
    'unsupported'
  );
});

test('inbox: Antigravity emissions are the exact native bytes and report Delivered', async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = {
    post: async <T>(pathname: string, body: unknown) => {
      calls.push({ path: pathname, body });
      return { ok: true as const, value: { emitted: true } as T };
    }
  } as unknown as Parameters<typeof emitClaimedInput>[0]['client'];
  const input = {
    id: 'in-1',
    kind: 'instruction',
    body: 'Run the tests',
    leaseId: 'l-1',
    leaseExpiresAt: null
  };

  const atStop = await emitClaimedInput({
    agent: 'antigravity',
    path: 'antigravity-turn-boundary',
    input,
    client
  });
  assert.equal(atStop.report, 'Delivered');
  assert.equal(atStop.stdout, '{"decision":"continue","reason":"Run the tests"}\n');
  assert.equal(atStop.stdout, encodeAntigravityStopContinue('Run the tests'));

  const beforeModel = await emitClaimedInput({
    agent: 'antigravity',
    path: 'antigravity-next-invocation',
    input,
    client
  });
  assert.equal(beforeModel.report, 'Delivered');
  assert.equal(beforeModel.stdout, '{"injectSteps":[{"userMessage":"Run the tests"}]}\n');
  assert.equal(beforeModel.stdout, encodeAntigravityInjectUserMessage('Run the tests'));
  assert.deepEqual(
    calls.filter(call => call.path.endsWith('/emitted')).map(call => call.body),
    [
      { leaseId: 'l-1', deliveryOutcome: 'delivered' },
      { leaseId: 'l-1', deliveryOutcome: 'delivered' }
    ]
  );
});

test('Stop with a session channel injects the pending instruction instead of the reminder', async () => {
  resetBackend();
  backend.input = { id: 'input-1', leaseId: 'lease-1', body: 'Also update the changelog' };
  backend.stopStatus = { needed: true, reason: 'not delivered' };
  const scope = makeScope();
  seedAttach(scope);
  const result = await runHook('overlord-stop.sh', stop(scope), {
    scope,
    env: hookEnv(scope, {
      ...launchEnv,
      OVERLORD_SESSION_CHANNEL_ID: 'chan_agy',
      OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_agy_token'
    })
  });
  assert.equal(result.stdout, '{"decision":"continue","reason":"Also update the changelog"}\n');
  assert.equal(hookEventBodies().length, 0, 'the reminder is not requested');
});

// ---------------------------------------------------------------- dialect and setup

test('stopContinueOutput: Antigravity continues on "continue", Claude and Codex on "block"', () => {
  assert.deepEqual(stopContinueOutput('antigravity', 'r'), { decision: 'continue', reason: 'r' });
  assert.deepEqual(stopContinueOutput('claude', 'r'), { decision: 'block', reason: 'r' });
  assert.deepEqual(stopContinueOutput('codex', 'r'), { decision: 'block', reason: 'r' });
});

test('agy version floor: warn below 1.5.4, stay quiet at or above it or when unknown', () => {
  assert.equal(ANTIGRAVITY_HOOK_MIN_VERSION, '1.5.4');
  assert.equal(antigravityHookVersionWarnings('1.0.4').length, 1);
  assert.match(antigravityHookVersionWarnings('1.5.3')[0] ?? '', /agy update/);
  assert.deepEqual(antigravityHookVersionWarnings('1.5.4'), []);
  assert.deepEqual(antigravityHookVersionWarnings('1.10.0'), []);
  assert.deepEqual(antigravityHookVersionWarnings(null), []);
});

test('hooks.json registers the three shipped scripts and no PreToolUse decision hook', () => {
  const hooks = JSON.parse(readFileSync(path.join(adapterDir, 'hooks.json'), 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
  const group = hooks.overlord ?? {};
  assert.equal(group.enabled, true);
  assert.deepEqual(Object.keys(group).sort(), ['PostToolUse', 'PreInvocation', 'Stop', 'enabled']);
  const commands = JSON.stringify(group).match(/\.\/hooks\/[a-z-]+\.sh/g) ?? [];
  assert.deepEqual([...new Set(commands)].sort(), [
    './hooks/overlord-post-tool-use.sh',
    './hooks/overlord-pre-invocation.sh',
    './hooks/overlord-stop.sh'
  ]);
});
