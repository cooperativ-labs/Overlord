import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readChannelCredential } from '../src/agent-session/channel.ts';
import {
  findAttachTarget,
  waitForAttachTarget
} from '../src/agent-session/codex-app-server/attach.ts';
import {
  attachArgs,
  codexRemoteResumeArgs,
  codexThreadSettingsFromFlags,
  mintCodexLaunchChannel,
  preflightCodexAppServer,
  resolveCodexHarnessMode,
  supervisorArgs,
  supervisorEnv
} from '../src/agent-session/codex-app-server/launch.ts';
import { buildServerEnv } from '../src/agent-session/codex-app-server/server.ts';
import {
  type CodexSessionState,
  describeCodexHarnessSessions,
  listSessionStates,
  readSessionState,
  reapOrphanedSessions,
  SESSION_STATE_VERSION,
  stateFilePath,
  writeSessionState
} from '../src/agent-session/codex-app-server/state.ts';
import {
  addedTrustEntry,
  projectTrustLevel,
  removeImplicitTrustEntry,
  snapshotTrustEntries
} from '../src/agent-session/codex-app-server/trust.ts';
import { shouldRefuseInlineRunnerLaunch } from '../src/commands.ts';
import { buildLaunchPlan } from '../src/launch.ts';
import type { CliRuntime } from '../src/runtime.ts';

// ── mode resolution ───────────────────────────────────────────────────────────

test('harness mode: app-server only for codex, off unless chosen', () => {
  assert.equal(resolveCodexHarnessMode({ agent: 'codex', env: {} }), 'hooks');
  assert.equal(
    resolveCodexHarnessMode({ agent: 'codex', configuredMode: 'appServer', env: {} }),
    'appServer'
  );
  assert.equal(
    resolveCodexHarnessMode({ agent: 'codex', env: { OVERLORD_CODEX_APP_SERVER: '1' } }),
    'appServer'
  );
  assert.equal(
    resolveCodexHarnessMode({
      agent: 'codex',
      env: {},
      launchEnvVars: { OVERLORD_CODEX_APP_SERVER: '1' }
    }),
    'appServer',
    'a project can opt in through its launch env vars'
  );
  assert.equal(
    resolveCodexHarnessMode({ agent: 'codex', env: { OVERLORD_CODEX_APP_SERVER: 'true' } }),
    'hooks',
    'only an exact 1 turns the flag on'
  );
  assert.equal(
    resolveCodexHarnessMode({
      agent: 'claude',
      configuredMode: 'appServer',
      env: { OVERLORD_CODEX_APP_SERVER: '1' }
    }),
    'hooks'
  );
});

test('harness mode: an app-server runner launch needs no terminal', () => {
  const headless = { dryRun: false, terminalLauncher: null, stdoutIsTTY: false };
  assert.equal(shouldRefuseInlineRunnerLaunch(headless), true);
  assert.equal(shouldRefuseInlineRunnerLaunch({ ...headless, harnessMode: 'appServer' }), false);
});

// ── flags → thread settings ───────────────────────────────────────────────────

test('flags: approval and sandbox flags become thread settings; the rest are reported', () => {
  assert.deepEqual(codexThreadSettingsFromFlags([]), {
    approvalPolicy: null,
    sandbox: null,
    ignored: []
  });
  assert.deepEqual(
    codexThreadSettingsFromFlags([
      { name: '--ask-for-approval', value: 'untrusted' },
      { name: '--sandbox', value: 'read-only' },
      { name: '--search', value: null },
      { name: '-m', value: 'gpt-x' }
    ]),
    { approvalPolicy: 'untrusted', sandbox: 'read-only', ignored: ['--search'] }
  );
  assert.deepEqual(codexThreadSettingsFromFlags([{ name: '--full-auto', value: null }]), {
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    ignored: []
  });
  assert.deepEqual(
    codexThreadSettingsFromFlags([{ name: '--dangerously-bypass-approvals-and-sandbox' }]),
    { approvalPolicy: 'never', sandbox: 'danger-full-access', ignored: [] }
  );
  assert.deepEqual(codexThreadSettingsFromFlags([{ name: '-a', value: 'on-failure' }]), {
    approvalPolicy: 'on-request',
    sandbox: null,
    ignored: []
  });
  assert.deepEqual(codexThreadSettingsFromFlags([{ name: '--sandbox', value: 'bogus' }]), {
    approvalPolicy: null,
    sandbox: null,
    ignored: ['--sandbox bogus']
  });
});

