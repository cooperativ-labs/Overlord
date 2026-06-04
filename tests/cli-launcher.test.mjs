import assert from 'node:assert/strict';
import test from 'node:test';

import { launcherTestHooks, runLauncherCommand } from '../packages/overlord-cli/bin/_cli/launcher.mjs';

async function runLaunchWithPreCommand(launchArgs) {
  const calls = [];

  launcherTestHooks.platform = 'darwin';
  launcherTestHooks.shell = '/bin/zsh';
  launcherTestHooks.execFileSync = (file, argv) => {
    calls.push({ file, argv });
    if (file === process.execPath) {
      return JSON.stringify({
        platformUrl: 'https://www.ovld.ai',
        bearerToken: 'token-123',
        localSecret: 'secret-123',
        organizationId: 1
      });
    }
    if (file === '/bin/zsh') {
      return '';
    }
    throw new Error(`Unexpected exec: ${file}`);
  };

  const previousTicketId = process.env.TICKET_ID;
  const previousFetch = global.fetch;
  process.env.TICKET_ID = '1:1254';
  global.fetch = async () =>
    new Response('launch context', {
      status: 200,
      headers: {
        'X-Working-Directory': '/tmp/repo',
        'X-Ticket-Id': '1:1254'
      }
    });

  try {
    await runLauncherCommand('launch', launchArgs);
  } finally {
    launcherTestHooks.execFileSync = null;
    launcherTestHooks.shell = null;
    launcherTestHooks.platform = null;
    global.fetch = previousFetch;
    if (previousTicketId === undefined) delete process.env.TICKET_ID;
    else process.env.TICKET_ID = previousTicketId;
  }

  return calls;
}

test('ovld launch runs pre-commands through an interactive login shell on POSIX', async () => {
  const calls = await runLaunchWithPreCommand([
    'codex',
    '--ticket-id',
    '1:1254',
    '--pre-command',
    'agent-pod'
  ]);

  // `-ilc` (interactive + login), not `-lc`: only interactive shells source
  // ~/.zshrc / ~/.bashrc, where wrappers like agent-pod install their alias.
  assert.equal(calls.at(-1)?.file, '/bin/zsh');
  assert.equal(calls.at(-1)?.argv?.[0], '-ilc');
  assert.match(calls.at(-1)?.argv?.[1] ?? '', /^agent-pod 'codex'/);
});

test('ovld launch claude resolves an agent-pod pre-command alias via interactive shell', async () => {
  const calls = await runLaunchWithPreCommand([
    'claude',
    '--ticket-id',
    '1:1254',
    '--pre-command',
    'agent-pod'
  ]);

  const last = calls.at(-1);
  assert.equal(last?.file, '/bin/zsh');
  assert.equal(last?.argv?.[0], '-ilc');
  // The agent binary and all of its args are a single quoted shell string so the
  // alias receives them as arguments rather than zsh treating them as $0/$1/....
  assert.match(last?.argv?.[1] ?? '', /^agent-pod 'claude'/);
});

test('ovld launch claude uses a context file when routed through agent-pod', async () => {
  const calls = await runLaunchWithPreCommand([
    'claude',
    '--ticket-id',
    '1:1254',
    '--pre-command',
    'agent-pod'
  ]);

  const command = calls.at(-1)?.argv?.[1] ?? '';
  assert.match(command, /'--append-system-prompt-file' '.*\/\.overlord\/tmp\/overlord-/);
  assert.doesNotMatch(command, /'--append-system-prompt' 'launch context'/);
});

test('ovld launch codex uses a context file prompt when routed through agent-pod', async () => {
  const calls = await runLaunchWithPreCommand([
    'codex',
    '--ticket-id',
    '1:1254',
    '--pre-command',
    'agent-pod'
  ]);

  const command = calls.at(-1)?.argv?.[1] ?? '';
  assert.match(command, /^agent-pod 'codex'/);
  assert.match(command, /Read the Overlord launch context from .*\/\.overlord\/tmp\/overlord-/);
  assert.doesNotMatch(command, /'launch context'/);
});
