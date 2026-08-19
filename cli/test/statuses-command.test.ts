import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs } from '../src/args.ts';
import { runManagementCommand } from '../src/commands.ts';
import { CliError } from '../src/errors.ts';
import { assertKnownFlags, COMMAND_FLAGS } from '../src/flag-registry.ts';
import { printHelp } from '../src/help.ts';
import { printProtocolHelp } from '../src/protocol-help.ts';

function captureStdout(run: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    run();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

type Recorded = { path: string };

function fakeRuntime(handlers: {
  get: (path: string) => unknown;
  recorded: Recorded[];
}): Parameters<typeof runManagementCommand>[0]['runtime'] {
  const backend = {
    baseUrl: 'http://localhost:4000',
    health: async () => ({ ok: true as const }),
    get: async <T>(path: string): Promise<T> => {
      handlers.recorded.push({ path });
      return handlers.get(path) as T;
    },
    post: async <T>(): Promise<T> => ({}) as T,
    postRaw: async <T>(): Promise<T> => ({}) as T,
    patch: async <T>(): Promise<T> => ({}) as T,
    delete: async <T>(): Promise<T> => ({}) as T
  };
  return { backend, close: () => {} } as unknown as Parameters<
    typeof runManagementCommand
  >[0]['runtime'];
}

const STATUSES = [
  {
    id: 's1',
    projectId: 'p1',
    key: 'backlog',
    name: 'Backlog',
    type: 'draft',
    position: 0,
    isDefault: true,
    isTerminal: false
  },
  {
    id: 's2',
    projectId: 'p1',
    key: 'in_progress',
    name: 'Cooking',
    type: 'execute',
    position: 1,
    isDefault: false,
    isTerminal: false
  },
  {
    id: 's3',
    projectId: 'p1',
    key: 'complete',
    name: 'Done',
    type: 'complete',
    position: 2,
    isDefault: false,
    isTerminal: true
  }
];

test('statuses is a registered command with a project-id flag', () => {
  assert.deepEqual(COMMAND_FLAGS.statuses, ['--project-id']);
  assert.doesNotThrow(() =>
    assertKnownFlags({
      command: 'statuses',
      flags: parseArgs(['list', '--project-id', 'p1', '--json']).flags,
      primaryCommand: 'ovld'
    })
  );
  assert.throws(
    () =>
      assertKnownFlags({
        command: 'statuses',
        flags: parseArgs(['list', '--workspace-id', 'w1']).flags,
        primaryCommand: 'ovld'
      }),
    CliError,
    'statuses is project-scoped and must not accept a workspace id'
  );
});

test('statuses list reads the project status route and prints one row per column', async () => {
  const recorded: Recorded[] = [];
  const runtime = fakeRuntime({
    recorded,
    get: path => (path === '/api/projects/p1' ? { id: 'p1', slug: 'alpha' } : STATUSES)
  });

  const output = await new Promise<string>(resolve => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    runManagementCommand({
      runtime,
      command: 'statuses',
      rest: ['list', '--project-id', 'p1']
    })
      .finally(() => {
        console.log = original;
      })
      .then(() => resolve(lines.join('\n')));
  });

  assert.ok(recorded.some(entry => entry.path === '/api/projects/p1/statuses'));
  const rows = output.split('\n');
  assert.equal(rows.length, 3);
  assert.match(rows[0] ?? '', /backlog\tBacklog\tdraft\tdefault/);
  assert.match(rows[1] ?? '', /in_progress\tCooking\texecute/);
  assert.match(rows[2] ?? '', /complete\tDone\tcomplete\tterminal/);
});

test('statuses list requires a project id and rejects an unknown subcommand', async () => {
  const runtime = fakeRuntime({ recorded: [], get: () => STATUSES });

  await assert.rejects(
    runManagementCommand({ runtime, command: 'statuses', rest: ['list'] }),
    (error: unknown) => error instanceof CliError && /--project-id/.test(error.message)
  );
  await assert.rejects(
    runManagementCommand({ runtime, command: 'statuses', rest: ['create'] }),
    (error: unknown) => error instanceof CliError && /statuses list/.test(error.message)
  );
});

test('help documents statuses discovery and --status as a TYPE filter', () => {
  const help = captureStdout(() => printHelp({ primaryCommand: 'ovld' }));
  assert.match(help, /ovld statuses list --project-id <id\|slug\|name>/);
  assert.match(help, /ovld protocol statuses --project-id/);
  assert.match(help, /--status filters status TYPES/);
  // The old example used `next-up`, which is a status KEY, not a type.
  assert.doesNotMatch(help, /--status next-up/);

  const protocolHelp = captureStdout(() => printProtocolHelp({ primaryCommand: 'ovld' }));
  assert.match(protocolHelp, /^statuses:$/m);
  assert.match(protocolHelp, /--project-id <id>\s+Project id, slug, or name/);
  assert.match(protocolHelp, /Comma-separated status TYPES/);
  assert.doesNotMatch(protocolHelp, /e\.g\. next-up/);
});

test('missions list forwards --status as a statusTypes CSV', async () => {
  const recorded: Recorded[] = [];
  const runtime = fakeRuntime({ recorded, get: () => ({ missions: [] }) });

  await runManagementCommand({
    runtime,
    command: 'missions',
    rest: ['list', '--status', 'execute, review ,', '--project-id', 'p1', '--json']
  });

  const searched = recorded.find(entry => entry.path.startsWith('/api/missions/search'));
  assert.ok(searched, 'missions list must call the search endpoint');
  const params = new URLSearchParams(searched.path.split('?')[1] ?? '');
  // Trimmed, empty entries dropped — and sent as statusTypes, so the backend
  // filters status TYPES rather than project-defined names.
  assert.equal(params.get('statusTypes'), 'execute,review');
  assert.equal(params.get('projectId'), 'p1');
});

test('missions list omits the filter entirely when --status is absent', async () => {
  const recorded: Recorded[] = [];
  const runtime = fakeRuntime({ recorded, get: () => ({ missions: [] }) });

  await runManagementCommand({ runtime, command: 'missions', rest: ['list', '--json'] });

  const searched = recorded.find(entry => entry.path.startsWith('/api/missions/search'));
  assert.ok(searched);
  assert.equal(new URLSearchParams(searched.path.split('?')[1] ?? '').has('statusTypes'), false);
});