test('argv: supervisor, attach and remote resume', () => {
  assert.deepEqual(
    supervisorArgs({
      contextFile: '/repo/.overlord/tmp/o.md',
      workingDirectory: '/repo',
      model: 'gpt-x',
      effort: 'high',
      settings: { approvalPolicy: 'untrusted', sandbox: 'workspace-write', ignored: [] },
      codexBin: '/opt/homebrew/bin/codex'
    }),
    [
      'agent-session',
      'sidecar',
      '--agent',
      'codex-app-server',
      '--prompt-file',
      '/repo/.overlord/tmp/o.md',
      '--working-directory',
      '/repo',
      '--model',
      'gpt-x',
      '--effort',
      'high',
      '--approval-policy',
      'untrusted',
      '--sandbox',
      'workspace-write',
      '--codex-bin',
      '/opt/homebrew/bin/codex'
    ]
  );
  assert.deepEqual(attachArgs('ch-1'), ['agent-session', 'attach', '--channel-id', 'ch-1']);
  assert.deepEqual(codexRemoteResumeArgs({ socketPath: '/h/.ovld/cx/a.sock', threadId: 't' }), [
    '--remote',
    'unix:///h/.ovld/cx/a.sock',
    'resume',
    't'
  ]);
});

test('env: the supervisor gets the flag but never the channel credential or a user token', () => {
  const env = supervisorEnv({
    PATH: '/bin',
    OVERLORD_SESSION_CHANNEL_ID: 'ch',
    OVERLORD_SESSION_CHANNEL_TOKEN: 'osc_secret',
    OVERLORD_USER_TOKEN: 'out_secret',
    OVLD_USER_TOKEN: 'out_secret',
    USER_TOKEN: 'out_secret'
  });
  assert.equal(env.OVERLORD_CODEX_APP_SERVER, '1');
  assert.equal(env.OVERLORD_SESSION_CHANNEL_ID, 'ch');
  assert.equal(env.OVERLORD_SESSION_CHANNEL_TOKEN, undefined);
  assert.ok(!JSON.stringify(env).includes('out_secret'), 'no user token in the supervisor env');
});

test('env: the app server may learn the backend and data dir, never a credential or scope', () => {
  const env = buildServerEnv({
    PATH: '/bin',
    OVERLORD_BACKEND_URL: 'http://127.0.0.1:4320',
    OVLD_HOME: '/h/.ovld',
    OVERLORD_USER_TOKEN: 'out_secret',
    OVERLORD_SESSION_CHANNEL_ID: 'ch',
    OVERLORD_OBJECTIVE_ID: 'coo:1.a'
  });
  assert.deepEqual(env, {
    PATH: '/bin',
    OVERLORD_BACKEND_URL: 'http://127.0.0.1:4320',
    OVLD_HOME: '/h/.ovld',
    OVERLORD_CONTROL_PLANE_SURFACE: 'codex-app-server'
  });
});

test('preflight: missing or old codex falls back with a reason', () => {
  assert.equal(preflightCodexAppServer(() => null).ok, false);
  const old = preflightCodexAppServer(() => ({ path: 'codex', version: '0.169.9' }));
  assert.equal(old.ok, false);
  assert.match(!old.ok ? old.warning : '', /0\.170\.0 or newer \(found 0\.169\.9\)/);
  assert.deepEqual(
    preflightCodexAppServer(() => ({ path: '/x/codex', version: '0.171.0' })),
    {
      ok: true,
      codex: { path: '/x/codex', version: '0.171.0' }
    }
  );
});

// ── launch plan ───────────────────────────────────────────────────────────────

type Posted = { path: string; body: unknown };

