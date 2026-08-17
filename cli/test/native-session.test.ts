import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveNativeSessionId, writeNativeSessionId } from '../src/native-session.ts';

function withTempHome(run: () => void): void {
  const previous = process.env.OVLD_HOME;
  process.env.OVLD_HOME = mkdtempSync(path.join(tmpdir(), 'ovld-native-session-'));
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

test('native session cache scopes per objective and falls back to mission-only', () => {
  withTempHome(() => {
    writeNativeSessionId({
      agent: 'cursor',
      missionId: 'coo:1',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:1.aaaa',
      externalSessionId: 'native-a'
    });
    writeNativeSessionId({
      agent: 'cursor',
      missionId: 'coo:1',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:1.bbbb',
      externalSessionId: 'native-b'
    });

    assert.equal(
      resolveNativeSessionId({
        agent: 'cursor',
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.aaaa'
      }),
      'native-a'
    );
    assert.equal(
      resolveNativeSessionId({
        agent: 'cursor',
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.bbbb'
      }),
      'native-b'
    );
    assert.equal(
      resolveNativeSessionId({
        agent: 'cursor',
        missionId: 'coo:1',
        workingDirectory: '/repo/one'
      }),
      'native-b'
    );
  });
});
