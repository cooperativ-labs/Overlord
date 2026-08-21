import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { InProcessProvider } from './local-target/in-process-provider.ts';
import {
  inspectLatchSession,
  isLatchSessionAbsentMessage,
  LatchSessionAbsentError,
  LatchSessionCommandError,
  openLatchSession,
  stopLatchSession
} from './latch-session.ts';

const tempDir = mkdtempSync(path.join(tmpdir(), 'overlord-latch-session-'));
const fakeLatch = path.join(tempDir, 'latch');
writeFileSync(
  fakeLatch,
  `#!/usr/bin/env node
const [command, id, ...args] = process.argv.slice(2);
if (command === 'inspect') {
  process.stdout.write(JSON.stringify({
    id,
    name: 'mission-shell',
    state: 'running',
    exit: null
  }));
} else if (command === 'capabilities') {
  process.stdout.write(JSON.stringify({
    protocolVersion: 2,
    productVersion: process.env.FAKE_LATCH_VERSION ?? '0.2608140931.0',
    capabilities: {
      create: true,
      openViewer: true,
      localAttach: true,
      cloudAttach: false,
      selfUpdate: true,
      extensions: []
    }
  }));
} else if (command === 'open') {
  const asIndex = args.indexOf('--as');
  process.stdout.write(JSON.stringify({
    id,
    viewer: args[args.indexOf('--with') + 1],
    opened: true,
    behavior: asIndex === -1 ? undefined : args[asIndex + 1]
  }));
} else if (command === 'stop') {
  process.stdout.write(JSON.stringify({ id, state: 'stopping' }));
} else {
  process.exitCode = 2;
}
`
);
chmodSync(fakeLatch, 0o700);

after(() => rmSync(tempDir, { recursive: true, force: true }));

test('inspects bounded Latch terminal-session state', async () => {
  const result = await inspectLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test'
  });
  assert.equal(result.providerSessionId, 'ses_test');
  assert.equal(result.name, 'mission-shell');
  assert.equal(result.state, 'running');
});

test('session commands do not block the local-target event loop', async () => {
  const slowLatch = path.join(tempDir, 'latch-slow');
  writeFileSync(
    slowLatch,
    `#!/usr/bin/env node
const id = process.argv[3];
setTimeout(() => process.stdout.write(JSON.stringify({
  id,
  name: 'slow-session',
  state: 'running',
  exit: null
})), 250);
`
  );
  chmodSync(slowLatch, 0o700);

  const eventLoopTurn = new Promise<'event-loop'>(resolve => {
    setTimeout(() => resolve('event-loop'), 25);
  });
  const inspection = inspectLatchSession({
    executable: slowLatch,
    providerSessionId: 'ses_slow'
  });

  assert.equal(
    await Promise.race([
      Promise.resolve(inspection).then(() => 'inspection' as const),
      eventLoopTurn
    ]),
    'event-loop'
  );
  assert.equal((await inspection).name, 'slow-session');
});

test('opens the stored viewer separately from the session process', async () => {
  const result = await openLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test',
    viewerKind: 'iterm'
  });
  assert.deepEqual(result, {
    providerSessionId: 'ses_test',
    viewer: 'iterm',
    opened: true,
    behavior: null
  });
});

test('sends the requested window-or-tab shape to a Latch that supports it', async () => {
  const result = await openLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test',
    viewerKind: 'iterm',
    openAs: 'tab'
  });
  assert.equal(result.behavior, 'tab');
});

test('omits the shape flag for a Latch build that predates it', async () => {
  const saved = process.env.FAKE_LATCH_VERSION;
  // clap rejects unknown flags, so an ungated `--as` would fail the open
  // outright; omitting it degrades to a new window instead.
  process.env.FAKE_LATCH_VERSION = '0.2608140801.0';
  try {
    const result = await openLatchSession({
      executable: fakeLatch,
      providerSessionId: 'ses_test',
      viewerKind: 'iterm',
      openAs: 'tab'
    });
    assert.equal(result.opened, true);
    assert.equal(result.behavior, null);
  } finally {
    if (saved === undefined) delete process.env.FAKE_LATCH_VERSION;
    else process.env.FAKE_LATCH_VERSION = saved;
  }
});

