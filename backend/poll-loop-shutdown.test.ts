import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { it } from 'node:test';

const POLL_LOOP = path.join(import.meta.dirname, 'poll-loop.ts');

/** A process that would otherwise run forever, with the background-loop shutdown hook installed. */
const child = (signal: NodeJS.Signals) =>
  (async () => {
    const proc = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import { stopOnTermination } from ${JSON.stringify(POLL_LOOP)};
         import { createServer } from 'node:http';
         createServer(() => {}).listen(0, '127.0.0.1', () => {
           stopOnTermination([{ stop: () => void process.stdout.write('stopped\\n') }]);
           process.stdout.write('ready\\n');
         });`
      ],
      { cwd: import.meta.dirname, stdio: ['ignore', 'pipe', 'inherit'] }
    );
    let output = '';
    proc.stdout.on('data', chunk => (output += String(chunk)));
    while (!output.includes('ready')) await once(proc.stdout, 'data');
    const exited = once(proc, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
    proc.kill(signal);
    const timer = setTimeout(() => proc.kill('SIGKILL'), 5000);
    const [code, by] = await exited;
    clearTimeout(timer);
    return { code, by, output };
  })();

for (const signal of ['SIGTERM', 'SIGINT'] as const)
  it(`a single ${signal} stops background loops and still terminates the backend process`, async () => {
    const result = await child(signal);
    assert.ok(result.output.includes('stopped'), 'the stop hook ran');
    // Terminated by the original signal, not by the test's SIGKILL fallback.
    assert.equal(result.by, signal);
    assert.equal(result.code, null);
  });
