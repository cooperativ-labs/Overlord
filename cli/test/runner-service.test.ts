import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyPollJitter,
  buildRunnerServiceEnv,
  captureRunnerSupervisorIdentity,
  composeRunnerServicePath,
  emptyRunnerServiceState,
  FALLBACK_POLL_INTERVAL_MS,
  inspectInstalledLaunchdPlist,
  LAUNCHD_LABEL,
  LAUNCHD_PROCESS_TYPE,
  LaunchdManager,
  parseLaunchdEnvPath,
  parseLaunchdProcessType,
  patchRunnerServiceState,
  planLaunchdLoadCommands,
  planLaunchdUnloadCommands,
  readRunnerExecutableFileIdentity,
  readRunnerServiceState,
  renderLaunchdPlist,
  renderSystemdUnit,
  resolveOverlordAppInvocation,
  resolveOvldInvocation,
  resolveRunnerEntryScript,
  resolveServiceManager,
  runnerServiceReinstallHint,
  shouldRestartRunnerSupervisor,
  writeRunnerServiceState
} from '../src/runner-service.ts';

test('runner supervisor identity detects replaced or removed executable files', () => {
  const initial = {
    program: { dev: 1, ino: 10, mtimeMs: 100 },
    entryScript: { dev: 1, ino: 11, mtimeMs: 100 }
  };
  assert.equal(shouldRestartRunnerSupervisor({ initial, current: initial }), false);
  assert.equal(
    shouldRestartRunnerSupervisor({
      initial,
      current: { ...initial, program: { ...initial.program, ino: 12 } }
    }),
    true
  );
  assert.equal(
    shouldRestartRunnerSupervisor({
      initial,
      current: { ...initial, entryScript: { ...initial.entryScript, mtimeMs: 101 } }
    }),
    true
  );
  assert.equal(
    shouldRestartRunnerSupervisor({ initial, current: { ...initial, entryScript: null } }),
    true
  );
});

test('runner supervisor identity ignores transient stat failures', () => {
  const initial = {
    program: { dev: 1, ino: 10, mtimeMs: 100 },
    entryScript: { dev: 1, ino: 11, mtimeMs: 100 }
  };
  assert.equal(
    shouldRestartRunnerSupervisor({
      initial,
      current: { program: undefined, entryScript: undefined }
    }),
    false
  );
  assert.equal(
    shouldRestartRunnerSupervisor({
      initial: { program: undefined, entryScript: undefined },
      current: initial
    }),
    false
  );
});

test('runner supervisor identity resolves the entry script and records stat fields', () => {
  assert.equal(
    resolveRunnerEntryScript(['node', 'cli/bin/ovld.mjs']),
    path.resolve('cli/bin/ovld.mjs')
  );
  assert.equal(resolveRunnerEntryScript(['node']), null);
  const identity = captureRunnerSupervisorIdentity({
    execPath: '/program',
    entryScript: '/entry',
    stat: filePath =>
      filePath === '/program' ? { dev: 1, ino: 2, mtimeMs: 3 } : { dev: 4, ino: 5, mtimeMs: 6 }
  });
  assert.deepEqual(identity, {
    program: { dev: 1, ino: 2, mtimeMs: 3 },
    entryScript: { dev: 4, ino: 5, mtimeMs: 6 }
  });
});

test('runner executable identity distinguishes removal from transient stat errors', () => {
  const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
  const inaccessible = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  assert.equal(
    readRunnerExecutableFileIdentity('/gone', () => {
      throw missing;
    }),
    null
  );
  assert.equal(
    readRunnerExecutableFileIdentity('/inaccessible', () => {
      throw inaccessible;
    }),
    undefined
  );
});

test('applyPollJitter stays within +/-10 percent of the base interval', () => {
  for (const random of [() => 0, () => 1, () => 0.5, () => 0.25]) {
    const jittered = applyPollJitter(FALLBACK_POLL_INTERVAL_MS, random);
    assert.ok(jittered >= 4500 && jittered <= 5500, `jittered=${jittered} out of range`);
  }
});

