import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { recoverLaunchBootstrapFromProjectTmp } from '../src/launch-bootstrap.ts';

function withTempCheckout<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ovld-launch-bootstrap-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeLaunchScript({
  root,
  missionId,
  requestId,
  channelId,
  mtimeMs
}: {
  root: string;
  missionId: string;
  requestId: string;
  channelId: string;
  mtimeMs?: number;
}): string {
  const tmpDir = path.join(root, '.overlord', 'tmp');
  mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `launch-${missionId.replace(/:/g, '-')}-${requestId}.sh`);
  writeFileSync(
    filePath,
    [
      '#!/usr/bin/env bash',
      `cd '${root}' && export MISSION_ID='${missionId}'; export OVERLORD_MISSION_ID='${missionId}'; export OVERLORD_OBJECTIVE_ID='${missionId}.k7xm'; export OVERLORD_EXECUTION_REQUEST_ID='${requestId}'; export OVERLORD_SESSION_CHANNEL_ID='${channelId}'; export OVERLORD_SESSION_LAUNCH_KIND='queued'; agent --prompt 'hi'`
    ].join('\n'),
    { mode: 0o700 }
  );
  if (mtimeMs !== undefined) {
    const atime = new Date(mtimeMs);
    const mtime = new Date(mtimeMs);
    utimesSync(filePath, atime, mtime);
  }
  return filePath;
}

test('recoverLaunchBootstrapFromProjectTmp reads channel and execution ids from the newest launch script', () => {
  withTempCheckout(root => {
    writeLaunchScript({
      root,
      missionId: 'coo:589',
      requestId: 'req-old',
      channelId: 'channel-old',
      mtimeMs: Date.now() - 60_000
    });
    writeLaunchScript({
      root,
      missionId: 'coo:589',
      requestId: 'req-new',
      channelId: 'channel-new',
      mtimeMs: Date.now()
    });

    const recovered = recoverLaunchBootstrapFromProjectTmp({
      workingDirectory: root,
      missionId: 'coo:589'
    });
    assert.equal(recovered.sessionChannelId, 'channel-new');
    assert.equal(recovered.executionRequestId, 'req-new');
    assert.equal(recovered.objectiveId, 'coo:589.k7xm');
    assert.ok(recovered.sourcePath?.includes('req-new'));
  });
});

test('recoverLaunchBootstrapFromProjectTmp ignores other missions and missing tmp', () => {
  withTempCheckout(root => {
    writeLaunchScript({
      root,
      missionId: 'coo:1',
      requestId: 'req-1',
      channelId: 'channel-1'
    });
    assert.deepEqual(
      recoverLaunchBootstrapFromProjectTmp({ workingDirectory: root, missionId: 'coo:589' }),
      { sessionChannelId: null, executionRequestId: null, objectiveId: null, sourcePath: null }
    );
    assert.deepEqual(
      recoverLaunchBootstrapFromProjectTmp({
        workingDirectory: path.join(root, 'missing'),
        missionId: 'coo:1'
      }),
      { sessionChannelId: null, executionRequestId: null, objectiveId: null, sourcePath: null }
    );
  });
});
