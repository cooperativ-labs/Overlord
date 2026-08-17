import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  objectiveMatchesFocus,
  objectiveSearchFromLocation,
  parseDesktopMissionShellRoute,
  parseMissionPanelSearch
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

test('objectiveMatchesFocus accepts a display id or a UUID', () => {
  const objective = { id: 'obj-uuid', displayId: 'coo:756.k7xm' };
  assert.equal(objectiveMatchesFocus({ objective, focusRef: 'coo:756.k7xm' }), true);
  assert.equal(objectiveMatchesFocus({ objective, focusRef: 'obj-uuid' }), true);
  assert.equal(objectiveMatchesFocus({ objective, focusRef: 'coo:756.zzzz' }), false);
  assert.equal(objectiveMatchesFocus({ objective, focusRef: undefined }), false);
});
