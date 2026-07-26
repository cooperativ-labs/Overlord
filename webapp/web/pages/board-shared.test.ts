import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMissionProjectFilterOptions } from './board-shared.ts';

function mission(projectId: string, projectName: string, projectColor: string | null = null) {
  return { projectId, projectName, projectColor };
}

describe('buildMissionProjectFilterOptions', () => {
  it('omits projects that are not in the active project list', () => {
    const options = buildMissionProjectFilterOptions(
      [mission('p1', 'Alpha'), mission('p2', 'Archived One'), mission('p1', 'Alpha')],
      new Set(['p1'])
    );
    assert.deepEqual(
      options.map(option => option.id),
      ['p1']
    );
  });

  it('dedupes by project and sorts by name', () => {
    const options = buildMissionProjectFilterOptions(
      [
        mission('p2', 'Zeta', '#111'),
        mission('p1', 'Alpha', '#222'),
        mission('p2', 'Zeta', '#111')
      ],
      new Set(['p1', 'p2'])
    );
    assert.deepEqual(options, [
      { id: 'p1', name: 'Alpha', color: '#222' },
      { id: 'p2', name: 'Zeta', color: '#111' }
    ]);
  });

  it('returns nothing when no projects are active', () => {
    assert.deepEqual(buildMissionProjectFilterOptions([mission('p1', 'Alpha')], new Set()), []);
  });
});
