import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { hasAgentSessionScope, resolveAgentSessionScope } from '../dist/agent-session/bind.js';
import {
  readChannelCredential,
  removeChannelCredential,
  resolveChannelBootstrap,
  writeChannelCredential
} from '../dist/agent-session/channel.js';
import { decodeNativeRequest, encodeNativeDecision } from '../dist/agent-session/request.js';
import {
  connectorCoreAgentSessionAction,
  managedFileSourceExists,
  renderConnectorAgentSessionHook,
  resolveManagedFileContents
} from '../dist/connector-core-render.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function withTempHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ovld-channel-'));
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = home;
  try {
    return fn(home);
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
}

// ---- The scope gate ------------------------------------------------------
//
// The negative test the whole design hangs on: an unbound session must do
// nothing observable. These assert the *decision*; the adapter entry points
// that consume it land with their codecs in later phases.

test('an unbound session resolves no scope and performs no I/O', () => {
  withTempHome(home => {
    // A realistic unrelated session: a mission id in the environment (this
    // machine has run Overlord before) but no channel prepared for it.
    const env = { MISSION_ID: 'coo:1', OVERLORD_BACKEND_URL: 'http://127.0.0.1:9999' };

    assert.equal(hasAgentSessionScope(env), false);
    assert.equal(resolveAgentSessionScope({ agent: 'claude', missionId: 'coo:1', env }), null);

    // Nothing was created under the global data directory on behalf of a session
    // nobody asked us to observe.
    assert.deepEqual(readdirSync(home), []);
  });
});

test('a native session id alone is not a scope', () => {
  withTempHome(() => {
    // Possession of a harness session id confers nothing: anything that can read
    // a hook payload can read one.
    const env = {
      MISSION_ID: 'coo:1',
      CODEX_SESSION_ID: '11111111-2222-3333-4444-555555555555'
    };
    assert.equal(resolveAgentSessionScope({ agent: 'codex', missionId: 'coo:1', env }), null);
  });
});

test('a channel id without a credential is not a scope', () => {
  withTempHome(() => {
    // The id is not secret and is not authority. Without the credential — neither
    // in the environment nor in the owner-only cache — there is nothing to present.
    const env = { OVERLORD_SESSION_CHANNEL_ID: 'channel-1' };
    assert.equal(resolveChannelBootstrap(env), null);
    assert.equal(resolveAgentSessionScope({ agent: 'claude', env }), null);
  });
});

test('the environment credential wins, and the cache answers when it is absent', () => {
  withTempHome(() => {
    const fromEnv = resolveChannelBootstrap({
      OVERLORD_SESSION_CHANNEL_ID: 'channel-1',
      OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_from_env'
    });
    assert.equal(fromEnv?.token, 'osc_from_env');
    assert.equal(fromEnv?.source, 'env');

    // The terminal-window launch path cannot pass a token in the environment
    // without writing it into a checkout-local script, so it stages it here.
    writeChannelCredential({ channelId: 'channel-1', token: 'osc_from_cache' });
    const fromCache = resolveChannelBootstrap({ OVERLORD_SESSION_CHANNEL_ID: 'channel-1' });
    assert.equal(fromCache?.token, 'osc_from_cache');
    assert.equal(fromCache?.source, 'cache');
  });
});

test('the staged credential is owner-only and lives outside every checkout', () => {
  withTempHome(home => {
    writeChannelCredential({ channelId: 'channel-1', token: 'osc_secret' });

    const dir = path.join(home, 'agent-session-channels');
    const entries = readdirSync(dir);
    assert.equal(entries.length, 1);

    // 0600: a credential readable by other accounts on a shared machine is a
    // credential you have already shared.
    const mode = statSync(path.join(dir, entries[0])).mode & 0o777;
    assert.equal(mode, 0o600);

    // The filename is a hash, so the directory listing is not an enumerable map
    // of which channels this machine has run.
    assert.doesNotMatch(entries[0], /channel-1/);

    // And nothing was written into the repository.
    assert.doesNotMatch(path.join(dir, entries[0]), new RegExp(repoRoot));
  });
});

test('a credential is only returned for the channel it was written for', () => {
  withTempHome(() => {
    writeChannelCredential({ channelId: 'channel-1', token: 'osc_secret' });
    assert.equal(readChannelCredential('channel-1'), 'osc_secret');
    assert.equal(readChannelCredential('channel-2'), null);

    removeChannelCredential('channel-1');
    assert.equal(readChannelCredential('channel-1'), null);
  });
});

