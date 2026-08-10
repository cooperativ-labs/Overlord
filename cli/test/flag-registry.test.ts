import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs } from '../src/args.ts';
import { CliError } from '../src/errors.ts';
import { assertKnownFlags, COMMAND_FLAGS } from '../src/flag-registry.ts';

function assertFor(command: string, argv: string[]): void {
  assertKnownFlags({ command, flags: parseArgs(argv).flags, primaryCommand: 'ovld' });
}

test('accepts a known flag for a command', () => {
  assert.doesNotThrow(() => assertFor('add-cwd', ['--project-id', 'p1', '--primary', 'true']));
});

test('accepts globally allowed flags on any registered command', () => {
  assert.doesNotThrow(() => assertFor('doctor', ['--json']));
  assert.doesNotThrow(() => assertFor('add-cwd', ['--help']));
});

test('rejects an unknown flag with a CliError', () => {
  assert.throws(
    () => assertFor('add-cwd', ['--project-id', 'p1', '--bogus', 'x']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /Unknown flag for `ovld add-cwd`: --bogus/);
      return true;
    }
  );
});

test('suggests the closest flag for a likely typo', () => {
  assert.throws(
    () => assertFor('add-cwd', ['--projet-id', 'p1']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /did you mean --project-id\?/);
      return true;
    }
  );
});

test('lists every unknown flag when several are present', () => {
  assert.throws(
    () => assertFor('doctor', ['--foo', '--bar']),
    (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /Unknown flags/);
      assert.match(error.message, /--foo/);
      assert.match(error.message, /--bar/);
      return true;
    }
  );
});

test('skips validation for unregistered commands like protocol', () => {
  assert.doesNotThrow(() =>
    assertKnownFlags({
      command: 'protocol',
      flags: parseArgs(['--anything', 'x']).flags,
      primaryCommand: 'ovld'
    })
  );
});

test('launch-family commands share the same flag set', () => {
  for (const command of ['launch', 'restart', 'run', 'connect', 'resume']) {
    assert.doesNotThrow(() =>
      assertFor(command, ['--mission-id', 'm1', '--agent', 'claude', '--dry-run'])
    );
  }
});

test('agent-session accepts the flags used by rendered hook commands', () => {
  for (const argv of [
    ['event', '--agent', 'codex', '--payload-file', '-'],
    ['request', '--agent', 'codex', '--payload-file', '-'],
    ['inbox', '--agent', 'codex', '--payload-file', '-', '--wait-ms', '5000'],
    ['bind', '--agent', 'codex', '--native-session-id', 'native-1', '--mission-id', 'coo:1']
  ]) {
    assert.doesNotThrow(() => assertFor('agent-session', argv));
  }
});

test('agent-session still rejects flags outside its subcommand union', () => {
  assert.throws(
    () => assertFor('agent-session', ['event', '--agent', 'codex', '--payload-fiel', '-']),
    /Unknown flag for `ovld agent-session`: --payload-fiel/
  );
});

test('every KNOWN command except protocol is registered', () => {
  // Guards against a new command being added to index.ts without a flag list,
  // which would silently reintroduce the ignore-unknown-flags behavior.
  const registered = new Set(Object.keys(COMMAND_FLAGS));
  for (const command of [
    'add-cwd',
    'add-url',
    'create',
    'prompt',
    'attach',
    'launch',
    'runner',
    'missions',
    'mission',
    'changes'
  ]) {
    assert.ok(registered.has(command), `expected ${command} to be registered`);
  }
});
