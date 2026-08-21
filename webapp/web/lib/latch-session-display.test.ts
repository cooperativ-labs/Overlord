import assert from 'node:assert/strict';
import test from 'node:test';

import type { TerminalSessionDto } from '../../shared/contract.ts';

import { selectLatchSessionDisplay } from './latch-session-display.ts';

function session(overrides: Partial<TerminalSessionDto> & { providerSessionId: string }) {
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
    createdAt: '2026-08-17T00:00:00.000Z',
    lastObservedState: 'running',
    ...overrides
  } as TerminalSessionDto;
}

test('leads with the newest session for the active objective', () => {
  const display = selectLatchSessionDisplay(
    [
      session({
        providerSessionId: 'old-current',
        objectiveId: 'obj-2',
        createdAt: '2026-08-16T00:00:00.000Z'
      }),
      session({
        providerSessionId: 'newest-other',
        objectiveId: 'obj-1',
        createdAt: '2026-08-17T12:00:00.000Z'
      }),
      session({
        providerSessionId: 'new-current',
        objectiveId: 'obj-2',
        createdAt: '2026-08-17T09:00:00.000Z'
      })
    ],
    'obj-2'
  );

  assert.equal(display.current?.providerSessionId, 'new-current');
  assert.deepEqual(
    display.others.map(s => s.providerSessionId),
    ['newest-other', 'old-current']
  );
});

test('falls back to the newest session when no active objective has one', () => {
  const display = selectLatchSessionDisplay(
    [
      session({ providerSessionId: 'a', createdAt: '2026-08-15T00:00:00.000Z' }),
      session({ providerSessionId: 'b', createdAt: '2026-08-17T00:00:00.000Z' })
    ],
    'obj-without-a-session'
  );

  assert.equal(display.current?.providerSessionId, 'b');
  assert.deepEqual(
    display.others.map(s => s.providerSessionId),
    ['a']
  );
});

test('counts only the other sessions that are still running', () => {
  const display = selectLatchSessionDisplay(
    [
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
    ],
    null
  );

  assert.equal(display.current?.providerSessionId, 'current');
  assert.equal(display.others.length, 3);
  assert.equal(display.runningOtherCount, 1);
});

test('an empty mission has nothing to show', () => {
  const display = selectLatchSessionDisplay([], 'obj-1');
  assert.equal(display.current, null);
  assert.deepEqual(display.others, []);
  assert.equal(display.runningOtherCount, 0);
});