test('a bound session reports its channel and correlates the native id separately', () => {
  withTempHome(() => {
    const scope = resolveAgentSessionScope({
      agent: 'claude',
      missionId: 'coo:1',
      env: {
        OVERLORD_SESSION_CHANNEL_ID: 'channel-1',
        OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_secret'
      }
    });
    assert.equal(scope?.channelId, 'channel-1');
    assert.equal(scope?.token, 'osc_secret');
    // No native id has been cached for this (cwd, mission, agent) triple; the
    // scope is valid regardless, because the credential is the authority and the
    // native id is only correlation.
    assert.equal(scope?.nativeSessionId, null);
  });
});

// ---- The rendered shared hook -------------------------------------------

test('the shared hook renders with a fixed action and no payload-controlled dispatch', () => {
  const rendered = renderConnectorAgentSessionHook({ adapterKey: 'claude', action: 'event' });

  assert.match(rendered, /ovld agent-session event --agent claude --payload-file -/);
  // No substitution point may survive into an installed file.
  assert.doesNotMatch(rendered, /__OVERLORD_/);

  // The action is baked in, so an untrusted payload cannot select a CLI operation.
  // Assert against the executable lines only — the header comment discusses `$1`
  // precisely because it must never appear in the code.
  const executable = rendered
    .split('\n')
    .filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'));
  assert.deepEqual(executable, [
    // The scope gate comes FIRST, before `command -v` and before the spawn. An unbound session
    // must cost nothing observable, and the only version of that check which can prevent a
    // process launch is the one that runs before it.
    '[ -n "${OVERLORD_SESSION_CHANNEL_ID:-}" ] || exit 0',
    'command -v ovld >/dev/null 2>&1 || exit 0',
    'exec ovld agent-session event --agent claude --payload-file -'
  ]);
  // A missing `ovld` exits silently: for a decision hook that means "no decision",
  // which yields the harness's own prompt rather than a manufactured approval.
  assert.match(rendered, /command -v ovld .*\|\| exit 0/);

  const request = renderConnectorAgentSessionHook({ adapterKey: 'cursor', action: 'request' });
  assert.match(request, /ovld agent-session request --agent cursor --payload-file -/);
});

test('only the closed action set is recognized in a managed path', () => {
  assert.equal(connectorCoreAgentSessionAction('scripts/agent-session-event.sh'), 'event');
  assert.equal(connectorCoreAgentSessionAction('scripts/agent-session-request.sh'), 'request');
  assert.equal(connectorCoreAgentSessionAction('scripts/agent-session-inbox.sh'), 'inbox');
  // A manifest cannot invent a fourth action or escape the scripts directory.
  assert.equal(connectorCoreAgentSessionAction('scripts/agent-session-resolve.sh'), null);
  assert.equal(connectorCoreAgentSessionAction('scripts/agent-session-../evil.sh'), null);
  assert.equal(connectorCoreAgentSessionAction('scripts/overlord-mcp.mjs'), null);
});

test('an agent-session hook path resolves from connector core, not the adapter directory', () => {
  const sourceDir = path.join(repoRoot, 'connectors', 'adapters', 'claude');
  const relativePath = 'scripts/agent-session-event.sh';

  // The adapter ships no such file; the core renderer supplies it.
  assert.equal(managedFileSourceExists({ sourceDir, relativePath, adapterKey: 'claude' }), true);

  const contents = resolveManagedFileContents({
    sourceDir,
    relativePath,
    adapterKey: 'claude'
  }).toString('utf8');
  assert.match(contents, /agent-session event --agent claude/);
  assert.equal(
    contents,
    readFileSync(
      path.join(repoRoot, 'connectors', 'core', 'scripts', 'agent-session-hook.sh'),
      'utf8'
    )
      .replaceAll('__OVERLORD_ADAPTER_KEY__', 'claude')
      .replaceAll('__OVERLORD_SESSION_ACTION__', 'event')
  );
});

test('decision codecs are connector-owned, redact request cards, and emit exact native bytes', () => {
  const decoded = decodeNativeRequest('cursor', {
    event: 'beforeShellExecution',
    command: 'echo AKIAIOSFODNN7EXAMPLE',
    request_id: 'req-1',
    call_id: 'call-1',
    timeout: 45
  });
  assert.equal(decoded?.summary, 'Run a shell command: echo [redacted] [secret-adjacent]');
  assert.equal(decoded?.nativeRequestId, 'req-1');
  assert.equal(decoded?.harnessTimeoutSeconds, 45);
  assert.doesNotMatch(JSON.stringify(decoded), /AKIAIOSFODNN7EXAMPLE/);

  assert.equal(encodeNativeDecision('cursor', { decision: 'allow' }), '{"permission":"allow"}\n');
  assert.equal(
    encodeNativeDecision('claude', { decision: 'deny' }),
    '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":"deny"}}\n'
  );
  assert.equal(encodeNativeDecision('codex', { decision: 'ask' }), null);
  assert.equal(encodeNativeDecision('unknown', { decision: 'allow' }), null);
});
