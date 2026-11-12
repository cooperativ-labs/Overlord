import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_PATH,
  createStamp,
  dirtyTreeError,
  enforceReleaseGate,
  extractGateOverride,
  finish,
  gitClient,
  parseFinishArgs,
  parseLsRemote,
  parsePreflightArgs,
  preflight,
  readBaseline,
  readStamp,
  releaseGateRefusal,
  selectRangeStart,
  SKIP_GATE_ENV,
  SKIP_GATE_FLAG,
  STAMP_PATH,
  stampErrors,
  stampMismatch,
  writeStamp
} from './release-gate.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stamp(overrides = {}) {
  return createStamp({
    sha: SHA_A,
    impact: 'patch',
    contractVersion: '169.2.1',
    openapiVersion: '2.2.0',
    rangeStart: SHA_B,
    rangeStartSource: 'baseline',
    now: new Date('2026-11-12T12:00:00Z'),
    ...overrides
  });
}

describe('argument parsing', () => {
  it('parses preflight impact and flags', () => {
    assert.deepEqual(parsePreflightArgs(['patch']), {
      impact: 'patch',
      dryRun: false,
      remote: 'origin'
    });
    assert.deepEqual(parsePreflightArgs(['--dry-run', 'none', '--remote', 'upstream']), {
      impact: 'none',
      dryRun: true,
      remote: 'upstream'
    });
  });

  it('refuses a missing, unknown or repeated preflight impact', () => {
    assert.throws(() => parsePreflightArgs([]), /Declare the contract impact/);
    assert.throws(() => parsePreflightArgs(['huge']), /exactly one of none, patch, minor, major/);
    assert.throws(() => parsePreflightArgs(['patch', 'minor']), /Unexpected argument: minor/);
    assert.throws(() => parsePreflightArgs(['patch', '--force']), /Unknown argument: --force/);
    assert.throws(() => parsePreflightArgs(['patch', '--remote']), /Missing value for --remote/);
  });

  it('parses finish flags and refuses anything else', () => {
    assert.deepEqual(parseFinishArgs([]), { dryRun: false, remote: 'origin' });
    assert.deepEqual(parseFinishArgs(['--dry-run']), { dryRun: true, remote: 'origin' });
    assert.throws(() => parseFinishArgs(['patch']), /Unknown argument: patch/);
  });

  it('extracts the escape hatch from publish arguments', () => {
    assert.deepEqual(extractGateOverride(['--dry-run'], {}), {
      args: ['--dry-run'],
      skip: false,
      reason: null
    });
    assert.deepEqual(extractGateOverride(['--otp', '1', SKIP_GATE_FLAG], {}), {
      args: ['--otp', '1'],
      skip: true,
      reason: SKIP_GATE_FLAG
    });
    assert.equal(extractGateOverride([], { [SKIP_GATE_ENV]: '1' }).skip, true);
    assert.equal(extractGateOverride([], { [SKIP_GATE_ENV]: 'true' }).skip, false);
  });
});

describe('stamp', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'release-stamp-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('round-trips through .release/preflight.json', () => {
    assert.equal(readStamp(root), null);
    const written = stamp();
    writeStamp(root, written);
    assert.deepEqual(readStamp(root), written);
    assert.deepEqual(Object.keys(written), [
      'schemaVersion',
      'sha',
      'impact',
      'contractVersion',
      'openapiInfoVersion',
      'rangeStart',
      'rangeStartSource',
      'createdAt'
    ]);
    assert.equal(written.createdAt, '2026-11-12T12:00:00.000Z');
  });

  it('refuses an unparseable or malformed stamp instead of ignoring it', () => {
    mkdirSync(path.join(root, '.release'));
    writeFileSync(path.join(root, STAMP_PATH), '{ not json');
    assert.throws(() => readStamp(root), /is not valid JSON/);
    writeFileSync(path.join(root, STAMP_PATH), JSON.stringify({ ...stamp(), sha: 'HEAD' }));
    assert.throws(() => readStamp(root), /malformed \(sha must be a full commit SHA\)/);
    assert.deepEqual(stampErrors([]), ['the stamp is not a JSON object']);
    assert.ok(stampErrors({ ...stamp(), impact: 'huge', contractVersion: '169' }).length === 2);
  });

  it('matches only the SHA it was written for', () => {
    assert.match(stampMismatch(null, SHA_A), /No release stamp/);
    assert.match(stampMismatch(stamp(), SHA_B), /is for a{40}, but HEAD is b{40}/);
    assert.equal(stampMismatch(stamp(), SHA_A), undefined);
  });
});

