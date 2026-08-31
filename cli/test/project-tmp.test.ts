import assert from 'node:assert/strict';
import {
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ensureProjectTmpDir,
  PROJECT_TMP_RETENTION_MS,
  PROJECT_TMP_SESSION_RETENTION_MS,
  PROJECT_TMP_SESSIONS_DIRNAME,
  projectTmpDir,
  pruneProjectTmpContents,
  pruneStaleProjectTmp,
  removeSessionScratch,
  sessionScratchName
} from '../src/project-tmp.ts';

function makeProjectDir(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ovld-project-tmp-'));
  mkdirSync(path.join(directory, '.overlord'), { recursive: true });
  return directory;
}

test('ensureProjectTmpDir creates the shared project tmp directory', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  assert.equal(tmpDir, projectTmpDir(workingDirectory));
  assert.equal(statSync(tmpDir).isDirectory(), true);
});

test('pruneStaleProjectTmp removes only entries older than the retention window', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  const staleFile = path.join(tmpDir, 'stale.md');
  const freshFile = path.join(tmpDir, 'fresh.md');

  writeFileSync(staleFile, 'stale\n');
  writeFileSync(freshFile, 'fresh\n');

  const staleTime = new Date(Date.now() - PROJECT_TMP_RETENTION_MS - 60_000);
  utimesSync(staleFile, staleTime, staleTime);

  pruneStaleProjectTmp({ workingDirectory });

  assert.deepEqual(readdirSync(tmpDir).sort(), ['fresh.md']);
});

test('pruneStaleProjectTmp removes stale empty subdirectories and keeps fresh ones', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  const staleDir = path.join(tmpDir, 'stale-dir');
  const freshDir = path.join(tmpDir, 'fresh-dir');

  mkdirSync(staleDir, { recursive: true });
  mkdirSync(freshDir, { recursive: true });

  const staleTime = new Date(Date.now() - PROJECT_TMP_RETENTION_MS - 60_000);
  utimesSync(staleDir, staleTime, staleTime);

  pruneStaleProjectTmp({ workingDirectory });

  assert.deepEqual(readdirSync(tmpDir).sort(), ['fresh-dir']);
});

test('pruneStaleProjectTmp removes stale dangling symlinks by the link mtime', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  const staleLink = path.join(tmpDir, 'stale-alias');
  const freshLink = path.join(tmpDir, 'fresh-alias');

  symlinkSync(path.join(tmpDir, 'missing-target'), staleLink);
  symlinkSync(path.join(tmpDir, 'missing-target'), freshLink);

  const staleTime = new Date(Date.now() - PROJECT_TMP_RETENTION_MS - 60_000);
  lutimesSync(staleLink, staleTime, staleTime);

  pruneStaleProjectTmp({ workingDirectory });

  assert.deepEqual(readdirSync(tmpDir).sort(), ['fresh-alias']);
});

test('pruneStaleProjectTmp does not create .overlord/tmp unless asked to', () => {
  const workingDirectory = mkdtempSync(path.join(os.tmpdir(), 'ovld-project-no-tmp-'));
  pruneStaleProjectTmp({ workingDirectory });
  assert.equal(readdirSync(workingDirectory).length, 0);
});

test('pruneProjectTmpContents removes every entry regardless of age', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  writeFileSync(path.join(tmpDir, 'fresh.md'), 'fresh\n');
  mkdirSync(path.join(tmpDir, 'fresh-dir'), { recursive: true });

  const result = pruneProjectTmpContents(workingDirectory);

  assert.deepEqual(result, { warned: false, removedCount: 2, skippedCount: 0 });
  assert.deepEqual(readdirSync(tmpDir), []);
});

test('pruneProjectTmpContents is a no-op when .overlord/tmp does not exist', () => {
  const workingDirectory = makeProjectDir();
  const result = pruneProjectTmpContents(workingDirectory);
  assert.deepEqual(result, { warned: false, removedCount: 0, skippedCount: 0 });
});

test('pruneProjectTmpContents warns when there is no .overlord folder', () => {
  const workingDirectory = mkdtempSync(path.join(os.tmpdir(), 'ovld-project-no-overlord-'));
  const result = pruneProjectTmpContents(workingDirectory);
  assert.deepEqual(result, { warned: true, removedCount: 0, skippedCount: 0 });
});

