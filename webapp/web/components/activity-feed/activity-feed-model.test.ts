import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
  ActivityFeedDeliveryItemDto,
  ActivityFeedItemDto,
  ActivityFeedQuestionItemDto,
  ActivityFeedRunItemDto
} from '../../../shared/contract.ts';

import {
  elapsedLabel,
  feedProjectOptions,
  filterFeedItems,
  relativeTime,
  truncationNote
} from './activity-feed-model.ts';

function base(overrides: Partial<ActivityFeedItemDto> = {}) {
  return {
    id: 'run:objective-1',
    kind: 'objective_run' as const,
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
    ...overrides
  };
}

function runItem(overrides: Partial<ActivityFeedRunItemDto> = {}): ActivityFeedRunItemDto {
  return {
    ...base(),
    kind: 'objective_run',
    state: 'executing',
    objectiveTitle: 'Build the feed',
    instructionPreview: 'Implement the feed',
    agentIdentifier: 'claude',
    modelIdentifier: 'opus',
    branch: 'coo-757',
    resourceKey: null,
    startedAt: '2026-08-17T11:00:00.000Z',
    latestEventSummary: null,
    latestEventAt: null,
    upcoming: [],
    ...overrides
  } as ActivityFeedRunItemDto;
}

function deliveryItem(): ActivityFeedDeliveryItemDto {
  return {
    ...base({
      id: 'delivery:delivery-1',
      kind: 'delivery',
      projectId: 'project-2',
      projectName: 'Latch',
      occurredAt: '2026-08-17T10:00:00.000Z'
    }),
    kind: 'delivery',
    objectiveTitle: 'Ship it',
    delivery: {
      id: 'delivery-1',
      missionId: 'mission-1',
      objectiveId: 'objective-1',
      sessionId: null,
      summary: 'Done.',
      verificationSummary: null,
      followUpNotes: null,
      report: {} as ActivityFeedDeliveryItemDto['delivery']['report'],
      deliveredAt: '2026-08-17T10:00:00.000Z',
      agentIdentifier: 'claude',
      modelIdentifier: null
    }
  } as ActivityFeedDeliveryItemDto;
}

function questionItem(): ActivityFeedQuestionItemDto {
  return {
    ...base({ id: 'ask:event-1', kind: 'blocking_question' }),
    kind: 'blocking_question',
    eventId: 'event-1',
    question: 'Which database?',
    agentIdentifier: 'claude',
    askedAt: '2026-08-17T12:00:00.000Z'
  } as ActivityFeedQuestionItemDto;
}

test('kind chips drop items whose kind is switched off', () => {
  const items = [runItem(), deliveryItem(), questionItem()];

  const onlyDeliveries = filterFeedItems(items, {
    kinds: new Set(['delivery']),
    projectId: null
  });

  assert.deepEqual(
    onlyDeliveries.map(item => item.id),
    ['delivery:delivery-1']
  );
});

test('an unknown kind is dropped rather than rendered blank', () => {
  const unknown = {
    ...base({ id: 'weather:1' }),
    kind: 'weather_report'
  } as unknown as ActivityFeedItemDto;

  const visible = filterFeedItems([runItem(), unknown], {
    kinds: new Set(['objective_run', 'weather_report']),
    projectId: null
  });

  assert.deepEqual(
    visible.map(item => item.id),
    ['run:objective-1']
  );
});

test('the project filter narrows to one project', () => {
  const visible = filterFeedItems([runItem(), deliveryItem()], {
    kinds: new Set(['objective_run', 'delivery']),
    projectId: 'project-2'
  });

  assert.deepEqual(
    visible.map(item => item.projectName),
    ['Latch']
  );
});

test('project options are ranked by how much activity each project has', () => {
  const options = feedProjectOptions([runItem(), questionItem(), deliveryItem()]);

  assert.deepEqual(
    options.map(option => [option.projectName, option.count]),
    [
      ['Overlord', 2],
      ['Latch', 1]
    ]
  );
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
  const items = [runItem(), deliveryItem()];

  assert.equal(
    truncationNote({ objective_run: 1, delivery: 5, blocking_question: 0 }, items),
    '4 older items not shown'
  );
  assert.equal(
    truncationNote({ objective_run: 1, delivery: 1, blocking_question: 0 }, items),
    null
  );
});