describe('working tree and range start', () => {
  it('reports a dirty tree with the offending paths', () => {
    assert.equal(dirtyTreeError(''), undefined);
    assert.equal(dirtyTreeError('\n'), undefined);
    const error = dirtyTreeError(' M package.json\n?? notes.txt\n');
    assert.match(error, /not clean/);
    assert.match(error, / M package\.json/);
    assert.match(error, /\?\? notes\.txt/);
    const many = Array.from({ length: 12 }, (_, index) => `?? f${index}`).join('\n');
    assert.match(dirtyTreeError(many), /and 2 more/);
  });

  it('starts at the remote production tag when there is one', () => {
    assert.deepEqual(selectRangeStart({ remoteTagSha: SHA_A, localTagSha: null, baseline: null }), {
      sha: SHA_A,
      source: 'production-tag'
    });
    assert.deepEqual(
      selectRangeStart({
        remoteTagSha: SHA_A,
        localTagSha: SHA_A,
        baseline: { rangeStart: SHA_B }
      }),
      { sha: SHA_A, source: 'production-tag' }
    );
  });

  it('starts at the recorded baseline before the first release', () => {
    assert.deepEqual(
      selectRangeStart({ remoteTagSha: null, localTagSha: null, baseline: { rangeStart: SHA_B } }),
      { sha: SHA_B, source: 'baseline' }
    );
  });

  it('refuses a local tag that disagrees with the remote, or exists alone', () => {
    assert.throws(
      () => selectRangeStart({ remoteTagSha: SHA_A, localTagSha: SHA_B, baseline: null }),
      /differs from origin's/
    );
    assert.throws(
      () =>
        selectRangeStart({
          remoteTagSha: null,
          localTagSha: SHA_B,
          baseline: { rangeStart: SHA_A }
        }),
      /exists but origin has none/
    );
    assert.throws(
      () => selectRangeStart({ remoteTagSha: null, localTagSha: null, baseline: null }),
      /records no range start/
    );
  });

  it('reads the peeled commit of an annotated tag from ls-remote', () => {
    const output = `${SHA_A}\trefs/tags/production\n${SHA_B}\trefs/tags/production^{}\n`;
    assert.equal(parseLsRemote(output, 'refs/tags/production'), SHA_B);
    assert.equal(parseLsRemote(`${SHA_A}\trefs/heads/prod\n`, 'refs/heads/prod'), SHA_A);
    assert.equal(parseLsRemote('', 'refs/heads/prod'), null);
  });

  it('the recorded baseline in this repository is well formed', () => {
    const baseline = readBaseline(REPO_ROOT);
    assert.ok(baseline, `${BASELINE_PATH} exists`);
    assert.match(baseline.rangeStart, /^[0-9a-f]{40}$/);
    const version = readFileSync(path.join(REPO_ROOT, 'contract', 'VERSION'), 'utf8').trim();
    assert.equal(baseline.baselineContractVersion.split('.')[0], version.split('.')[0]);
  });
});

