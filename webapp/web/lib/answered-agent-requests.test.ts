import type { HumanAgentRequestDto } from '@overlord/contract';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectAnswerFollowUps } from './answered-agent-requests.ts';

function req(
  id: string,
  overrides: Partial<HumanAgentRequestDto> = {},
  delivery: Partial<HumanAgentRequestDto['delivery']> = {}
): HumanAgentRequestDto {
  return {
    id,
    channelId: 'channel-1',
    missionId: 'mission-1',
    objectiveId: 'objective-1',
    kind: 'question',
    summary: 'Which option?',
    options: [],
    allowsFreeText: true,
    status: 'resolved',
    resolution: { text: 'B' },
    revision: 2,
    windowExpiresAt: null,
    releasedReason: null,
    applicationState: 'emitted',
    resolvedAt: '2026-11-16T12:00:00.000Z',
    createdAt: '2026-11-16T11:00:00.000Z',
    delivery: {
      mode: 'read_only',
      reason: 'request_closed',
      state: 'emitted',
      observedAt: null,
      stage: 'queued',
      attempt: 1,
      ...delivery
    },
    ...overrides
  };
}

test('unsettled answers follow up on every device; confirmed ones only where answered', () => {
  const failed = req('failed', {}, { stage: 'failed', canRedeliver: true });
  const confirmedElsewhere = req('confirmed-elsewhere', {}, { stage: 'confirmed' });
  const open = req('open', { status: 'open', resolution: null, resolvedAt: null });
  const permission = req('permission', { kind: 'permission' }, { stage: null });
  const selected = selectAnswerFollowUps({
    serverRequests: [failed, confirmedElsewhere, open, permission],
    local: undefined,
    closedIds: undefined
  });
  assert.deepEqual(
    selected.map(r => r.id),
    ['failed']
  );

  const answeredHere = req('answered-here', {}, { stage: 'confirmed' });
  const withLocal = selectAnswerFollowUps({
    serverRequests: [failed, answeredHere],
    local: new Map([['answered-here', { request: answeredHere }]]),
    closedIds: undefined
  });
  assert.deepEqual(withLocal.map(r => r.id).sort(), ['answered-here', 'failed']);
});

test('the local response fills in before the server read catches up, and newer server data wins', () => {
  const localPending = req('a', {}, { stage: 'dispatched' });
  const onlyLocal = selectAnswerFollowUps({
    serverRequests: [],
    local: new Map([['a', { request: localPending }]]),
    closedIds: undefined
  });
  assert.equal(onlyLocal[0]?.delivery.stage, 'dispatched');

  const serverFailed = req('a', {}, { stage: 'failed', canRedeliver: true });
  const merged = selectAnswerFollowUps({
    serverRequests: [serverFailed],
    local: new Map([['a', { request: localPending }]]),
    closedIds: undefined
  });
  assert.equal(merged[0]?.delivery.stage, 'failed');
});

test('closing and objective scoping hide follow-ups without touching the request', () => {
  const a = req('a', {}, { stage: 'failed' });
  const b = req('b', { objectiveId: 'objective-2' }, { stage: 'unconfirmed' });
  assert.deepEqual(
    selectAnswerFollowUps({
      serverRequests: [a, b],
      local: undefined,
      closedIds: new Set(['a'])
    }).map(r => r.id),
    ['b']
  );
  assert.deepEqual(
    selectAnswerFollowUps({
      serverRequests: [a, b],
      local: undefined,
      closedIds: undefined,
      objectiveId: 'objective-2'
    }).map(r => r.id),
    ['b']
  );
});
