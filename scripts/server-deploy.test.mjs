import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { createStamp, SKIP_GATE_FLAG, writeStamp } from './release-gate.mjs';
import { main, parseDeployArgs, railwayCommand } from './server-deploy.mjs';

const HEAD = 'c'.repeat(40);

// A git stand-in: a committed HEAD and a configurable working-tree status.
function fakeGit(status = '') {
  return { head: () => HEAD, status: () => status };
}

describe('server:deploy arguments', () => {
  it('keeps its own flags and passes everything else to railway up', () => {
    assert.deepEqual(parseDeployArgs(['--dry-run', '--service', 'overlord-backend', '--detach']), {
      dryRun: true,
      help: false,
      gateArgs: [],
      railwayArgs: ['--service', 'overlord-backend', '--detach']
    });
    assert.deepEqual(parseDeployArgs([SKIP_GATE_FLAG, '--', '--dry-run', '--ci']), {
      dryRun: false,
      help: false,
      gateArgs: [SKIP_GATE_FLAG],
      railwayArgs: ['--dry-run', '--ci']
    });
  });

  it('runs the Railway CLI unless OVERLORD_RAILWAY_BIN overrides it', () => {
    assert.deepEqual(railwayCommand({ env: {}, railwayArgs: ['--detach'] }), {
      file: 'railway',
      args: ['up', '--detach']
    });
    assert.equal(
      railwayCommand({ env: { OVERLORD_RAILWAY_BIN: '/opt/railway' }, railwayArgs: [] }).file,
      '/opt/railway'
    );
  });
});

describe('server:deploy gate', () => {
  let root = '';
  const logs = [];
  const spawned = [];
  const spawn = (file, args, options) => {
    spawned.push({ file, args, cwd: options.cwd });
    return { status: 0 };
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'server-deploy-'));
    logs.length = 0;
    spawned.length = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function deploy(argv, { status = '', env = {} } = {}) {
    return main({ argv, env, root, git: fakeGit(status), spawn, log: line => logs.push(line) });
  }

  function stampHead() {
    writeStamp(
      root,
      createStamp({
        sha: HEAD,
        impact: 'none',
        contractVersion: '169.2.1',
        openapiVersion: '2.2.0',
        rangeStart: 'd'.repeat(40),
        rangeStartSource: 'production-tag'
      })
    );
  }

  it('refuses without a stamp for HEAD and never runs railway', () => {
    assert.throws(
      () => deploy([]),
      /server:deploy refused by the release gate[\s\S]*No release stamp/
    );
    assert.equal(spawned.length, 0);
  });

  it('refuses a dirty tree even with a matching stamp', () => {
    stampHead();
    assert.throws(() => deploy([], { status: '?? notes.txt\n' }), /not clean/);
    assert.equal(spawned.length, 0);
  });

  it('runs railway up from the repository root once the stamp matches', () => {
    stampHead();
    const result = deploy(['--service', 'overlord-backend']);
    assert.equal(result.ran, true);
    assert.deepEqual(spawned, [
      { file: 'railway', args: ['up', '--service', 'overlord-backend'], cwd: root }
    ]);
  });

  it('dry run prints the command, reports a refusal, and runs nothing', () => {
    const result = deploy(['--dry-run', '--detach']);
    assert.equal(result.ran, false);
    assert.equal(spawned.length, 0);
    assert.ok(
      logs.includes('Dry run: no deployment was made. Resolved command: railway up --detach')
    );
  });

  it('the escape hatch deploys without a stamp', () => {
    const result = deploy([SKIP_GATE_FLAG]);
    assert.equal(result.ran, true);
    assert.deepEqual(spawned[0].args, ['up']);
  });

  it('explains a missing Railway CLI and a failed deployment', () => {
    stampHead();
    const missing = () => ({
      status: null,
      error: Object.assign(new Error('spawn railway ENOENT'), { code: 'ENOENT' })
    });
    assert.throws(
      () => main({ argv: [], env: {}, root, git: fakeGit(), spawn: missing, log: () => {} }),
      /Install the Railway CLI/
    );
    const failing = () => ({ status: 1 });
    assert.throws(
      () => main({ argv: [], env: {}, root, git: fakeGit(), spawn: failing, log: () => {} }),
      /railway up failed \(exit 1\)/
    );
  });
});