function runtime({
  posted,
  mint = () => ({ channelId: 'ch-minted', token: 'osc_minted_secret_0123', expiresAt: 'x' })
}: {
  posted: Posted[];
  mint?: () => unknown;
}): CliRuntime {
  return {
    backend: {
      baseUrl: 'http://127.0.0.1:4310',
      health: async () => ({ ok: true }),
      get: async <T>(requestPath: string): Promise<T> => {
        if (/^\/api\/missions\/[^/]+$/.test(requestPath)) {
          return {
            id: 'mission-uuid',
            displayId: 'coo:11',
            title: 'App server',
            objectives: [
              {
                id: 'objective-uuid',
                state: 'executing',
                instructionText: 'Ship it',
                displayId: 'coo:11.k7xm',
                title: 'Ship it'
              }
            ]
          } as T;
        }
        throw new Error(`Unexpected GET ${requestPath}`);
      },
      post: async <T>({ path: requestPath, body }: { path: string; body?: unknown }) => {
        posted.push({ path: requestPath, body });
        if (requestPath.endsWith('/session-channels')) return mint() as T;
        throw new Error(`Unexpected POST ${requestPath}`);
      },
      patch: async () => {
        throw new Error('Unexpected PATCH');
      },
      delete: async () => {
        throw new Error('Unexpected DELETE');
      }
    },
    close: () => {}
  } as unknown as CliRuntime;
}

const okPreflight = () => ({ ok: true as const, codex: { path: '/x/codex', version: '0.170.0' } });

test('plan: app-server mode mints a channel and attaches the terminal to the thread', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-cx-plan-'));
  const posted: Posted[] = [];
  const plan = await buildLaunchPlan({
    runtime: runtime({ posted }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      harnessMode: 'appServer',
      model: 'gpt-x',
      thinking: 'high',
      flags: [{ name: '--sandbox', value: 'read-only' }],
      preCommand: 'agp',
      preLaunchCommands: ['yarn install'],
      executionRequestId: 'req-1',
      executionTargetId: 'target-1',
      terminalLauncher: 'Terminal',
      codexPreflight: okPreflight,
      // This machine's own Codex must not decide whether the fixture model is valid.
      codexLiveModels: async () => null
    }
  });

  const mintCall = posted.find(call => call.path.endsWith('/session-channels'));
  assert.equal(mintCall?.path, '/api/objectives/coo%3A11.k7xm/session-channels');
  assert.deepEqual(
    { ...(mintCall?.body as Record<string, unknown>), adapterVersion: 'v' },
    {
      adapterKey: 'codex-app-server',
      adapterVersion: 'v',
      executionRequestId: 'req-1',
      executionTargetId: 'target-1'
    }
  );

  assert.equal(plan.controlPlane?.channelId, 'ch-minted');
  assert.deepEqual(plan.args.slice(-4), ['agent-session', 'attach', '--channel-id', 'ch-minted']);
  const supervisor = plan.controlPlane!.supervisor.args;
  assert.deepEqual(supervisor.slice(supervisor.indexOf('agent-session')).slice(0, 4), [
    'agent-session',
    'sidecar',
    '--agent',
    'codex-app-server'
  ]);
  assert.ok(supervisor.includes('--model') && supervisor.includes('gpt-x'));
  assert.ok(supervisor.includes('--sandbox') && supervisor.includes('read-only'));
  assert.ok(supervisor.includes('/x/codex'));
  assert.deepEqual(plan.controlPlane!.preLaunchCommands, ['yarn install']);
  assert.match(plan.harnessWarnings?.join('\n') ?? '', /ignores the pre-command `agp`/);

  // The id reaches the launch environment; the credential only the owner-only cache.
  assert.equal(plan.env.OVERLORD_SESSION_CHANNEL_ID, 'ch-minted');
  assert.equal(plan.env.OVERLORD_SESSION_LAUNCH_KIND, 'control_plane');
  assert.equal(readChannelCredential('ch-minted'), 'osc_minted_secret_0123');
  assert.ok(!JSON.stringify(plan).includes('osc_minted_secret_0123'));
  const scripts = readdirScripts(workingDirectory);
  assert.ok(scripts.length > 0, 'a terminal launch script is written');
  for (const script of scripts) {
    const text = readFileSync(script, 'utf8');
    assert.ok(!text.includes('osc_minted_secret_0123'), 'no credential in the launch script');
    assert.ok(!text.includes('yarn install'), 'pre-launch lines run before the supervisor');
    assert.ok(!text.includes('agp '), 'the pre-command does not wrap the attach');
    assert.match(text, /'?agent-session'? '?attach'? '?--channel-id'? '?ch-minted'?/);
  }
});

