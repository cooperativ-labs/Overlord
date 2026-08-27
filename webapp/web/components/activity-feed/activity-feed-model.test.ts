import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ActivityFeedItemDto,
  ActivityFeedMissionItemDto,
  ActivityFeedQuestionItemDto
} from '../../../shared/contract.ts';

import {
  elapsedLabel,
  feedProjectOptions,
  filterFeedItems,
  isInFlightObjectiveState,
  relativeTime,
  truncationNote
} from './activity-feed-model.ts';

function base(overrides: Partial<ActivityFeedItemDto> = {}) {
  return {
    id: 'mission:mission-1',
    kind: 'mission_run' as const,
    occurredAt: '2026-08-17T12:00:00.000Z',
    workspaceId: 'workspace-1',
    workspaceName: 'Core',
    projectId: 'project-1',
    projectName: 'Overlord',
    projectColor: '#336699',
    missionId: 'mission-1',
    missionDisplayId: 'coo:757',
    missionTitle: 'Display objective events',
    objectiveId: 'objective-1',
    objectiveDisplayId: 'coo:757.hegz',
    createdByKind: 'human' as const,
    createdByAgent: null,
    ...overrides
  };
}

function missionItem(
  overrides: Partial<ActivityFeedMissionItemDto> = {}
): ActivityFeedMissionItemDto {
  return {
    ...base(),
    kind: 'mission_run',
    runState: 'executing',
    objectives: [
      {
        objectiveId: 'objective-1',
        displayId: 'coo:757.hegz',
        title: 'Build the feed',
        state: 'executing',
        position: 0,
        assignedAgent: 'claude',
        autoAdvance: false
      }
    ],
    activeObjectiveIds: ['objective-1'],
    objectiveTitle: 'Build the feed',
    instructionPreview: 'Implement the feed',
    agentIdentifier: 'claude',
    modelIdentifier: 'opus',
    branch: 'coo-757',
    resourceKey: null,
    startedAt: '2026-08-17T11:00:00.000Z',
    latestEventSummary: null,
    latestEventAt: null,
    ...overrides
  } as ActivityFeedMissionItemDto;
}

function questionItem(): ActivityFeedQuestionItemDto {
  return {
    ...base({ id: 'ask:event-1', kind: 'blocking_question' }),
    kind: 'blocking_question',
    eventId: 'event-1',
    agentRequestId: 'request-1',
    delivery: { mode: 'latch' },
    question: 'Which database?',
    agentIdentifier: 'claude',
    askedAt: '2026-08-17T12:00:00.000Z'
  } as ActivityFeedQuestionItemDto;
}

test('blocking questions preserve their answer request and delivery gate', () => {
  const item = questionItem();
  assert.equal(item.agentRequestId, 'request-1');
  assert.equal(item.delivery.mode, 'latch');
});

test('delivered missions are a first-class kind the chips can hide', () => {
  const delivered = missionItem({
    id: 'mission:mission-3',
    kind: 'mission_delivered',
    runState: 'delivered',
    activeObjectiveIds: []
  });

  const hidden = filterFeedItems([missionItem(), delivered], {
    kinds: new Set(['mission_run']),
    projectId: null
  });
  const shown = filterFeedItems([missionItem(), delivered], {
    kinds: new Set(['mission_delivered']),
    projectId: null
  });

  assert.deepEqual(
    hidden.map(item => item.id),
    ['mission:mission-1']
  );
  assert.deepEqual(
    shown.map(item => item.id),
    ['mission:mission-3']
  );
});

test('kind chips drop items whose kind is switched off', () => {
  const items = [missionItem(), questionItem()];

  const onlyQuestions = filterFeedItems(items, {
    kinds: new Set(['blocking_question']),
    projectId: null
  });

  assert.deepEqual(
    onlyQuestions.map(item => item.id),
    ['ask:event-1']
  );
});

test('an unknown kind is dropped rather than rendered blank', () => {
  const unknown = {
    ...base({ id: 'weather:1' }),
    kind: 'weather_report'
  } as unknown as ActivityFeedItemDto;

  const visible = filterFeedItems([missionItem(), unknown], {
    kinds: new Set(['mission_run', 'weather_report']),
    projectId: null
  });

  assert.deepEqual(
    visible.map(item => item.id),
    ['mission:mission-1']
  );
});

test('the project filter narrows to one project', () => {
  const other = missionItem({
    id: 'mission:mission-2',
    missionId: 'mission-2',
    projectId: 'project-2',
    projectName: 'Latch'
  });

  const visible = filterFeedItems([missionItem(), other], {
    kinds: new Set(['mission_run']),
    projectId: 'project-2'
  });

  assert.deepEqual(
    visible.map(item => item.projectName),
    ['Latch']
  );
});

test('project options are ranked by how much activity each project has', () => {
  const other = missionItem({
    id: 'mission:mission-2',
    missionId: 'mission-2',
    projectId: 'project-2',
    projectName: 'Latch'
  });

  const options = feedProjectOptions([missionItem(), questionItem(), other]);

  assert.deepEqual(
    options.map(option => [option.projectName, option.count]),
    [
      ['Overlord', 2],
      ['Latch', 1]
    ]
  );
});

test('executing and pending delivery are the states that read as live work', () => {
  assert.equal(isInFlightObjectiveState('executing'), true);
  assert.equal(isInFlightObjectiveState('pending_delivery'), true);
  assert.equal(isInFlightObjectiveState('launching'), false);
  assert.equal(isInFlightObjectiveState('complete'), false);
});

test('relative and elapsed labels read from the supplied clock, never the browser clock', () => {
  assert.equal(relativeTime('2026-08-17T11:59:30.000Z', '2026-08-17T12:00:00.000Z'), '30s ago');
  assert.equal(relativeTime('2026-08-17T09:00:00.000Z', '2026-08-17T12:00:00.000Z'), '3h ago');
  assert.equal(elapsedLabel('2026-08-17T11:00:00.000Z', '2026-08-17T12:05:00.000Z'), '1h 05m');
  assert.equal(elapsedLabel(null, '2026-08-17T12:00:00.000Z'), '');
});

test('a clock behind the item timestamp reports zero rather than negative elapsed time', () => {
  assert.equal(relativeTime('2026-08-17T12:00:10.000Z', '2026-08-17T12:00:00.000Z'), '0s ago');
});

test('truncation is reported from the pre-truncation counts', () => {
  const items = [missionItem(), questionItem()];

  assert.equal(
    truncationNote({ mission_run: 5, blocking_question: 1 }, items),
    '4 older items not shown'
  );
  assert.equal(truncationNote({ mission_run: 1, blocking_question: 1 }, items), null);
});
