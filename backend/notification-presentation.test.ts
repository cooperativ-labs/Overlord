import assert from 'node:assert/strict';
import test from 'node:test';

import { notificationBody, notificationSubject } from './notification-presentation.ts';

test('a mission-scoped notification keeps the mission form', () => {
  const subject = notificationSubject({
    missionDisplayId: 'coo:756',
    missionTitle: 'Objective-centric execution'
  });
  assert.equal(subject.objectiveDisplayId, null);
  assert.equal(
    notificationBody(subject, 'is ready for review'),
    'coo:756: Objective-centric execution is ready for review'
  );
});

test('an objective-scoped notification leads with the objective', () => {
  const subject = notificationSubject({
    missionDisplayId: 'coo:756',
    missionTitle: 'Objective-centric execution',
    objectiveDisplayKey: 'k7xm',
    objectiveTitle: 'Phase C: **Activity** surfaces'
  });
  assert.equal(subject.objectiveDisplayId, 'coo:756.k7xm');
  assert.equal(subject.missionDisplayId, 'coo:756');
  assert.equal(subject.missionTitle, 'Objective-centric execution');
  assert.equal(
    notificationBody(subject, 'started working'),
    'coo:756.k7xm: Phase C: Activity surfaces started working'
  );
});

test('an untitled objective keeps its own display id and borrows the mission label', () => {
  const subject = notificationSubject({
    missionDisplayId: 'coo:756',
    missionTitle: 'Objective-centric execution',
    objectiveDisplayKey: 'k7xm',
    objectiveTitle: null
  });
  assert.equal(
    notificationBody(subject, 'needs your input'),
    'coo:756.k7xm: Objective-centric execution needs your input'
  );
});