function readdirScripts(workingDirectory: string): string[] {
  const dir = path.join(workingDirectory, '.overlord', 'tmp');
  return readdirSync(dir)
    .filter(name => name.startsWith('launch-') && name.endsWith('.sh'))
    .map(name => path.join(dir, name));
}

test('plan: a dry run mints nothing and stages nothing', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-cx-dry-'));
  const posted: Posted[] = [];
  const plan = await buildLaunchPlan({
    runtime: runtime({ posted }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      harnessMode: 'appServer',
      dryRun: true,
      codexPreflight: okPreflight
    }
  });
  assert.equal(posted.filter(call => call.path.endsWith('/session-channels')).length, 0);
  assert.equal(plan.controlPlane?.channelId, null);
  assert.equal(plan.env.OVERLORD_SESSION_CHANNEL_ID, undefined);
});

test('plan: falls back to the terminal when codex is unsupported or minting fails', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-cx-fallback-'));
  const posted: Posted[] = [];
  const unsupported = await buildLaunchPlan({
    runtime: runtime({ posted }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      harnessMode: 'appServer',
      codexPreflight: () => ({ ok: false, warning: 'codex too old' })
    }
  });
  assert.equal(unsupported.controlPlane, null);
  assert.equal(unsupported.command, 'codex');
  assert.deepEqual(unsupported.harnessWarnings, ['codex too old']);
  assert.equal(
    posted.length,
    posted.filter(call => !call.path.endsWith('/session-channels')).length
  );

  const refused = await buildLaunchPlan({
    runtime: runtime({
      posted,
      mint: () => {
        throw new Error('404 Not Found');
      }
    }),
    options: {
      agent: 'codex',
      missionId: 'coo:11',
      workingDirectory,
      harnessMode: 'appServer',
      codexPreflight: okPreflight
    }
  });
  assert.equal(refused.controlPlane, null);
  assert.equal(refused.command, 'codex');
  assert.match(refused.harnessWarnings?.[0] ?? '', /Could not mint .*404 Not Found/);
  assert.equal(refused.env.OVERLORD_SESSION_CHANNEL_ID, undefined);
});

test('plan: hooks mode and other agents are unchanged', async () => {
  const workingDirectory = mkdtempSync(path.join('/tmp', 'ovld-cx-hooks-'));
  const posted: Posted[] = [];
  for (const options of [
    { agent: 'codex', harnessMode: 'hooks' as const },
    { agent: 'claude', harnessMode: 'appServer' as const }
  ]) {
    const plan = await buildLaunchPlan({
      runtime: runtime({ posted }),
      options: { ...options, missionId: 'coo:11', workingDirectory, codexPreflight: okPreflight }
    });
    assert.equal(plan.controlPlane, null);
    assert.equal(plan.command, options.agent);
    assert.deepEqual(plan.harnessWarnings, []);
  }
  assert.equal(posted.filter(call => call.path.endsWith('/session-channels')).length, 0);
});

test('mint: a response without a credential is an error', async () => {
  const posted: Posted[] = [];
  await assert.rejects(
    mintCodexLaunchChannel({
      backend: runtime({ posted, mint: () => ({ channelId: 'x' }) }).backend,
      objectiveRef: 'coo:11.k7xm',
      adapterVersion: '1'
    }),
    /no session channel/
  );
});

// ── session state, orphan reaping ─────────────────────────────────────────────

function state(overrides: Partial<CodexSessionState> = {}): CodexSessionState {
  return {
    version: SESSION_STATE_VERSION,
    channelId: 'ch-a',
    missionId: 'coo:11',
    objectiveId: 'coo:11.k7xm',
    cwd: '/repo',
    socketPath: null,
    threadId: null,
    supervisorPid: 999_999,
    serverPid: null,
    codexVersion: '0.170.0',
    trustEntryAdded: null,
    startedAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...overrides
  };
}