test('resolveOvldInvocation prefers an explicit override, otherwise re-runs the entry', () => {
  const prior = process.env.OVLD_RUNNER_EXEC;
  try {
    process.env.OVLD_RUNNER_EXEC = '/usr/local/bin/ovld';
    assert.deepEqual(resolveOvldInvocation(['node', 'cli.js'], '/node'), {
      program: '/usr/local/bin/ovld',
      args: ['runner', 'supervise']
    });
    delete process.env.OVLD_RUNNER_EXEC;
    const resolved = resolveOvldInvocation(['/node', '/opt/app/cli/dist/index.js'], '/node');
    const appInvocation = resolveOverlordAppInvocation();
    if (appInvocation) {
      assert.deepEqual(resolved, {
        program: appInvocation.program,
        args: appInvocation.args,
        runAsElectronNode: true
      });
    } else {
      assert.equal(resolved.program, '/node');
      assert.deepEqual(resolved.args, ['/opt/app/cli/dist/index.js', 'runner', 'supervise']);
    }
  } finally {
    if (prior === undefined) delete process.env.OVLD_RUNNER_EXEC;
    else process.env.OVLD_RUNNER_EXEC = prior;
  }
});

test('resolveOverlordAppInvocation finds the installed app binary + CLI on macOS', () => {
  const home = '/Users/tester';
  const appDir = `${home}/Applications/Overlord.app`;
  const program = `${appDir}/Contents/MacOS/Overlord`;
  const script = `${appDir}/Contents/Resources/cli/bin/ovld.mjs`;
  const present = new Set([program, script]);
  const resolved = resolveOverlordAppInvocation({
    platform: 'darwin',
    homedir: home,
    exists: (candidate: string) => present.has(candidate)
  });
  assert.deepEqual(resolved, {
    program,
    args: [script, 'runner', 'supervise'],
    runAsElectronNode: true
  });
});

test('resolveOverlordAppInvocation returns null off macOS or when the app is absent', () => {
  assert.equal(resolveOverlordAppInvocation({ platform: 'linux', exists: () => true }), null);
  assert.equal(resolveOverlordAppInvocation({ platform: 'darwin', exists: () => false }), null);
});

