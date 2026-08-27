import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { AgentRequestDto } from '../../../shared/contract.ts';
import { ApiRequestError } from '../../lib/api.ts';

import {
  deliveryStateText,
  isQuestionAnswerConflict,
  isQuestionDeliveryAnswerable,
  questionAllowsFreeText,
  questionReadOnlyReason
} from './question-answer-model.ts';

function request(overrides: Partial<AgentRequestDto> = {}): AgentRequestDto {
  return {
    id: 'request-1',
    channelId: 'channel-1',
    missionId: 'mission-1',
    objectiveId: 'objective-1',
    kind: 'question',
    summary: 'Which option should I use?',
    options: [],
    allowsFreeText: true,
    status: 'open',
    resolution: null,
    revision: 1,
    windowExpiresAt: null,
    releasedReason: null,
    applicationState: 'emitted',
    delivery: { mode: 'latch', reason: null, state: null, observedAt: null },
    resolvedAt: null,
    createdAt: '2026-08-27T12:00:00.000Z',
    ...overrides
  };
}

test('Latch delivery gates the reusable answer form', () => {
  assert.equal(isQuestionDeliveryAnswerable(request()), true);
  assert.equal(
    isQuestionDeliveryAnswerable(
      request({
        delivery: { mode: 'read_only', reason: 'no_latch_session', state: null, observedAt: null }
      })
    ),
    false
  );
  assert.match(
    questionReadOnlyReason(
      request({
        delivery: { mode: 'read_only', reason: 'no_latch_session', state: null, observedAt: null }
      })
    ),
    /isn't running in Latch/
  );
});

test('the form offers prose only when the request accepts it', () => {
  assert.equal(
    questionAllowsFreeText(request({ options: [{ optionId: 'a', label: 'A', kind: 'choice' }] })),
    true
  );
  assert.equal(
    questionAllowsFreeText(
      request({
        kind: 'choice',
        allowsFreeText: false,
        options: [{ optionId: 'a', label: 'A', kind: 'choice' }]
      })
    ),
    false
  );
});

test('CAS conflicts remain a lost-race condition and delivery copy is explicit', () => {
  assert.equal(
    isQuestionAnswerConflict(
      new ApiRequestError('Already answered', 409, 'agent_request_conflict')
    ),
    true
  );
  assert.equal(deliveryStateText('emitted'), 'Sending to the agent…');
  assert.equal(deliveryStateText('applied'), 'Delivered');
  assert.match(deliveryStateText('unknown') ?? '', /Do not send/);
});
