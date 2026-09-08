import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { InboxItemDto, InboxMissionDto } from '../../../shared/contract.ts';

import {
  dueDatetimeForDayOffset,
  dueDayOffset,
  dueSoonLabel,
  groupInboxTasks,
  overdueLabel
} from './inbox-task-groups.ts';

const NOW = new Date('2026-09-07T15:00:00.000Z');

function item(overrides: Partial<InboxItemDto> & { id: string }): InboxItemDto {
  return {
    title: overrides.id,
    objectives: [overrides.id],
    dueDatetime: null,
    priority: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  };
}

function mission(overrides: Partial<InboxMissionDto> & { id: string }): InboxMissionDto {
  return {
    dueDatetime: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    reasons: ['agent_next'],
    ...overrides
  } as InboxMissionDto;
}

describe('Inbox task grouping', () => {
  it('measures whole UTC days between today and a due date', () => {
    assert.equal(dueDayOffset('2026-09-07T00:30:00.000Z', NOW), 0);
    assert.equal(dueDayOffset('2026-09-08T23:59:00.000Z', NOW), 1);
    assert.equal(dueDayOffset('2026-09-05T12:00:00.000Z', NOW), -2);
    assert.equal(dueDayOffset(null, NOW), null);
    assert.equal(dueDayOffset('not a date', NOW), null);
  });

  it('labels overdue and due-soon rows against the same boundaries', () => {
    assert.equal(overdueLabel('2026-09-06T12:00:00.000Z', NOW), 'Overdue 1 day');
    assert.equal(overdueLabel('2026-09-01T12:00:00.000Z', NOW), 'Overdue 6 days');
    assert.equal(overdueLabel('2026-09-07T12:00:00.000Z', NOW), null);
    assert.equal(dueSoonLabel('2026-09-07T12:00:00.000Z', NOW), 'Due today');
    assert.equal(dueSoonLabel('2026-09-08T12:00:00.000Z', NOW), 'Due tomorrow');
    assert.equal(dueSoonLabel('2026-09-09T12:00:00.000Z', NOW), null);
  });

  it('buckets captures and missions by due state in display order', () => {
    const groups = groupInboxTasks({
      now: NOW,
      items: [
        item({ id: 'undated' }),
        item({ id: 'later', dueDatetime: '2026-09-12T12:00:00.000Z' }),
        item({ id: 'today', dueDatetime: '2026-09-07T12:00:00.000Z' }),
        item({ id: 'overdue', dueDatetime: '2026-09-04T12:00:00.000Z' })
      ],
      missions: [
        mission({ id: 'm-next' }),
        mission({
          id: 'm-tomorrow',
          dueDatetime: '2026-09-08T12:00:00.000Z',
          reasons: ['due_soon']
        })
      ]
    });

    assert.deepEqual(
      groups.map(group => [group.key, group.rows.map(row => row.id)]),
      [
        ['overdue', ['overdue']],
        ['today', ['today']],
        ['tomorrow', ['m-tomorrow']],
        ['later', ['later']],
        ['no_date', ['undated']],
        ['agent_next', ['m-next']]
      ]
    );
  });

  it('omits empty buckets and excluded captures', () => {
    const groups = groupInboxTasks({
      now: NOW,
      items: [item({ id: 'hidden' }), item({ id: 'shown' })],
      missions: [],
      excludeItemIds: new Set(['hidden'])
    });
    assert.deepEqual(
      groups.map(group => [group.key, group.rows.map(row => row.id)]),
      [['no_date', ['shown']]]
    );
  });

  it('sorts overdue most-recently-missed first and other buckets soonest first', () => {
    const groups = groupInboxTasks({
      now: NOW,
      items: [
        item({ id: 'missed-long-ago', dueDatetime: '2026-08-20T12:00:00.000Z' }),
        item({ id: 'missed-yesterday', dueDatetime: '2026-09-06T12:00:00.000Z' }),
        item({ id: 'in-a-month', dueDatetime: '2026-10-07T12:00:00.000Z' }),
        item({ id: 'in-a-week', dueDatetime: '2026-09-14T12:00:00.000Z' })
      ],
      missions: []
    });
    assert.deepEqual(
      groups[0]?.rows.map(row => row.id),
      ['missed-yesterday', 'missed-long-ago']
    );
    assert.deepEqual(
      groups[1]?.rows.map(row => row.id),
      ['in-a-week', 'in-a-month']
    );
  });

  it('puts newest captures first and captures ahead of missions within a tie', () => {
    const groups = groupInboxTasks({
      now: NOW,
      items: [
        item({ id: 'old', createdAt: '2026-09-01T00:00:00.000Z' }),
        item({ id: 'new', createdAt: '2026-09-06T00:00:00.000Z' })
      ],
      missions: [
        mission({ id: 'm-today', dueDatetime: '2026-09-07T12:00:00.000Z', reasons: ['due_soon'] })
      ].concat([])
    });
    assert.deepEqual(
      groups.map(g => g.key),
      ['today', 'no_date']
    );
    assert.deepEqual(
      groups[1]?.rows.map(row => row.id),
      ['new', 'old']
    );

    const tied = groupInboxTasks({
      now: NOW,
      items: [item({ id: 'task-today', dueDatetime: '2026-09-07T12:00:00.000Z' })],
      missions: [
        mission({ id: 'm-today', dueDatetime: '2026-09-07T12:00:00.000Z', reasons: ['due_soon'] })
      ]
    });
    assert.deepEqual(
      tied[0]?.rows.map(row => row.id),
      ['task-today', 'm-today']
    );
  });

  it('builds quick-add presets at noon UTC so they match picked dates', () => {
    assert.equal(dueDatetimeForDayOffset(0, NOW), '2026-09-07T12:00:00.000Z');
    assert.equal(dueDatetimeForDayOffset(1, NOW), '2026-09-08T12:00:00.000Z');
    assert.equal(dueDayOffset(dueDatetimeForDayOffset(1, NOW), NOW), 1);
  });
});
