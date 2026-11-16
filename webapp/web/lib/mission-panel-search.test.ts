import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  findObjectiveByRef,
  isLocallyPushedObjectiveDetail,
  OBJECTIVE_DETAIL_HISTORY_KEY,
  objectiveSearchFromLocation,
  parseDesktopMissionShellRoute,
  parseMissionPanelSearch,
  withObjectiveSearch,
  withoutObjectiveSearch
} from './mission-panel-search.ts';

test('objectiveSearchFromLocation accepts a query string or a parsed search object', () => {
  assert.equal(objectiveSearchFromLocation({ objective: 'coo:756.k7xm' }), 'coo:756.k7xm');
  assert.equal(objectiveSearchFromLocation('?objective=coo:756.k7xm'), 'coo:756.k7xm');
  assert.equal(objectiveSearchFromLocation('objective=coo:756.k7xm'), 'coo:756.k7xm');
  assert.equal(objectiveSearchFromLocation({}), undefined);
  assert.equal(objectiveSearchFromLocation(null), undefined);
});
test('parseMissionPanelSearch keeps a trimmed objective ref and drops junk', () => {
  assert.deepEqual(parseMissionPanelSearch({ objective: 'coo:756.k7xm' }), {
    objective: 'coo:756.k7xm'
  });
  assert.deepEqual(parseMissionPanelSearch({ objective: '  coo:756.k7xm  ' }), {
    objective: 'coo:756.k7xm'
  });
  assert.deepEqual(parseMissionPanelSearch({ objective: '' }), {});
  assert.deepEqual(parseMissionPanelSearch({ objective: 12 }), {});
  assert.deepEqual(parseMissionPanelSearch({}), {});
});

test('parseDesktopMissionShellRoute preserves the objective query the parser used to drop', () => {
  assert.deepEqual(parseDesktopMissionShellRoute('/user/missions/coo:756'), {
    missionId: 'coo:756',
    objectiveDisplayId: null
  });
  assert.deepEqual(parseDesktopMissionShellRoute('/user/missions/coo:756?objective=coo:756.k7xm'), {
    missionId: 'coo:756',
    objectiveDisplayId: 'coo:756.k7xm'
  });
  assert.equal(parseDesktopMissionShellRoute('/user/missions/coo:756.k7xm'), null);
  assert.equal(parseDesktopMissionShellRoute('/inbox/missions/coo:756'), null);
});

test('findObjectiveByRef accepts a display id or a UUID', () => {
  const objectives = [
    { id: 'uuid-1', displayId: 'coo:1.aaaa' },
    { id: 'uuid-2', displayId: 'coo:1.bbbb' }
  ];
  assert.equal(findObjectiveByRef(objectives, 'coo:1.bbbb')?.id, 'uuid-2');
  assert.equal(findObjectiveByRef(objectives, 'uuid-1')?.id, 'uuid-1');
  assert.equal(findObjectiveByRef(objectives, 'nope'), null);
  assert.equal(findObjectiveByRef(objectives, undefined), null);
});

test('withObjectiveSearch / withoutObjectiveSearch keep the other parameters', () => {
  assert.deepEqual(withObjectiveSearch({ tab: 'x' }, 'coo:1.aaaa'), {
    tab: 'x',
    objective: 'coo:1.aaaa'
  });
  assert.deepEqual(withoutObjectiveSearch({ tab: 'x', objective: 'coo:1.aaaa' }), { tab: 'x' });
});

test('isLocallyPushedObjectiveDetail reads only the explicit history marker', () => {
  assert.equal(isLocallyPushedObjectiveDetail({ [OBJECTIVE_DETAIL_HISTORY_KEY]: true }), true);
  assert.equal(isLocallyPushedObjectiveDetail({ [OBJECTIVE_DETAIL_HISTORY_KEY]: false }), false);
  assert.equal(isLocallyPushedObjectiveDetail({}), false);
  assert.equal(isLocallyPushedObjectiveDetail(null), false);
});
