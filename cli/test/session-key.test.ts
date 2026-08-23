import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  truncateSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearCachedSessionKey,
  readCachedSessionKey,
  writeCachedSessionKey
} from '../src/session-key.ts';

function withTempHome(run: (home: string) => void): void {
  const previous = process.env.OVLD_HOME;
  const home = mkdtempSync(path.join(tmpdir(), 'ovld-session-key-'));
  process.env.OVLD_HOME = home;
  try {
    run(home);
  } finally {
    if (previous === undefined) delete process.env.OVLD_HOME;
    else process.env.OVLD_HOME = previous;
  }
}

test('session key cache round-trips for an exact objective scope', () => {
  withTempHome(() => {
    const args = {
      missionId: 'coo:42',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:42.abcd'
    };
    assert.equal(readCachedSessionKey(args), undefined);

    writeCachedSessionKey({ ...args, sessionKey: 'sess_abc123' });
    assert.equal(readCachedSessionKey(args), 'sess_abc123');

    clearCachedSessionKey(args);
    assert.equal(readCachedSessionKey(args), undefined);
  });
});

test('session key files atomically tighten an existing cache directory to owner-only', () => {
  withTempHome(home => {
    const cacheDirectory = path.join(home, 'protocol-session-keys');
    mkdirSync(cacheDirectory, { mode: 0o777 });
    chmodSync(cacheDirectory, 0o777);
    writeCachedSessionKey({
      missionId: 'coo:42',
      workingDirectory: '/repo/private',
      objectiveId: 'coo:42.private',
      sessionKey: 'sess_private'
    });

    const files = readdirSync(cacheDirectory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^[a-f0-9]{64}$/);
    assert.equal(statSync(cacheDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(cacheDirectory, files[0]!)).mode & 0o777, 0o600);
  });
});

test('oversized session-key cache files are never parsed as credentials', () => {
  withTempHome(home => {
    const args = {
      missionId: 'coo:42',
      workingDirectory: '/repo/oversized',
      objectiveId: 'coo:42.oversized'
    };
    writeCachedSessionKey({ ...args, sessionKey: 'sess_private' });
    const cacheDirectory = path.join(home, 'protocol-session-keys');
    const [cacheName] = readdirSync(cacheDirectory);
    assert.ok(cacheName);
    truncateSync(path.join(cacheDirectory, cacheName), 4 * 1024 + 1);

    assert.equal(readCachedSessionKey(args), undefined);
  });
});

test('session key cache is scoped per mission and per working directory', () => {
  withTempHome(() => {
    writeCachedSessionKey({
      missionId: 'coo:1',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:1.abcd',
      sessionKey: 'sess_one'
    });

    // Same directory, different mission → no leak.
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:2',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:2.abcd'
      }),
      undefined
    );
    // Same mission, different directory → no leak.
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:1',
        workingDirectory: '/repo/two',
        objectiveId: 'coo:1.abcd'
      }),
      undefined
    );
    // Exact pair still resolves.
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.abcd'
      }),
      'sess_one'
    );
  });
});

test('cache keys on the canonical working directory across symlink aliases', () => {
  withTempHome(() => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'ovld-session-key-workspace-'));
    const workspaceAlias = `${workspace}-alias`;
    symlinkSync(workspace, workspaceAlias);
    writeCachedSessionKey({
      missionId: 'coo:7',
      workingDirectory: workspace,
      objectiveId: 'coo:7.abcd',
      sessionKey: 'sess_resolved'
    });
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:7',
        workingDirectory: workspaceAlias,
        objectiveId: 'coo:7.abcd'
      }),
      'sess_resolved'
    );
  });
});

test('session key cache scopes per objective without falling back across siblings', () => {
  withTempHome(() => {
    writeCachedSessionKey({
      missionId: 'coo:1',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:1.aaaa',
      sessionKey: 'sess_a'
    });
    writeCachedSessionKey({
      missionId: 'coo:1',
      workingDirectory: '/repo/one',
      objectiveId: 'coo:1.bbbb',
      sessionKey: 'sess_b'
    });

    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.aaaa'
      }),
      'sess_a'
    );
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.bbbb'
      }),
      'sess_b'
    );
    assert.equal(
      readCachedSessionKey({
        missionId: 'coo:1',
        workingDirectory: '/repo/one',
        objectiveId: 'coo:1.cccc'
      }),
      undefined
    );
  });
});

test('blank session keys are never persisted', () => {
  withTempHome(() => {
    const args = {
      missionId: 'coo:9',
      workingDirectory: '/repo/blank',
      objectiveId: 'coo:9.abcd'
    };
    writeCachedSessionKey({ ...args, sessionKey: '   ' });
    assert.equal(readCachedSessionKey(args), undefined);
  });
});

test('clearing by session key removes every objective alias but preserves sibling sessions', () => {
  withTempHome(() => {
    const common = { missionId: 'coo:1', workingDirectory: '/repo/parallel' };
    for (const objectiveId of ['coo:1.aaaa', '11111111-1111-4111-8111-111111111111']) {
      writeCachedSessionKey({
        ...common,
        objectiveId,
        sessionKey: 'sess_aliases'
      });
    }
    writeCachedSessionKey({
      ...common,
      objectiveId: 'coo:1.bbbb',
      sessionKey: 'sess_sibling'
    });

    clearCachedSessionKey({ ...common, sessionKey: 'sess_aliases' });

    assert.equal(readCachedSessionKey({ ...common, objectiveId: 'coo:1.aaaa' }), undefined);
    assert.equal(
      readCachedSessionKey({
        ...common,
        objectiveId: '11111111-1111-4111-8111-111111111111'
      }),
      undefined
    );
    assert.equal(readCachedSessionKey({ ...common, objectiveId: 'coo:1.bbbb' }), 'sess_sibling');
  });
});
