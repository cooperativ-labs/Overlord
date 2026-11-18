import type { TerminalSessionDto } from '@overlord/contract';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectLatchSessionDisplay } from './latch-session-display.ts';

function session(
  overrides: Partial<TerminalSessionDto> & { providerSessionId: string }
): TerminalSessionDto {
  return {
    executionRequestId: `req-${overrides.providerSessionId}`,
    objectiveId: 'obj-1',
    provider: 'latch',
    sessionName: overrides.providerSessionId,
    executionTargetId: 'target-1',
    deviceLabel: 'Mac',
    agentSessionId: null,
    executable: 'latch',
    viewerKind: 'iterm',
    viewerOpenAs: 'window',
    createdAt: '2026-08-17T00:00:00.000Z',
    lastObservedState: 'running',
    ...overrides
  };
}

test('leads with the newest session even when an older one is live', () => {
  const display = selectLatchSessionDisplay([
    session({
      providerSessionId: 'exited-newest',
      createdAt: '2026-08-17T12:00:00.000Z',
      lastObservedState: 'exited'
    }),
    session({
      providerSessionId: 'live',
      createdAt: '2026-08-17T09:00:00.000Z'
    }),
    session({
      providerSessionId: 'older-exited',
      createdAt: '2026-08-16T00:00:00.000Z',
      lastObservedState: 'exited'
    })
  ]);

  assert.equal(display.current?.providerSessionId, 'exited-newest');
  assert.deepEqual(
    display.others.map(item => item.providerSessionId),
    ['live', 'older-exited']
  );
  assert.equal(display.runningOtherCount, 1);
});

test('prefers the newest session across objectives', () => {
  const display = selectLatchSessionDisplay([
    session({
      providerSessionId: 'other',
      objectiveId: 'obj-2',
      createdAt: '2026-08-19T00:00:00.000Z'
    }),
    session({ providerSessionId: 'old', createdAt: '2026-08-17T00:00:00.000Z' }),
    session({
      providerSessionId: 'latest',
      createdAt: '2026-08-18T00:00:00.000Z',
      lastObservedState: 'lost'
    })
  ]);
  assert.equal(display.current?.providerSessionId, 'other');
  assert.deepEqual(
    display.others.map(item => item.providerSessionId),
    ['latest', 'old']
  );
});

test('orders timestamps chronologically across ISO fractional-second formats', () => {
  const display = selectLatchSessionDisplay([
    session({ providerSessionId: 'older', createdAt: '2026-08-17T10:00:00Z' }),
    session({ providerSessionId: 'newer', createdAt: '2026-08-17T10:00:00.500Z' })
  ]);
  assert.equal(display.current?.providerSessionId, 'newer');
});

test('treats a stopping session as live so it stays on the current card', () => {
  const display = selectLatchSessionDisplay([
    session({
      providerSessionId: 'stopping',
      createdAt: '2026-08-17T10:00:00.000Z',
      lastObservedState: 'stopping'
    }),
    session({
      providerSessionId: 'exited',
      createdAt: '2026-08-17T09:00:00.000Z',
      lastObservedState: 'exited'
    })
  ]);

  assert.equal(display.current?.providerSessionId, 'stopping');
  assert.deepEqual(
    display.others.map(item => item.providerSessionId),
    ['exited']
  );
});

test('falls back to the newest session when none are live', () => {
  const display = selectLatchSessionDisplay([
    session({
      providerSessionId: 'a',
      createdAt: '2026-08-15T00:00:00.000Z',
      lastObservedState: 'exited'
    }),
    session({
      providerSessionId: 'b',
      createdAt: '2026-08-17T00:00:00.000Z',
      lastObservedState: 'lost'
    })
  ]);

  assert.equal(display.current?.providerSessionId, 'b');
  assert.deepEqual(
    display.others.map(item => item.providerSessionId),
    ['a']
  );
});

test('counts only the other sessions that are still running', () => {
  const display = selectLatchSessionDisplay([
    session({ providerSessionId: 'current', createdAt: '2026-08-17T10:00:00.000Z' }),
    session({ providerSessionId: 'running', createdAt: '2026-08-17T09:00:00.000Z' }),
    session({
      providerSessionId: 'exited',
      createdAt: '2026-08-17T08:00:00.000Z',
      lastObservedState: 'exited'
    }),
    session({
      providerSessionId: 'lost',
      createdAt: '2026-08-17T07:00:00.000Z',
      lastObservedState: 'lost'
    })
  ]);

  assert.equal(display.current?.providerSessionId, 'current');
  assert.equal(display.others.length, 3);
  assert.equal(display.runningOtherCount, 1);
});

test('an empty mission has nothing to show', () => {
  const display = selectLatchSessionDisplay([]);
  assert.equal(display.current, null);
  assert.deepEqual(display.others, []);
  assert.equal(display.runningOtherCount, 0);
});
