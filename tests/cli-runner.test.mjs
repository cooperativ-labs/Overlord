import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLaunchArgs,
  buildRunnerTerminalOpenCommand,
  launchClaimedRequest,
  readOrCreateDeviceFingerprint,
  runnerTestHooks,
  runOnce
} from '../packages/overlord-cli/bin/_cli/runner.mjs';

test('buildLaunchArgs maps local claims into ovld launch arguments', () => {
  assert.deepEqual(
    buildLaunchArgs({
      ticketId: '1:42',
      agent: 'codex',
      workingDirectory: '/repo',
      launchMode: 'ask',
      model: 'gpt-5',
      thinking: 'high',
      flags: ['--verbose']
    }),
    [
      'launch',
      'codex',
      '--ticket-id',
      '1:42',
      '--working-directory',
      '/repo',
      '--launch-mode',
      'ask',
      '--model',
      'gpt-5',
      '--thinking',
      'high',
      '--flag',
      '--verbose'
    ]
  );
});

test('buildLaunchArgs includes ssh fields for remote claims', () => {
  assert.deepEqual(
    buildLaunchArgs({
      ticketId: '1:43',
      agent: 'claude',
      sshCommand: 'ssh dev@host',
      remoteWorkingDirectory: '/remote',
      serverMultiplexer: 'tmux',
      tmuxCommand: 'tmux new -s ovld'
    }),
    [
      'launch',
      'claude',
      '--ticket-id',
      '1:43',
      '--ssh-command',
      'ssh dev@host',
      '--remote-working-directory',
      '/remote',
      '--server-multiplexer',
      'tmux',
      '--tmux-command',
      'tmux new -s ovld'
    ]
  );
});

test('buildLaunchArgs includes feed post fields when present', () => {
  assert.deepEqual(
    buildLaunchArgs({
      ticketId: '1:44',
      agent: 'claude',
      feedPostId: 'post-uuid-123',
      initialQuestion: 'What does this mean?'
    }),
    [
      'launch',
      'claude',
      '--ticket-id',
      '1:44',
      '--feed-post-id',
      'post-uuid-123',
      '--initial-question',
      'What does this mean?'
    ]
  );
});

test('buildRunnerTerminalOpenCommand returns null without a runner terminal profile', () => {
  assert.equal(buildRunnerTerminalOpenCommand(null, 'ovld launch codex', 'darwin'), null);
});

test('buildRunnerTerminalOpenCommand maps web terminal profile to macOS Terminal', () => {
  const command = buildRunnerTerminalOpenCommand(
    {
      terminalApp: 'terminal',
      terminalLaunchMode: 'tab',
      terminalCustomHotkey: '',
      customTerminalApp: '',
      terminalTmuxHostApp: 'terminal',
      customTerminalTmuxHostApp: '',
      terminalTmuxCommand: 'tmux new-session bash {script}'
    },
    'ovld launch codex',
    'darwin'
  );
  assert.match(command, /^osascript /);
  assert.match(command, /Terminal/);
  assert.match(command, /ovld launch codex/);
});