test('state: written owner-only, keyed by a hash of the channel id', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-state-'));
  try {
    writeSessionState(state(), home);
    const file = stateFilePath('ch-a', home);
    assert.ok(!path.basename(file).includes('ch-a'));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(readSessionState('ch-a', home)?.objectiveId, 'coo:11.k7xm');
    assert.equal(listSessionStates(home).length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('state: orphans are reaped only when their supervisor is gone', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-reap-'));
  try {
    const socket = path.join(home, '.ovld', 'cx', 'aa.sock');
    writeSessionState(
      state({
        channelId: 'dead',
        supervisorPid: 11,
        serverPid: 22,
        socketPath: socket,
        trustEntryAdded: '/repo'
      }),
      home
    );
    writeSessionState(state({ channelId: 'live', supervisorPid: 33, serverPid: 44 }), home);
    writeFileSync(socket, '');
    const killed: [number, string][] = [];
    const cleaned: string[] = [];
    const reaped = reapOrphanedSessions({
      home,
      isAlive: pid => pid === 33 || pid === 22 || pid === 44,
      isAppServer: () => true,
      kill: (pid, signal) => killed.push([pid, signal]),
      cleanup: entry => cleaned.push(entry.trustEntryAdded ?? '')
    });
    assert.deepEqual(reaped, [{ channelId: 'dead', killedServerPid: 22 }]);
    assert.deepEqual(killed, [[-22, 'SIGKILL']], 'the whole server process group');
    assert.deepEqual(cleaned, ['/repo']);
    assert.equal(existsSync(socket), false);
    assert.equal(readSessionState('dead', home), null);
    assert.ok(readSessionState('live', home));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('state: a reused pid that is not an app server is never killed', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-reuse-'));
  try {
    writeSessionState(state({ channelId: 'dead', supervisorPid: 11, serverPid: 22 }), home);
    const killed: number[] = [];
    reapOrphanedSessions({
      home,
      isAlive: pid => pid === 22,
      isAppServer: () => false,
      kill: pid => killed.push(pid)
    });
    assert.deepEqual(killed, []);
    assert.equal(readSessionState('dead', home), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ── folder trust ──────────────────────────────────────────────────────────────

test('trust: only the entry thread/start added, and only while it is bare, is removed', () => {
  const codexHome = mkdtempSync(path.join(os.tmpdir(), 'cx-trust-'));
  const repo = mkdtempSync(path.join(os.tmpdir(), 'cx-trust-repo-'));
  const env = { CODEX_HOME: codexHome };
  const config = path.join(codexHome, 'config.toml');
  try {
    writeFileSync(
      config,
      ['model = "m"', '', '[projects."/existing"]', 'trust_level = "trusted"', ''].join('\n')
    );
    const before = snapshotTrustEntries(repo, env);
    // What thread/start writes (LIVE on 0.170):
    writeFileSync(
      config,
      `${readFileSync(config, 'utf8')}\n[projects."${repo}"]\ntrust_level = "trusted"\n`
    );
    const added = addedTrustEntry(before, env);
    assert.equal(added, repo);
    assert.equal(projectTrustLevel('/existing', env), 'trusted');
    assert.equal(addedTrustEntry(snapshotTrustEntries('/existing', env), env), null);

    assert.equal(removeImplicitTrustEntry(added!, env), 'removed');
    const after = readFileSync(config, 'utf8');
    assert.ok(!after.includes(repo));
    assert.ok(after.includes('[projects."/existing"]'), 'other entries are untouched');
    assert.equal(removeImplicitTrustEntry(added!, env), 'absent');

    // A table someone has added to since is left alone.
    writeFileSync(config, `${after}\n[projects."${repo}"]\ntrust_level = "trusted"\nfoo = 1\n`);
    assert.equal(removeImplicitTrustEntry(repo, env), 'modified');
    writeFileSync(config, `${after}\n[projects."${repo}"]\ntrust_level = "untrusted"\n`);
    assert.equal(removeImplicitTrustEntry(repo, env), 'modified');
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('trust: a symlinked config keeps its link when an entry is removed', async () => {
  const { lstatSync, symlinkSync } = await import('node:fs');
  const codexHome = mkdtempSync(path.join(os.tmpdir(), 'cx-trust-link-'));
  const dotfiles = mkdtempSync(path.join(os.tmpdir(), 'cx-dotfiles-'));
  const env = { CODEX_HOME: codexHome };
  const target = path.join(dotfiles, 'config.toml');
  try {
    writeFileSync(
      target,
      ['model = "m"', '', '[projects."/wt"]', 'trust_level = "trusted"', ''].join('\n')
    );
    symlinkSync(target, path.join(codexHome, 'config.toml'));
    assert.equal(removeImplicitTrustEntry('/wt', env), 'removed');
    assert.ok(lstatSync(path.join(codexHome, 'config.toml')).isSymbolicLink(), 'link kept');
    assert.ok(!readFileSync(target, 'utf8').includes('/wt'), 'the target was edited');
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
    rmSync(dotfiles, { recursive: true, force: true });
  }
});

// ── terminal attach ───────────────────────────────────────────────────────────

test('attach: waits for the thread, refuses ended and ambiguous sessions', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-attach-'));
  try {
    mkdirSync(path.join(home, '.ovld', 'cx'), { recursive: true, mode: 0o700 });
    assert.equal(findAttachTarget({ channelId: 'ch-a', home }).ok, false);

    writeSessionState(state({ supervisorPid: process.pid }), home);
    const notReady = findAttachTarget({ channelId: 'ch-a', home });
    assert.equal(!notReady.ok && notReady.reason, 'not-ready');

    let polls = 0;
    const waited = await waitForAttachTarget({
      channelId: 'ch-a',
      home,
      waitMs: 10_000,
      sleep: async () => {
        polls += 1;
        writeSessionState(
          state({ supervisorPid: process.pid, socketPath: '/nonexistent/a.sock', threadId: 'thr' }),
          home
        );
      }
    });
    assert.equal(polls, 1);
    assert.ok(waited.ok);
    assert.equal(waited.ok && waited.target.threadId, 'thr');

    const byObjective = findAttachTarget({ objectiveId: 'k7xm', home });
    assert.ok(byObjective.ok, 'a short objective key matches');

    writeSessionState(state({ channelId: 'ch-b', supervisorPid: process.pid }), home);
    const ambiguous = findAttachTarget({ home });
    assert.equal(!ambiguous.ok && ambiguous.reason, 'ambiguous');

    writeSessionState(state({ channelId: 'ch-c', supervisorPid: 999_999 }), home);
    const ended = findAttachTarget({ channelId: 'ch-c', home, isAlive: () => false });
    assert.equal(!ended.ok && ended.reason, 'ended');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('doctor: reports which mode Codex sessions use, and reaps orphans', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'cx-doctor-'));
  try {
    assert.match(
      describeCodexHarnessSessions({ home }).detail,
      /no Codex app-server sessions running; Codex sessions on this machine use the hooks adapter/
    );
    writeSessionState(state({ supervisorPid: process.pid, threadId: 'thr-0123456789abc' }), home);
    writeSessionState(state({ channelId: 'orphan', supervisorPid: 999_999 }), home);
    const report = describeCodexHarnessSessions({ home });
    assert.equal(report.running, 1);
    assert.equal(report.reaped, 1);
    assert.match(report.detail, /coo:11\.k7xm: app-server \(codex 0\.170\.0/);
    assert.match(report.detail, /ovld agent-session attach --channel-id ch-a/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('transport: a socket in a directory another user could write is refused', async () => {
  const { assertOwnedSocketTarget } =
    await import('../dist/agent-session/codex-app-server/transport.js');
  const { chmodSync, mkdirSync: mkdir } = await import('node:fs');
  const net = await import('node:net');
  // Short base: macOS limits socket paths to 104 bytes.
  const base = mkdtempSync('/tmp/cx-own-');
  const dir = path.join(base, 'd');
  mkdir(dir, { mode: 0o700 });
  const sock = path.join(dir, 's.sock');
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(sock, resolve));
  try {
    assert.doesNotThrow(() => assertOwnedSocketTarget(sock));
    chmodSync(dir, 0o777);
    assert.throws(() => assertOwnedSocketTarget(sock), /not an owner-only socket/);
    chmodSync(dir, 0o720);
    assert.throws(() => assertOwnedSocketTarget(sock), /not an owner-only socket/);
  } finally {
    chmodSync(dir, 0o700);
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(base, { recursive: true, force: true });
  }
});
