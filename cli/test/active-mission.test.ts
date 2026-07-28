import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearActiveMissionPointer,
  readActiveMissionPointer,
  writeActiveMissionPointer
} from '../src/active-mission.ts';

function withTempHome(run: () => void): void {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = mkdtempSync(path.join(tmpdir(), 'ovld-active-mission-'));
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

test('active-mission pointer round-trips for a working directory', () => {
  withTempHome(() => {
    const workingDirectory = '/repo/one';
    assert.equal(readActiveMissionPointer(workingDirectory), undefined);

    writeActiveMissionPointer({
      workingDirectory,
      missionId: 'bc3ae6cd-77ca-4b4d-95b3-728198379963',
      displayId: 'coo:502',
      title: 'Investigate linking'
    });

    assert.deepEqual(readActiveMissionPointer(workingDirectory), {
      missionId: 'bc3ae6cd-77ca-4b4d-95b3-728198379963',
      displayId: 'coo:502',
      title: 'Investigate linking',
      updatedAt: readActiveMissionPointer(workingDirectory)!.updatedAt
    });
    assert.ok(readActiveMissionPointer(workingDirectory)!.updatedAt);

    clearActiveMissionPointer(workingDirectory);
    assert.equal(readActiveMissionPointer(workingDirectory), undefined);
  });
});

test('active-mission pointer keys on the resolved working directory', () => {
  withTempHome(() => {
    writeActiveMissionPointer({
      workingDirectory: '/repo/app',
      missionId: 'm-1',
      displayId: 'coo:1',
      title: 'One'
    });
    assert.equal(readActiveMissionPointer('/repo/sub/../app')?.displayId, 'coo:1');
    assert.equal(readActiveMissionPointer('/repo/other'), undefined);
  });
});

test('blank ids are never persisted', () => {
  withTempHome(() => {
    writeActiveMissionPointer({
      workingDirectory: '/repo/blank',
      missionId: '   ',
      displayId: 'coo:9'
    });
    assert.equal(readActiveMissionPointer('/repo/blank'), undefined);
  });
});
