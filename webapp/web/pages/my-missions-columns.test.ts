import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MissionDto, ProjectStatusDto } from '../../shared/contract.ts';

import {
  buildMergedStatusColumns,
  groupMissionsByMergedColumn,
  resolveMergedColumnReorder
} from './my-missions-columns.ts';

function status(
  projectId: string,
  id: string,
  name: string,
  position: number,
  type: ProjectStatusDto['type'] = 'draft'
): ProjectStatusDto {
  return {
    id,
    workspaceId: 'ws',
    projectId,
    key: id,
    name,
    type,
    position,
    isDefault: false,
    isTerminal: false
  };
}

// The merge/group helpers only read id/statusId/workspaceId, so a partial cast
// keeps the fixtures readable without fabricating a whole MissionDto.
function mission(id: string, projectId: string, statusId: string): MissionDto {
  return { id, projectId, statusId } as unknown as MissionDto;
}

describe('buildMergedStatusColumns', () => {
  it('deduplicates like-named statuses across projects into one column', () => {
    const statuses = new Map<string, ProjectStatusDto[]>([
      [
        'project-a',
        [status('project-a', 'a-todo', 'Todo', 1), status('project-a', 'a-done', 'Done', 2)]
      ],
      [
        'project-b',
        [status('project-b', 'b-todo', 'todo', 1), status('project-b', 'b-done', 'Done', 2)]
      ]
    ]);

    const merged = buildMergedStatusColumns(['project-a', 'project-b'], statuses);

    assert.deepEqual(
      merged.columns.map(column => column.key),
      ['todo', 'done']
    );
    const todo = merged.byKey.get('todo');
    assert.ok(todo);
    // First-seen project owns the display casing.
    assert.equal(todo.name, 'Todo');
    assert.equal(todo.statusIdByProject.get('project-a'), 'a-todo');
    assert.equal(todo.statusIdByProject.get('project-b'), 'b-todo');
    assert.equal(merged.keyByStatusId.get('b-todo'), 'todo');
  });

  it('appends a status only one project has after the shared columns', () => {
    const statuses = new Map<string, ProjectStatusDto[]>([
      ['project-a', [status('project-a', 'a-todo', 'Todo', 1)]],
      [
        'project-b',
        [status('project-b', 'b-todo', 'Todo', 1), status('project-b', 'b-review', 'Review', 2)]
      ]
    ]);

    const merged = buildMergedStatusColumns(['project-a', 'project-b'], statuses);

    assert.deepEqual(
      merged.columns.map(column => column.key),
      ['todo', 'review']
    );
    const review = merged.byKey.get('review');
    assert.ok(review);
    assert.equal(review.statusIdByProject.has('project-a'), false);
    assert.equal(review.statusIdByProject.get('project-b'), 'b-review');
  });

  it('orders each project by status position before merging', () => {
    const statuses = new Map<string, ProjectStatusDto[]>([
      [
        'project-a',
        [status('project-a', 'a-done', 'Done', 3), status('project-a', 'a-todo', 'Todo', 1)]
      ]
    ]);

    const merged = buildMergedStatusColumns(['project-a'], statuses);

    assert.deepEqual(
      merged.columns.map(column => column.key),
      ['todo', 'done']
    );
  });
});

describe('groupMissionsByMergedColumn', () => {
  it('buckets missions into merged columns and preserves server order', () => {
    const statuses = new Map<string, ProjectStatusDto[]>([
      ['project-a', [status('project-a', 'a-todo', 'Todo', 1)]],
      ['project-b', [status('project-b', 'b-todo', 'todo', 1)]]
    ]);
    const merged = buildMergedStatusColumns(['project-a', 'project-b'], statuses);

    const missions = [
      mission('m1', 'project-a', 'a-todo'),
      mission('m2', 'project-b', 'b-todo'),
      mission('m3', 'project-a', 'a-todo')
    ];

    const { columns, uncategorized } = groupMissionsByMergedColumn(missions, merged.keyByStatusId);

    assert.deepEqual(columns['todo'], ['m1', 'm2', 'm3']);
    assert.deepEqual(uncategorized, []);
  });

  it('drops missions with an unknown status into the uncategorized bucket', () => {
    const merged = buildMergedStatusColumns(
      ['project-a'],
      new Map([['project-a', [status('project-a', 'a-todo', 'Todo', 1)]]])
    );

    const { columns, uncategorized } = groupMissionsByMergedColumn(
      [mission('m1', 'project-a', 'deleted-status')],
      merged.keyByStatusId
    );

    assert.deepEqual(uncategorized, ['m1']);
    assert.equal(Object.keys(columns).length, 0);
  });
});

describe('resolveMergedColumnReorder', () => {
  const statuses = new Map<string, ProjectStatusDto[]>([
    [
      'project-a',
      [status('project-a', 'a-todo', 'Todo', 1), status('project-a', 'a-review', 'Review', 2)]
    ],
    ['project-b', [status('project-b', 'b-todo', 'Todo', 1)]]
  ]);
  const merged = buildMergedStatusColumns(['project-a', 'project-b'], statuses);

  it('resolves to the moved card project status and its own project slice', () => {
    const missions = [
      mission('m1', 'project-a', 'a-todo'),
      mission('m2', 'project-b', 'b-todo'),
      mission('m3', 'project-a', 'a-todo')
    ];
    const missionById = new Map(missions.map(m => [m.id, m]));
    const column = merged.byKey.get('todo');
    assert.ok(column);

    const plan = resolveMergedColumnReorder(
      column,
      missionById.get('m3')!,
      ['m1', 'm2', 'm3'],
      missionById
    );

    assert.ok(plan);
    // Targets project-a's To Do status, carrying only project-a's missions in order.
    assert.equal(plan.statusId, 'a-todo');
    assert.deepEqual(plan.orderedMissionIds, ['m1', 'm3']);
  });

  it('returns null when the column does not exist in the card project', () => {
    const review = merged.byKey.get('review');
    assert.ok(review);
    // "Review" exists only in project-a; a project-b card cannot move there.
    const projectBCard = mission('m2', 'project-b', 'b-todo');
    const plan = resolveMergedColumnReorder(
      review,
      projectBCard,
      ['m2'],
      new Map([['m2', projectBCard]])
    );
    assert.equal(plan, null);
  });
});