test('resolveOvldInvocation keeps the Electron binary when the installer runs as Node', () => {
  const priorExec = process.env.OVLD_RUNNER_EXEC;
  const priorElectron = process.env.ELECTRON_RUN_AS_NODE;
  try {
    delete process.env.OVLD_RUNNER_EXEC;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    const resolved = resolveOvldInvocation(
      ['/App/Contents/MacOS/Overlord', '/App/Contents/Resources/cli/bin/ovld.mjs'],
      '/App/Contents/MacOS/Overlord'
    );
    assert.equal(resolved.program, '/App/Contents/MacOS/Overlord');
    assert.equal(resolved.runAsElectronNode, true);
  } finally {
    if (priorExec === undefined) delete process.env.OVLD_RUNNER_EXEC;
    else process.env.OVLD_RUNNER_EXEC = priorExec;
    if (priorElectron === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = priorElectron;
  }
});

test('buildRunnerServiceEnv forwards ELECTRON_RUN_AS_NODE for app-binary invocations', () => {
  const prior = process.env.ELECTRON_RUN_AS_NODE;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    assert.equal(
      buildRunnerServiceEnv({ backendUrl: 'https://api.example.test', runAsElectronNode: true })
        .ELECTRON_RUN_AS_NODE,
      '1'
    );
  } finally {
    if (prior === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = prior;
  }
});

test('buildRunnerServiceEnv captures a remote backend URL and a non-empty PATH', () => {
  const env = buildRunnerServiceEnv({ backendUrl: 'https://api.example.test' });
  assert.equal(env.OVERLORD_BACKEND_URL, 'https://api.example.test');
  assert.ok(env.PATH && env.PATH.length > 0);
});

test('composeRunnerServicePath uses a fixed prefix plus system dirs, not the installer PATH', () => {
  const composed = composeRunnerServicePath({ homeDir: '/Users/tester' });
  assert.equal(
    composed,
    '/opt/homebrew/bin:/usr/local/bin:/Users/tester/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
  );
  assert.ok(composed.split(':').includes('/usr/bin'), 'osascript lives in /usr/bin');
  assert.ok(!composed.includes('nvm'));
  assert.ok(!composed.includes('.nvm'));
});

test('buildRunnerServiceEnv uses the composed PATH rather than process.env.PATH', () => {
  const prior = process.env.PATH;
  try {
    process.env.PATH = '/tmp/nvm/versions/node/v22/bin:/usr/bin';
    const env = buildRunnerServiceEnv({
      backendUrl: 'https://api.example.test',
      homeDir: '/Users/tester'
    });
    assert.equal(env.PATH, composeRunnerServicePath({ homeDir: '/Users/tester' }));
    assert.ok(!env.PATH?.includes('nvm'));
  } finally {
    if (prior === undefined) delete process.env.PATH;
    else process.env.PATH = prior;
  }
});

test('buildRunnerServiceEnv follows overlord.toml instead of pinning a loopback backend URL', () => {
  const env = buildRunnerServiceEnv({ backendUrl: 'http://127.0.0.1:4310' });
  assert.equal(env.OVERLORD_BACKEND_URL, undefined);
  assert.ok(env.PATH && env.PATH.length > 0);
});

test('buildRunnerServiceEnv forwards ELECTRON_RUN_AS_NODE only when the installer runs under it', () => {
  const prior = process.env.ELECTRON_RUN_AS_NODE;
  try {
    delete process.env.ELECTRON_RUN_AS_NODE;
    assert.equal(
      buildRunnerServiceEnv({ backendUrl: 'https://api.example.test' }).ELECTRON_RUN_AS_NODE,
      undefined
    );
    process.env.ELECTRON_RUN_AS_NODE = '1';
    assert.equal(
      buildRunnerServiceEnv({ backendUrl: 'https://api.example.test' }).ELECTRON_RUN_AS_NODE,
      '1'
    );
  } finally {
    if (prior === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
    else process.env.ELECTRON_RUN_AS_NODE = prior;
  }
});

test('renderLaunchdPlist embeds the label, program args, and env, and escapes XML', () => {
  const plist = renderLaunchdPlist({
    label: LAUNCHD_LABEL,
    invocation: { program: '/node', args: ['/cli.js', 'runner', 'supervise'] },
    env: { OVERLORD_BACKEND_URL: 'https://api.example.test?a=1&b=2' },
    logDir: '/home/user/.ovld/logs'
  });
  assert.match(plist, /<key>Label<\/key>\s*<string>io\.overlord\.runner<\/string>/);
  assert.match(plist, /<string>runner<\/string>/);
  assert.match(plist, /<string>supervise<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Interactive<\/string>/);
  assert.equal(parseLaunchdProcessType(plist), LAUNCHD_PROCESS_TYPE);
  assert.ok(!plist.includes('<string>Background</string>'));
  assert.ok(!plist.includes('<string>Adaptive</string>'));
  // The `&` in the URL must be XML-escaped.
  assert.ok(plist.includes('a=1&amp;b=2'));
  assert.ok(!plist.includes('a=1&b=2'));
});

test('renderSystemdUnit emits an absolute ExecStart with Restart and env lines', () => {
  const unit = renderSystemdUnit({
    invocation: { program: '/usr/bin/node', args: ['/cli.js', 'runner', 'supervise'] },
    env: { OVERLORD_BACKEND_URL: 'https://api.example.test', PATH: '/usr/bin' }
  });
  assert.match(unit, /ExecStart=\/usr\/bin\/node \/cli\.js runner supervise/);
  assert.match(unit, /Restart=always/);
  assert.match(unit, /Environment=OVERLORD_BACKEND_URL=https:\/\/api\.example\.test/);
  assert.match(unit, /WantedBy=default\.target/);
  assert.ok(!unit.includes('Nice='));
  assert.ok(!unit.includes('CPUSchedulingPolicy'));
});

test('resolveServiceManager maps platforms and returns null for unsupported ones', () => {
  assert.equal(resolveServiceManager('darwin')?.kind, 'launchd');
  assert.equal(resolveServiceManager('linux')?.kind, 'systemd');
  assert.equal(resolveServiceManager('win32'), null);
});

test('runner service state round-trips and merges via patch', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-runner-state-'));
  try {
    assert.deepEqual(readRunnerServiceState(dir), emptyRunnerServiceState());
    writeRunnerServiceState(
      { ...emptyRunnerServiceState(), backendUrl: 'https://api.example.test' },
      dir
    );
    assert.equal(readRunnerServiceState(dir).backendUrl, 'https://api.example.test');
    const merged = patchRunnerServiceState({ lastLaunchedAt: '2026-07-09T00:00:00.000Z' }, dir);
    assert.equal(merged.backendUrl, 'https://api.example.test');
    assert.equal(merged.lastLaunchedAt, '2026-07-09T00:00:00.000Z');
    assert.equal(readRunnerServiceState(dir).lastLaunchedAt, '2026-07-09T00:00:00.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planLaunchdUnloadCommands boots the label out and tolerates a not-loaded label', () => {
  const steps = planLaunchdUnloadCommands({ uid: 501 });
  assert.deepEqual(
    steps.map(step => step.args),
    [['bootout', `gui/501/${LAUNCHD_LABEL}`]]
  );
  assert.equal(steps[0].tolerateFailure, true);
});

test('planLaunchdLoadCommands re-reads the plist from disk instead of kickstarting in memory', () => {
  const steps = planLaunchdLoadCommands({
    uid: 501,
    plistPath: '/plists/io.overlord.runner.plist'
  });
  assert.deepEqual(
    steps.map(step => step.args),
    [
      ['enable', `gui/501/${LAUNCHD_LABEL}`],
      ['bootstrap', 'gui/501', '/plists/io.overlord.runner.plist'],
      ['kickstart', `gui/501/${LAUNCHD_LABEL}`]
    ]
  );
  // `bootstrap` may legitimately fail when the label is already loaded, but the
  // trailing `kickstart` must surface a genuinely broken definition.
  assert.deepEqual(
    steps.map(step => step.tolerateFailure),
    [true, true, false]
  );
  // `kickstart -k` would restart launchd's in-memory definition and ignore the
  // freshly written plist, which is exactly the bug this sequence replaces.
  assert.ok(!steps.some(step => step.args.includes('-k')));
});

function recordingLaunchd(behavior: (args: string[]) => void = () => {}): {
  manager: LaunchdManager;
  calls: string[][];
} {
  const calls: string[][] = [];
  const manager = new LaunchdManager(async args => {
    calls.push(args);
    behavior(args);
    return { stdout: '' };
  });
  return { manager, calls };
}

test('launchd install boots out an already-loaded label before writing and loading the plist', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-launchd-install-'));
  const priorHome = process.env.HOME;
  const priorDataDir = process.env.OVLD_HOME;
  try {
    process.env.HOME = dir;
    process.env.OVLD_HOME = path.join(dir, '.ovld');
    const { manager, calls } = recordingLaunchd();
    await manager.install({
      invocation: { program: '/node', args: ['/cli.js', 'runner', 'supervise'] },
      env: { OVERLORD_BACKEND_URL: 'https://api.example.test' },
      autoStart: true
    });
    const verbs = calls.map(args => args[0]);
    assert.equal(verbs[0], 'bootout', 'install must unload the old definition first');
    assert.deepEqual(verbs, ['bootout', 'enable', 'bootstrap', 'kickstart']);
    // The plist the load step points at is the one install just wrote.
    const bootstrapCall = calls.find(args => args[0] === 'bootstrap');
    assert.equal(bootstrapCall?.[2], manager.unitPath());
    assert.ok(existsSync(manager.unitPath()));
    const plist = readFileSync(manager.unitPath(), 'utf8');
    assert.ok(plist.includes('supervise'));
    assert.equal(parseLaunchdProcessType(plist), 'Interactive');
    assert.deepEqual(inspectInstalledLaunchdPlist(manager.unitPath()), {
      processType: 'Interactive',
      path: null
    });
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorDataDir === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = priorDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launchd install and uninstall stay idempotent when the label is not loaded', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-launchd-idempotent-'));
  const priorHome = process.env.HOME;
  const priorDataDir = process.env.OVLD_HOME;
  try {
    process.env.HOME = dir;
    process.env.OVLD_HOME = path.join(dir, '.ovld');
    // `bootout` and `list` both fail for a label launchd does not know about.
    const { manager, calls } = recordingLaunchd(args => {
      if (args[0] === 'bootout' || args[0] === 'list') throw new Error('No such process');
    });
    await manager.install({
      invocation: { program: '/node', args: ['/cli.js', 'runner', 'supervise'] },
      env: {},
      autoStart: false
    });
    assert.deepEqual(
      calls.map(args => args[0]),
      ['bootout'],
      'autoStart false must not start the service'
    );
    assert.ok(existsSync(manager.unitPath()));
    await manager.uninstall();
    assert.ok(!existsSync(manager.unitPath()), 'a not-loaded label must still uninstall cleanly');
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorDataDir === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = priorDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launchd uninstall keeps the plist when the label is still registered', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-launchd-uninstall-'));
  const priorHome = process.env.HOME;
  const priorDataDir = process.env.OVLD_HOME;
  try {
    process.env.HOME = dir;
    process.env.OVLD_HOME = path.join(dir, '.ovld');
    // bootout fails and `launchctl list <label>` still resolves: launchd kept
    // the old definition, so deleting the plist would strand it forever.
    const { manager } = recordingLaunchd(args => {
      if (args[0] === 'bootout') throw new Error('Boot-out failed: 5: Input/output error');
    });
    await manager.install({
      invocation: { program: '/node', args: ['/cli.js', 'runner', 'supervise'] },
      env: {},
      autoStart: false
    });
    await assert.rejects(() => manager.uninstall(), /still reports .* as loaded/);
    assert.ok(existsSync(manager.unitPath()), 'the plist must survive a failed unload');
  } finally {
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    if (priorDataDir === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = priorDataDir;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launchd restart forces a full unload and reload from disk', async () => {
  const { manager, calls } = recordingLaunchd();
  await manager.restart();
  assert.deepEqual(
    calls.map(args => args[0]),
    ['bootout', 'enable', 'bootstrap', 'kickstart']
  );
});

test('inspectInstalledLaunchdPlist extracts ProcessType and PATH from a rendered plist', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ovld-plist-inspect-'));
  try {
    const pathEnv = composeRunnerServicePath({ homeDir: '/Users/tester' });
    const plist = renderLaunchdPlist({
      label: LAUNCHD_LABEL,
      invocation: { program: '/node', args: ['/cli.js', 'runner', 'supervise'] },
      env: { PATH: pathEnv },
      logDir: dir
    });
    const plistPath = path.join(dir, 'io.overlord.runner.plist');
    writeFileSync(plistPath, plist);
    assert.equal(parseLaunchdEnvPath(plist), pathEnv);
    assert.deepEqual(inspectInstalledLaunchdPlist(plistPath), {
      processType: 'Interactive',
      path: pathEnv
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runnerServiceReinstallHint nags while ProcessType or PATH is stale, or publisher is node', () => {
  const currentPath = composeRunnerServicePath();
  assert.equal(
    runnerServiceReinstallHint({
      installed: true,
      publisher: 'overlord',
      processType: 'Interactive',
      path: currentPath
    }),
    null
  );
  assert.equal(
    runnerServiceReinstallHint({ installed: false, publisher: 'node', processType: 'Background' }),
    null
  );
  const stale = runnerServiceReinstallHint({
    installed: true,
    publisher: 'overlord',
    processType: 'Background'
  });
  assert.ok(stale && stale.includes('ProcessType=Background'));
  assert.ok(stale.includes('ovld runner service install'));
  const nodeHint = runnerServiceReinstallHint({
    installed: true,
    publisher: 'node',
    processType: 'Interactive'
  });
  assert.ok(nodeHint && nodeHint.includes('Node.js Foundation'));
  const stalePath = runnerServiceReinstallHint({
    installed: true,
    publisher: 'overlord',
    processType: 'Interactive',
    path: '/usr/bin:/bin:/usr/sbin:/sbin'
  });
  assert.ok(stalePath && stalePath.includes('PATH'));
  assert.ok(stalePath.includes('ovld runner service install'));
  assert.ok(!stalePath.includes('ProcessType='));
});
