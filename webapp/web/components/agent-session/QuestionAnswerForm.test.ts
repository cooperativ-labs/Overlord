import type { HumanAgentRequestDto } from '@overlord/contract';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiRequestError } from '../../lib/api.ts';

import {
  answerErrorText,
  answerNeedsFollowUp,
  answerOutcome,
  classifyAnswerError,
  deliveryStateText,
  isQuestionAnswerConflict,
  isQuestionDeliveryAnswerable,
  newerAnswerSnapshot,
  questionAllowsFreeText,
  questionReadOnlyReason
} from './question-answer-model.ts';

function request(overrides: Partial<HumanAgentRequestDto> = {}): HumanAgentRequestDto {
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

test('a control-plane approval is answerable only when the server says so (ADR 0094)', () => {
  const approval = (delivery: HumanAgentRequestDto['delivery']) =>
    request({
      kind: 'permission',
      allowsFreeText: false,
      options: [
        { optionId: 'allow', label: 'Allow once', kind: 'allow' },
        { optionId: 'deny', label: 'Deny', kind: 'deny' }
      ],
      delivery
    });
  assert.equal(
    isQuestionDeliveryAnswerable(
      approval({ mode: 'control_plane', reason: null, state: null, observedAt: null })
    ),
    true
  );
  const notOwner = approval({
    mode: 'read_only',
    reason: 'not_session_owner',
    state: null,
    observedAt: null
  });
  assert.equal(isQuestionDeliveryAnswerable(notOwner), false);
  assert.match(questionReadOnlyReason(notOwner), /launched this session/);
  const ended = approval({
    mode: 'read_only',
    reason: 'channel_ended',
    state: null,
    observedAt: null
  });
  assert.match(questionReadOnlyReason(ended), /session has ended/);
  assert.equal(questionAllowsFreeText(notOwner), false);
});

function answered(
  delivery: Partial<HumanAgentRequestDto['delivery']>,
  overrides: Partial<HumanAgentRequestDto> = {}
): HumanAgentRequestDto {
  return request({
    status: 'resolved',
    resolution: { text: 'Use option B' },
    resolvedAt: '2026-08-27T12:01:00.000Z',
    revision: 2,
    delivery: {
      mode: 'read_only',
      reason: 'request_closed',
      state: 'emitted',
      observedAt: null,
      stage: 'queued',
      attempt: 1,
      failureCode: null,
      failureMessage: null,
      canRedeliver: false,
      confirmationRequired: false,
      sessionState: 'running',
      ...delivery
    },
    ...overrides
  });
}

test('a recorded answer is never reported as delivered until Latch confirms it', () => {
  assert.equal(answerOutcome(request()), null, 'an open request has no answer outcome');
  for (const stage of ['recorded', 'queued', 'dispatched', 'some_future_stage']) {
    const outcome = answerOutcome(answered({ stage }));
    assert.equal(outcome?.tone, 'pending', stage);
    assert.doesNotMatch(outcome?.text ?? '', /Delivered/, stage);
    assert.equal(outcome?.canRedeliver, false, stage);
  }
  const confirmed = answerOutcome(answered({ stage: 'confirmed', state: 'applied' }));
  assert.equal(confirmed?.tone, 'confirmed');
  assert.match(confirmed?.text ?? '', /Delivered/);
  assert.equal(answerNeedsFollowUp(answered({ stage: 'confirmed' })), false);
  assert.equal(answerNeedsFollowUp(answered({ stage: 'queued' })), true);
  // An answered approval reports the supervisor's application the same way.
  const allowed = answered(
    { stage: 'recorded' },
    { kind: 'permission', resolution: { optionId: 'allow' } }
  );
  assert.equal(answerOutcome(allowed)?.tone, 'pending');
  assert.equal(
    answerOutcome(answered({ stage: 'confirmed' }, { kind: 'permission' }))?.tone,
    'confirmed'
  );
});

test('failed and unconfirmed deliveries expose the server recovery, guarded for ambiguity', () => {
  const failed = answerOutcome(
    answered({
      stage: 'failed',
      state: 'not_applied',
      failureCode: 'gateway_unavailable',
      failureMessage: 'The Latch gateway is not answering.',
      canRedeliver: true
    })
  );
  assert.equal(failed?.tone, 'failed');
  assert.equal(failed?.detail, 'The Latch gateway is not answering.');
  assert.equal(failed?.canRedeliver, true);
  assert.equal(failed?.confirmationRequired, false);
  assert.equal(failed?.attempt, 1);

  const unconfirmed = answerOutcome(
    answered({
      stage: 'unconfirmed',
      state: 'unknown',
      canRedeliver: true,
      confirmationRequired: true,
      attempt: 2
    })
  );
  assert.equal(unconfirmed?.tone, 'unconfirmed');
  assert.equal(unconfirmed?.confirmationRequired, true);
  assert.match(unconfirmed?.text ?? '', /may have arrived/);
  assert.equal(unconfirmed?.attempt, 2);

  const ended = answerOutcome(
    answered({ stage: 'failed', canRedeliver: false, sessionState: 'exited' })
  );
  assert.equal(ended?.canRedeliver, false);
});

test('an older server without delivery.stage falls back to the legacy state', () => {
  const legacy = (state: HumanAgentRequestDto['delivery']['state']) =>
    request({
      status: 'resolved',
      delivery: { mode: 'read_only', reason: 'request_closed', state, observedAt: null }
    });
  assert.equal(answerOutcome(legacy('applied'))?.tone, 'confirmed');
  assert.equal(answerOutcome(legacy('not_applied'))?.tone, 'failed');
  assert.equal(answerOutcome(legacy('unknown'))?.tone, 'unconfirmed');
  assert.equal(answerOutcome(legacy('emitted'))?.tone, 'pending');
  assert.equal(answerOutcome(legacy('unknown'))?.canRedeliver, false);
});

test('refusals are classified by code, not by HTTP status alone', () => {
  assert.equal(
    classifyAnswerError(
      new ApiRequestError(
        'The terminal session has ended, so it cannot receive an answer.',
        409,
        'request_not_deliverable'
      )
    ),
    'not_deliverable'
  );
  assert.equal(
    isQuestionAnswerConflict(
      new ApiRequestError('The execution machine is offline.', 409, 'request_not_deliverable')
    ),
    false,
    'an offline or ended session is not "someone answered first"'
  );
  assert.equal(
    classifyAnswerError(new ApiRequestError('x', 409, 'agent_request_delivery_conflict')),
    'delivery_conflict'
  );
  assert.equal(
    classifyAnswerError(new ApiRequestError('x', 409, 'delivery_confirmation_required')),
    'confirmation_required'
  );
  assert.equal(classifyAnswerError(new ApiRequestError('x', 409)), 'lost_race');
  assert.equal(classifyAnswerError(new ApiRequestError('boom', 500, 'internal')), 'error');
  assert.match(
    answerErrorText(
      new ApiRequestError('The execution machine is offline.', 409, 'request_not_deliverable')
    ),
    /offline/
  );
});

test('the newer copy of an answer wins: revision, then attempt, then settled over pending', () => {
  const pending = answered({ stage: 'dispatched' });
  const confirmed = answered({ stage: 'confirmed' });
  assert.equal(newerAnswerSnapshot(confirmed, pending), confirmed);
  assert.equal(newerAnswerSnapshot(pending, confirmed), confirmed);
  const retry = answered({ stage: 'queued', attempt: 2 }, { revision: 3 });
  const oldFailure = answered({ stage: 'failed', attempt: 1 });
  assert.equal(newerAnswerSnapshot(oldFailure, retry), retry);
  assert.equal(newerAnswerSnapshot(retry, oldFailure), retry);
  assert.equal(newerAnswerSnapshot(null, pending), pending);
});