// End-to-end against throwaway repositories: a bare `origin` and a clone.
describe('preflight, publish gate and finish against a throwaway repository', () => {
  let base = '';
  let origin = '';
  let work = '';
  let baselineSha = '';
  const logs = [];
  const log = message => logs.push(message);
  const passingChecks = [];
  const runCheck = ({ script }) => {
    passingChecks.push(script.join(' '));
    return true;
  };

  function git(cwd, ...args) {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'tag.gpgsign=false',
        '-c',
        'maintenance.auto=false',
        ...args
      ],
      { cwd, encoding: 'utf8', stdio: 'pipe' }
    ).trim();
  }

  function write(files) {
    for (const [relativePath, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(work, relativePath)), { recursive: true });
      writeFileSync(path.join(work, relativePath), content);
    }
  }

  function commit(files, message = 'change') {
    write(files);
    git(work, 'add', '-A');
    git(work, 'commit', '--allow-empty', '-m', message);
    return git(work, 'rev-parse', 'HEAD');
  }

  function contractFiles(version, info = '1.0.0') {
    return {
      'contract/VERSION': `${version}\n`,
      'contract/CHANGELOG.md': `# Contract changelog\n\n## [${version}] - 2026-11-12\n\n- Entry.\n`,
      'contract/api/openapi.yaml': `openapi: 3.1.0\ninfo:\n  title: API\n  version: ${info}\n  x-overlord-contract-version: ${version}\npaths: {}\n`
    };
  }

  function context(extra = {}) {
    return { root: work, git: gitClient({ cwd: work }), log, ...extra };
  }

  beforeEach(() => {
    base = mkdtempSync(path.join(tmpdir(), 'release-gate-'));
    origin = path.join(base, 'origin.git');
    work = path.join(base, 'work');
    git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
    git(base, 'clone', '--quiet', origin, work);
    write({ '.gitignore': '.release/\n' });
    baselineSha = commit({ ...contractFiles('169.2.0'), 'app.ts': 'export {};\n' }, 'candidate');
    commit(
      {
        ...contractFiles('169.2.1'),
        [BASELINE_PATH]: `${JSON.stringify({
          baselineContractVersion: '169.2.1',
          rangeStart: baselineSha,
          rangeStartContractVersion: '169.2.0'
        })}\n`
      },
      'baseline'
    );
    git(work, 'push', '--quiet', 'origin', 'main');
    logs.length = 0;
    passingChecks.length = 0;
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('refuses a dirty tree, including untracked files', () => {
    write({ 'scratch.txt': 'x\n' });
    assert.throws(
      () => preflight({ impact: 'patch', runCheck, ...context() }),
      /not clean[\s\S]*scratch\.txt/
    );
    assert.equal(passingChecks.length, 0);
  });

  it('refuses a repository without a committed HEAD', () => {
    const empty = path.join(base, 'empty');
    git(base, 'init', '--quiet', empty);
    assert.throws(
      () =>
        preflight({ impact: 'none', runCheck, root: empty, git: gitClient({ cwd: empty }), log }),
      /HEAD is not a commit/
    );
  });

  it('first release: dry run checks the range from the recorded baseline and writes nothing', () => {
    const head = git(work, 'rev-parse', 'HEAD');
    const result = preflight({ impact: 'patch', dryRun: true, runCheck, ...context() });
    assert.equal(result.written, false);
    assert.equal(existsSync(path.join(work, STAMP_PATH)), false);
    assert.deepEqual(passingChecks, [
      'contract:check',
      'api:generate:check',
      'check:conformance-versions'
    ]);
    assert.equal(result.stamp.sha, head);
    assert.equal(result.stamp.rangeStart, baselineSha);
    assert.equal(result.stamp.rangeStartSource, 'baseline');
    assert.equal(result.stamp.contractVersion, '169.2.1');
    assert.equal(result.stamp.openapiInfoVersion, '1.0.0');
    assert.ok(logs.some(line => line.startsWith('Contract impact: patch (169.2.0 -> 169.2.1')));
    assert.ok(logs.some(line => line.includes('was not written')));
  });

  it('refuses a declaration that does not match the range', () => {
    assert.throws(
      () => preflight({ impact: 'none', runCheck, ...context() }),
      /Declared contract impact none does not match the VERSION delta 169\.2\.0 -> 169\.2\.1/
    );
    assert.equal(existsSync(path.join(work, STAMP_PATH)), false);
  });

  it('refuses when a mechanical check fails', () => {
    assert.throws(
      () =>
        preflight({
          impact: 'patch',
          runCheck: ({ script }) => script[0] !== 'api:generate:check',
          ...context()
        }),
      /yarn api:generate:check failed/
    );
  });

  it('publish steps refuse without a stamp, with a stale stamp, or with a dirty tree', () => {
    const step = { step: 'cli:publish', argv: [], env: {}, ...context() };
    assert.throws(() => enforceReleaseGate(step), /cli:publish refused[\s\S]*No release stamp/);

    preflight({ impact: 'patch', runCheck, ...context() });
    assert.equal(enforceReleaseGate(step).skipped, false);
    assert.equal(releaseGateRefusal(context()), undefined);

    write({ 'scratch.txt': 'x\n' });
    assert.throws(() => enforceReleaseGate(step), /not clean/);
    rmSync(path.join(work, 'scratch.txt'));

    commit({ 'app.ts': 'export const later = 1;\n' }, 'later');
    assert.throws(() => enforceReleaseGate(step), /stamp is for [0-9a-f]{40}, but HEAD is/);
  });

  it('a dry-run publish reports a refusal without failing; the escape hatch skips loudly', () => {
    const dry = enforceReleaseGate({
      step: 'desktop:publish',
      argv: ['--dry-run'],
      env: {},
      dryRun: true,
      ...context()
    });
    assert.match(dry.refusal, /No release stamp/);
    assert.deepEqual(dry.args, ['--dry-run']);

    const skipped = enforceReleaseGate({
      step: 'server:deploy',
      argv: [SKIP_GATE_FLAG, '--detach'],
      env: {},
      ...context()
    });
    assert.equal(skipped.skipped, true);
    assert.deepEqual(skipped.args, ['--detach']);
    assert.ok(logs.some(line => line.includes('RELEASE GATE SKIPPED')));
    assert.equal(
      enforceReleaseGate({
        step: 'cli:publish',
        argv: [],
        env: { [SKIP_GATE_ENV]: '1' },
        ...context()
      }).skipped,
      true
    );
  });

  it('finish --dry-run prints the plan and changes nothing', () => {
    preflight({ impact: 'patch', runCheck, ...context() });
    const head = git(work, 'rev-parse', 'HEAD');
    const result = finish({ dryRun: true, ...context() });
    assert.equal(result.executed, false);
    assert.equal(git(work, 'ls-remote', 'origin', 'refs/tags/production'), '');
    assert.equal(git(work, 'tag', '--list', 'production'), '');
    assert.ok(
      logs.includes(
        `  git push --atomic --force-with-lease=refs/tags/production: origin ${head}:refs/heads/prod ${head}:refs/tags/production`
      ),
      logs.join('\n')
    );
    assert.ok(logs.includes(`  git tag --force production ${head}`));
    assert.ok(logs.includes(`  git update-ref refs/heads/prod ${head}`));
  });

  it('finish places the tag and prod on the first release, then moves them forward', () => {
    preflight({ impact: 'patch', runCheck, ...context() });
    const first = git(work, 'rev-parse', 'HEAD');
    finish(context());
    assert.match(git(work, 'ls-remote', 'origin', 'refs/tags/production'), new RegExp(`^${first}`));
    assert.match(git(work, 'ls-remote', 'origin', 'refs/heads/prod'), new RegExp(`^${first}`));
    assert.equal(git(work, 'rev-parse', 'refs/tags/production'), first);
    assert.equal(git(work, 'rev-parse', 'refs/heads/prod'), first);

    // The next release starts at the tag; an application-only range is `none`.
    const second = commit({ 'app.ts': 'export const second = 2;\n' }, 'second');
    const next = preflight({ impact: 'none', runCheck, ...context() });
    assert.equal(next.stamp.rangeStart, first);
    assert.equal(next.stamp.rangeStartSource, 'production-tag');
    finish(context());
    assert.match(
      git(work, 'ls-remote', 'origin', 'refs/tags/production'),
      new RegExp(`^${second}`)
    );
    assert.match(git(work, 'ls-remote', 'origin', 'refs/heads/prod'), new RegExp(`^${second}`));
  });

  it('finish refuses a non-fast-forward of prod', () => {
    // Someone pushed a prod branch that HEAD does not contain.
    git(work, 'checkout', '--quiet', '-b', 'stray', baselineSha);
    commit({ 'stray.ts': 'export {};\n' }, 'stray');
    git(work, 'push', '--quiet', 'origin', 'stray:prod');
    git(work, 'checkout', '--quiet', 'main');
    git(work, 'branch', '--quiet', '-D', 'stray');
    git(work, 'fetch', '--quiet', 'origin');
    preflight({ impact: 'patch', runCheck, ...context() });
    assert.throws(() => finish(context()), /would not be a fast-forward/);
    assert.equal(git(work, 'ls-remote', 'origin', 'refs/tags/production'), '');
  });

  it('finish refuses when the production tag moved after preflight', () => {
    preflight({ impact: 'patch', runCheck, ...context() });
    git(work, 'push', '--quiet', 'origin', `${baselineSha}:refs/tags/production`);
    assert.throws(() => finish(context()), /preflight ran before it existed/);
  });

  it('finish refuses without a stamp for HEAD', () => {
    assert.throws(() => finish(context()), /No release stamp/);
  });

  it('preflight refuses a range start that is not an ancestor of HEAD', () => {
    git(work, 'checkout', '--quiet', '-b', 'side', baselineSha);
    const side = commit({ 'side.ts': 'export {};\n' }, 'side');
    git(work, 'push', '--quiet', 'origin', `${side}:refs/tags/production`);
    git(work, 'checkout', '--quiet', 'main');
    git(work, 'fetch', '--quiet', 'origin', '--tags');
    assert.throws(
      () => preflight({ impact: 'none', runCheck, ...context() }),
      /not an ancestor of HEAD/
    );
  });
});