test('buildRunnerTerminalOpenCommand maps tmux profile to a launch script', () => {
  const command = buildRunnerTerminalOpenCommand(
    {
      terminalApp: 'tmux',
      terminalLaunchMode: 'tab',
      terminalCustomHotkey: '',
      customTerminalApp: '',
      terminalTmuxHostApp: 'terminal',
      customTerminalTmuxHostApp: '',
      terminalTmuxCommand: 'tmux new-session bash {script}'
    },
    'ovld launch codex',
    'linux'
  );
  assert.match(command, /^tmux new-session bash '/);
  assert.match(command, /ovld-runner\/launch-/);
});

test('readOrCreateDeviceFingerprint reuses an explicit flag', () => {
  assert.equal(readOrCreateDeviceFingerprint({ 'device-fingerprint': 'fp-explicit' }), 'fp-explicit');
});

test('readOrCreateDeviceFingerprint reuses ~/.ovld/device.json when present', () => {
  const deviceFile = path.join(os.homedir(), '.ovld', 'device.json');
  const backup = fs.existsSync(deviceFile) ? fs.readFileSync(deviceFile) : null;

  try {
    fs.mkdirSync(path.dirname(deviceFile), { recursive: true });
    fs.writeFileSync(deviceFile, `${JSON.stringify({ deviceFingerprint: 'fp-saved' })}\n`, 'utf8');
    assert.equal(readOrCreateDeviceFingerprint({}), 'fp-saved');
  } finally {
    if (backup) fs.writeFileSync(deviceFile, backup);
    else if (fs.existsSync(deviceFile)) fs.rmSync(deviceFile);
  }
});

test('readOrCreateDeviceFingerprint persists a generated fingerprint when absent', () => {
  const deviceFile = path.join(os.homedir(), '.ovld', 'device.json');
  const backup = fs.existsSync(deviceFile) ? fs.readFileSync(deviceFile) : null;

  try {
    if (fs.existsSync(deviceFile)) fs.rmSync(deviceFile);
    const generated = readOrCreateDeviceFingerprint({});
    const saved = JSON.parse(fs.readFileSync(deviceFile, 'utf8'));
    assert.equal(saved.deviceFingerprint, generated);
    assert.match(generated, /^[0-9a-f-]{36}$/i);
  } finally {
    if (backup) {
      fs.mkdirSync(path.dirname(deviceFile), { recursive: true });
      fs.writeFileSync(deviceFile, backup);
    } else if (fs.existsSync(deviceFile)) {
      fs.rmSync(deviceFile);
    }
  }
});

test('runOnce exits cleanly when claim-execution returns no request', async () => {
  runnerTestHooks.execFileSync = () => JSON.stringify({ request: null });
  try {
    await assert.equal(await runOnce({}, 'fp-test'), false);
  } finally {
    runnerTestHooks.execFileSync = null;
  }
});

test('runOnce polls every organization the user belongs to', async () => {
  const claimedOrgs = [];
  runnerTestHooks.execFileSync = (_file, argv) => {
    const subcommand = argv[2];
    if (subcommand === 'list-organizations') {
      return JSON.stringify({ organizations: [{ id: 1, name: 'Org A' }, { id: 7, name: 'Org B' }] });
    }
    if (subcommand === 'claim-execution') {
      const idx = argv.indexOf('--organization-id');
      claimedOrgs.push(idx === -1 ? null : argv[idx + 1]);
      return JSON.stringify({ request: null });
    }
    return '{}';
  };
  try {
    assert.equal(await runOnce({}, 'fp-multi'), false);
    // Every organization is claimed from, each scoped by its own org id.
    assert.deepEqual(claimedOrgs, ['1', '7']);
  } finally {
    runnerTestHooks.execFileSync = null;
  }
});

test('runOnce honors an explicit --organization-id pin without discovery', async () => {
  const subcommands = [];
  let pinnedOrg = null;
  runnerTestHooks.execFileSync = (_file, argv) => {
    subcommands.push(argv[2]);
    if (argv[2] === 'claim-execution') {
      const idx = argv.indexOf('--organization-id');
      pinnedOrg = idx === -1 ? null : argv[idx + 1];
    }
    return JSON.stringify({ request: null });
  };
  try {
    assert.equal(await runOnce({ 'organization-id': '7' }, 'fp-pin'), false);
    assert.equal(pinnedOrg, '7');
    // A pinned org must never trigger organization discovery.
    assert.ok(!subcommands.includes('list-organizations'));
  } finally {
    runnerTestHooks.execFileSync = null;
  }
});

test('launchClaimedRequest completes launch (server marks the request launching) on spawn', async () => {
  const protocolCalls = [];
  runnerTestHooks.execFileSync = (_file, argv) => {
    protocolCalls.push(argv[2]);
    return '{}';
  };
  runnerTestHooks.spawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('spawn'));
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  try {
    await launchClaimedRequest(
      {
        request: { id: 'req-launch' },
        launch: {
          ticketId: '1:50',
          agent: 'cursor',
          workingDirectory: '/repo',
          launchMode: 'run',
          flags: []
        }
      },
      'fp-launch'
    );
    assert.deepEqual(protocolCalls, ['complete-execution-launch']);
  } finally {
    runnerTestHooks.execFileSync = null;
    runnerTestHooks.spawn = null;
    runnerTestHooks.platform = null;
  }
});

test('launchClaimedRequest completes terminal-profile launches after opener exits', async () => {
  const protocolCalls = [];
  runnerTestHooks.platform = 'darwin';
  runnerTestHooks.execFileSync = (_file, argv) => {
    protocolCalls.push(argv[2]);
    return '{}';
  };
  runnerTestHooks.spawn = (_file, argv) => {
    assert.equal(_file, 'sh');
    assert.deepEqual(argv.slice(0, 1), ['-lc']);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('spawn'));
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  try {
    await launchClaimedRequest(
      {
        request: { id: 'req-terminal-launch' },
        launch: {
          ticketId: '1:53',
          agent: 'codex',
          runnerTerminalProfile: {
            terminalApp: 'terminal',
            terminalLaunchMode: 'tab',
            terminalCustomHotkey: '',
            customTerminalApp: '',
            terminalTmuxHostApp: 'terminal',
            customTerminalTmuxHostApp: '',
            terminalTmuxCommand: 'tmux new-session bash {script}'
          },
          flags: []
        }
      },
      'fp-terminal'
    );
    assert.deepEqual(protocolCalls, ['complete-execution-launch']);
  } finally {
    runnerTestHooks.execFileSync = null;
    runnerTestHooks.spawn = null;
    runnerTestHooks.platform = null;
  }
});

test('launchClaimedRequest marks failure when the child emits error', async () => {
  const protocolCalls = [];
  runnerTestHooks.execFileSync = (_file, argv) => {
    protocolCalls.push(argv[2]);
    return '{}';
  };
  runnerTestHooks.spawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')));
    return child;
  };

  try {
    await assert.rejects(
      () =>
        launchClaimedRequest(
          {
            request: { id: 'req-fail' },
            launch: { ticketId: '1:51', agent: 'claude', flags: [] }
          },
          'fp-fail'
        ),
      /spawn ENOENT/
    );
    assert.deepEqual(protocolCalls, ['fail-execution-launch']);
  } finally {
    runnerTestHooks.execFileSync = null;
    runnerTestHooks.spawn = null;
  }
});

test('launchClaimedRequest still resolves when complete-execution-launch fails after spawn', async () => {
  runnerTestHooks.execFileSync = (_file, args) => {
    if (args[1] === 'complete-execution-launch') {
      throw new Error('protocol unavailable');
    }
    return '{}';
  };
  runnerTestHooks.spawn = () => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('spawn'));
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };

  try {
    await launchClaimedRequest(
      {
        request: { id: 'req-complete-fail' },
        launch: { ticketId: '1:52', agent: 'claude', flags: [] }
      },
      'fp-complete-fail'
    );
  } finally {
    runnerTestHooks.execFileSync = null;
    runnerTestHooks.spawn = null;
  }
});
