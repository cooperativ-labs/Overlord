import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectLatchInvocation, latchInvocationWarning } from './latch-invocation.ts';

describe('detectLatchInvocation', () => {
  it('returns null for empty or unrelated commands', () => {
    assert.equal(detectLatchInvocation(''), null);
    assert.equal(detectLatchInvocation(null), null);
    assert.equal(detectLatchInvocation('agp'), null);
    assert.equal(detectLatchInvocation('yarn install && npm run build'), null);
  });

  it('does not match a word that merely contains "latch"', () => {
    assert.equal(detectLatchInvocation('./scripts/latch-helper.sh'), null);
    assert.equal(detectLatchInvocation('echo latch'), null);
  });

  it('matches a bare latch invocation and reports the subcommand', () => {
    const match = detectLatchInvocation('latch create --manifest-file -');
    assert.ok(match);
    assert.equal(match.subcommand, 'create');
    assert.equal(match.createsSession, true);
  });

  it('matches after a separator and through an absolute path', () => {
    const match = detectLatchInvocation('cd /repo && /usr/local/bin/latch open abc123');
    assert.ok(match);
    assert.equal(match.subcommand, 'open');
    assert.equal(match.command, '/usr/local/bin/latch open abc123');
  });

  it('ignores leading environment assignments', () => {
    const match = detectLatchInvocation('FOO=1 BAR=2 latch attach abc');
    assert.ok(match);
    assert.equal(match.subcommand, 'attach');
  });

  it('flags a non-session subcommand without claiming it creates one', () => {
    const match = detectLatchInvocation('latch capabilities --json');
    assert.ok(match);
    assert.equal(match.createsSession, false);
  });

  it('finds the invocation on a later line of a multi-line pre-launch block', () => {
    const match = detectLatchInvocation('yarn install\nlatch create --json');
    assert.ok(match);
    assert.equal(match.command, 'latch create --json');
  });
});

describe('latchInvocationWarning', () => {
  it('never suggests rewriting the command and points at the toggle', () => {
    const match = detectLatchInvocation('latch create');
    assert.ok(match);
    const warning = latchInvocationWarning(match);
    assert.match(warning, /will not rewrite it/);
    assert.match(warning, /Session setting/);
  });
});