test('stops only after an explicit lifecycle call', async () => {
  const result = await stopLatchSession({
    executable: fakeLatch,
    providerSessionId: 'ses_test'
  });
  assert.deepEqual(result, {
    providerSessionId: 'ses_test',
    state: 'stopping'
  });
});

test('spawns Latch with a UTF-8 locale even when the parent has none', async () => {
  const localeEcho = path.join(tempDir, 'latch-locale');
  writeFileSync(
    localeEcho,
    `#!/usr/bin/env node
const id = process.argv[3];
process.stdout.write(JSON.stringify({
  id,
  name: process.env.LC_CTYPE ?? '(unset)',
  state: 'running',
  exit: null
}));
`
  );
  chmodSync(localeEcho, 0o700);

  const localeKeys = ['LC_ALL', 'LC_CTYPE', 'LANG'] as const;
  const saved = localeKeys.map(key => [key, process.env[key]] as const);
  for (const key of localeKeys) delete process.env[key];
  try {
    const result = await inspectLatchSession({
      executable: localeEcho,
      providerSessionId: 'ses_locale'
    });
    assert.match(result.name, /utf-?8/i);
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('inspect treats Latch no-session as absence, not a generic failure', async () => {
  const missing = path.join(tempDir, 'latch-missing');
  writeFileSync(
    missing,
    [
      '#!/usr/bin/env node',
      'process.stderr.write("Error: no session `ses_gone`\\n");',
      'process.exit(1);'
    ].join('\n')
  );
  chmodSync(missing, 0o700);

  await assert.rejects(
    inspectLatchSession({ executable: missing, providerSessionId: 'ses_gone' }),
    (error: unknown) => {
      assert.ok(error instanceof LatchSessionAbsentError);
      assert.match(error.message, /no session `ses_gone`/);
      return true;
    }
  );

  const mapped = await new InProcessProvider({
    executionTargetId: 't1',
    deviceLabel: 'Laptop',
    transport: 'in_process'
  }).inspectLatchSession({
    executable: missing,
    providerSessionId: 'ses_gone'
  });
  assert.equal(mapped.ok, false);
  if (!mapped.ok) {
    assert.equal(mapped.code, 'LATCH_SESSION_ABSENT');
  }
});

test('inspect keeps unrelated Latch failures as command errors', async () => {
  const broken = path.join(tempDir, 'latch-broken');
  writeFileSync(
    broken,
    [
      '#!/usr/bin/env node',
      'process.stderr.write("tmux is not running\\n");',
      'process.exit(1);'
    ].join('\n')
  );
  chmodSync(broken, 0o700);

  await assert.rejects(
    inspectLatchSession({ executable: broken, providerSessionId: 'ses_alive' }),
    (error: unknown) => {
      assert.equal(error instanceof LatchSessionAbsentError, false);
      assert.ok(error instanceof LatchSessionCommandError);
      assert.match(error.message, /tmux is not running/);
      return true;
    }
  );
});

test('isLatchSessionAbsentMessage recognizes Latch lookup errors', () => {
  assert.equal(isLatchSessionAbsentMessage('Error: no session `ses_1`'), true);
  assert.equal(isLatchSessionAbsentMessage('no session `ses_1`'), true);
  assert.equal(isLatchSessionAbsentMessage('Error: no session named `agent`'), true);
  assert.equal(isLatchSessionAbsentMessage('tmux is not running'), false);
  assert.equal(isLatchSessionAbsentMessage('no sessions'), false);
  assert.equal(
    isLatchSessionAbsentMessage('session ses_1 is not available in the Latch server'),
    false
  );
});
