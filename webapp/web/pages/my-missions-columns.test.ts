import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MissionDto, ProjectStatusDto, StatusType } from '../../shared/contract.ts';

import {
  groupMissionsByStatusType,
  isMyMissionsColumnKey,
  MY_MISSIONS_BOARD_COLUMNS,
  projectsMissingColumnType,
  resolveProjectStatusForColumn
} from './my-missions-columns.ts';

function status(
  projectId: string,
  id: string,
  name: string,
  position: number,
  type: StatusType
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

// The grouping helpers only read id/projectId/statusType, so a partial cast
// keeps the fixtures readable without fabricating a whole MissionDto.
function mission(id: string, projectId: string, statusType: StatusType): MissionDto {
  return { id, projectId, statusType } as unknown as MissionDto;
}

describe('MY_MISSIONS_BOARD_COLUMNS', () => {
  it('is exactly the four shared status types, in workflow order', () => {
    assert.deepEqual(
      MY_MISSIONS_BOARD_COLUMNS.map(column => column.key),
      ['next', 'execute', 'review', 'complete']
    );
    assert.deepEqual(
      MY_MISSIONS_BOARD_COLUMNS.map(column => column.name),
      ['Next', 'Executing', 'Review', 'Completed']
    );
  });

  it('recognizes only board status types as column keys', () => {
    assert.equal(isMyMissionsColumnKey('execute'), true);
    assert.equal(isMyMissionsColumnKey('draft'), false);
    assert.equal(isMyMissionsColumnKey('blocked'), false);
  });
});

describe('groupMissionsByStatusType', () => {
  it('buckets missions from every project by type and preserves server order', () => {
    const columns = groupMissionsByStatusType([
      mission('m1', 'project-a', 'execute'),
      mission('m2', 'project-b', 'execute'),
      mission('m3', 'project-a', 'next'),
      mission('m4', 'project-b', 'complete')
    ]);

    assert.deepEqual(columns['execute'], ['m1', 'm2']);
    assert.deepEqual(columns['next'], ['m3']);
    assert.deepEqual(columns['complete'], ['m4']);
    // Every column exists even when empty, so a card can be dropped into it.
    assert.deepEqual(columns['review'], []);
  });

  it('orders by personal myPosition within a type, then original order', () => {
    const columns = groupMissionsByStatusType([
      { ...mission('m1', 'project-a', 'next'), myPosition: 200 } as MissionDto,
      { ...mission('m2', 'project-a', 'next'), myPosition: 100 } as MissionDto,
      mission('m3', 'project-a', 'next')
    ]);
    assert.deepEqual(columns['next'], ['m2', 'm1', 'm3']);
  });

  it('places missions outside the board vocabulary in no column', () => {
    const columns = groupMissionsByStatusType([
      mission('m1', 'project-a', 'draft'),
      mission('m2', 'project-a', 'blocked'),
      mission('m3', 'project-a', 'cancelled')
    ]);

    assert.deepEqual(Object.values(columns).flat(), []);
  });
});

describe('resolveProjectStatusForColumn', () => {
  const statuses = [
    status('project-a', 'a-backlog', 'Backlog', 0, 'draft'),
    status('project-a', 'a-shipping', 'Shipping', 3, 'execute'),
    status('project-a', 'a-building', 'Building', 2, 'execute')
  ];

  it('picks the lowest-position status of the type, whatever its name', () => {
    assert.equal(resolveProjectStatusForColumn(statuses, 'execute'), 'a-building');
  });

  it('returns null when the project defines no status of the type', () => {
    assert.equal(resolveProjectStatusForColumn(statuses, 'review'), null);
  });
});

describe('projectsMissingColumnType', () => {
  const statusesByProject = new Map<string, ProjectStatusDto[]>([
    [
      'project-a',
      [
        status('project-a', 'a-next', 'Up Next', 1, 'next'),
        status('project-a', 'a-doing', 'Doing', 2, 'execute')
      ]
    ],
    ['project-b', [status('project-b', 'b-doing', 'In Progress', 2, 'execute')]]
  ]);

  it('names each project that cannot represent the target column', () => {
    const missing = projectsMissingColumnType(
      [mission('m1', 'project-a', 'execute'), mission('m2', 'project-b', 'execute')],
      'next',
      statusesByProject
    );
    assert.deepEqual(missing, ['project-b']);
  });

  it('ignores missions already in a status of the target type', () => {
    // project-b has no `next` status, but this card is not changing type.
    const missing = projectsMissingColumnType(
      [mission('m2', 'project-b', 'execute')],
      'execute',
      statusesByProject
    );
    assert.deepEqual(missing, []);
  });

  it('defers to the server for a project whose statuses are not loaded', () => {
    const missing = projectsMissingColumnType(
      [mission('m9', 'project-unknown', 'execute')],
      'review',
      statusesByProject
    );
    assert.deepEqual(missing, []);
  });
});