test('pruneStaleProjectTmp keeps live session scratch and expires orphaned scratch after the session window', () => {
  const workingDirectory = makeProjectDir();
  const sessionsDir = path.join(
    ensureProjectTmpDir(workingDirectory),
    PROJECT_TMP_SESSIONS_DIRNAME
  );
  const live = path.join(sessionsDir, 'objective-coo-1-abcd-req1');
  const orphanOld = path.join(sessionsDir, 'objective-coo-2-efgh-req2');
  const orphanFresh = path.join(sessionsDir, 'objective-coo-3-ijkl-req3');
  for (const dir of [live, orphanOld, orphanFresh]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(live, 'scratch.txt'), 'x\n');

  const old = new Date(Date.now() - PROJECT_TMP_SESSION_RETENTION_MS - 60_000);
  utimesSync(live, old, old);
  utimesSync(orphanOld, old, old);

  pruneStaleProjectTmp({
    workingDirectory,
    isSessionLive: name => name.startsWith('objective-coo-1-abcd-')
  });

  assert.deepEqual(readdirSync(sessionsDir).sort(), [
    'objective-coo-1-abcd-req1',
    'objective-coo-3-ijkl-req3'
  ]);
});

test('removeSessionScratch removes only a direct child of sessions/ plus the briefing', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  const scratch = path.join(tmpDir, PROJECT_TMP_SESSIONS_DIRNAME, 'objective-coo-1-abcd-req1');
  mkdirSync(scratch, { recursive: true });
  writeFileSync(path.join(scratch, 'a.txt'), 'a\n');
  const briefing = path.join(tmpDir, 'objective-coo-1-abcd.md');
  writeFileSync(briefing, 'brief\n');
  const launchScript = path.join(tmpDir, 'launch-coo-1-req1.sh');
  writeFileSync(launchScript, '#!/bin/sh\n');

  // Refuses anything that is not a session scratch directory.
  assert.deepEqual(removeSessionScratch({ workingDirectory, scratchDir: tmpDir }).removed, []);
  assert.deepEqual(removeSessionScratch({ workingDirectory, scratchDir: os.tmpdir() }).removed, []);

  const result = removeSessionScratch({
    workingDirectory,
    scratchDir: scratch,
    contextFile: briefing
  });
  assert.deepEqual(result.removed.sort(), [briefing, scratch].sort());
  assert.deepEqual(readdirSync(tmpDir).sort(), [
    'launch-coo-1-req1.sh',
    PROJECT_TMP_SESSIONS_DIRNAME
  ]);
});

test('pruneProjectTmpContents keeps live session scratch unless forced', () => {
  const workingDirectory = makeProjectDir();
  const tmpDir = ensureProjectTmpDir(workingDirectory);
  const sessionsDir = path.join(tmpDir, PROJECT_TMP_SESSIONS_DIRNAME);
  mkdirSync(path.join(sessionsDir, 'objective-coo-1-abcd-req1'), { recursive: true });
  mkdirSync(path.join(sessionsDir, 'objective-coo-2-efgh-req2'), { recursive: true });
  writeFileSync(path.join(tmpDir, 'stray.md'), 'x\n');
  const isSessionLive = (name: string) => name.startsWith('objective-coo-1-abcd-');

  const kept = pruneProjectTmpContents(workingDirectory, { isSessionLive });
  assert.equal(kept.skippedCount, 1);
  assert.deepEqual(readdirSync(sessionsDir), ['objective-coo-1-abcd-req1']);

  const forced = pruneProjectTmpContents(workingDirectory, { isSessionLive, force: true });
  assert.equal(forced.skippedCount, 0);
  assert.deepEqual(readdirSync(tmpDir), []);
});

test('sessionScratchName is keyed to objective and execution request', () => {
  assert.equal(
    sessionScratchName({
      missionDisplayId: 'coo:1',
      objectiveDisplayId: 'coo:1.ab_cd',
      executionRequestId: 'req/1'
    }),
    'objective-coo-1-ab_cd-req-1'
  );
  assert.equal(
    sessionScratchName({ missionDisplayId: 'coo:1', executionRequestId: 'r' }),
    'mission-coo-1-r'
  );
});
