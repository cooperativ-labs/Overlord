import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkContractRange,
  contractRangeViolations,
  gitRepository,
  parseContractImpact,
  parseNameStatus
} from './contract-impact.mjs';
import { nextVersion } from './version-contract.mjs';

let root = '';
let version = '168.0.0';
let infoVersion = '1.0.0';
let changelog = '';

function git(...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      '-c',
      'commit.gpgsign=false',
      // Commits otherwise spawn a detached `git maintenance run --auto` that
      // can still hold a lock under .git when afterEach removes the repository.
      '-c',
      'maintenance.auto=false',
      ...args
    ],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' }
  ).trim();
}

function write(files) {
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
}

function openapi(info, summary = 'Health') {
  return `openapi: 3.1.0\ninfo:\n  title: API\n  version: ${info}\n  x-overlord-contract-version: ${version}\npaths:\n  /api/health:\n    get:\n      summary: ${summary}\n`;
}

function commit(files, message = 'change') {
  write(files);
  git('add', '-A');
  git('commit', '--allow-empty', '-m', message);
  return git('rev-parse', 'HEAD');
}

// Mirrors what `yarn version:contract` writes. `withOpenapi` adds the
// contract-version extension rewrite once an OpenAPI description exists.
function bumpFiles(level, { withHeading = true, withOpenapi = false } = {}) {
  version = nextVersion(version, level);
  if (withHeading) {
    changelog = changelog.replace('\n## [', `\n## [${version}] - 2026-11-13\n\n- ${level}.\n\n## [`);
  }
  return {
    'contract/VERSION': `${version}\n`,
    'contract/CHANGELOG.md': changelog,
    'contract/components.yaml': `contractVersion: '${version}'\n`,
    ...(withOpenapi ? { 'contract/api/openapi.yaml': openapi(infoVersion) } : {})
  };
}

function check(rangeStart, head, declaredImpact) {
  return contractRangeViolations({
    rangeStart,
    head,
    declaredImpact,
    repository: gitRepository({ cwd: root })
  });
}

let start = '';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'contract-range-'));
  version = '168.0.0';
  infoVersion = '1.0.0';
  changelog = '# Contract changelog\n\n## [168.0.0] - 2026-11-12\n\n- Restatement.\n\n## [168]\n\n- Provenance.\n';
  git('init', '--quiet', '--initial-branch=main');
  start = commit({
    'contract/VERSION': `${version}\n`,
    'contract/CHANGELOG.md': changelog,
    'contract/CONTRACT.md': '# Contract\n',
    'contract/components.yaml': `contractVersion: '${version}'\n`,
    'contract/authorization.md': '# Authorization\n',
    'contract/protocol.md': '# Protocol\n',
    'contract/conformance.md': '# Conformance\n',
    'contract/decisions/0001-first.md': '# ADR 0001\n',
    'database/sqlite/migrations/20260901000000_init.sql': 'select 1;\n',
    'database/postgres/migrations/20260901000000_init.sql': 'select 1;\n',
    'webapp/src/App.tsx': 'export {};\n'
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('parseContractImpact', () => {
  it('accepts exactly one supported value', () => {
    for (const impact of ['none', 'patch', 'minor', 'major']) {
      assert.equal(parseContractImpact(` ${impact} `), impact);
    }
    for (const invalid of ['', 'Major', 'minor, patch', 'Contract impact: none', undefined]) {
      assert.throws(() => parseContractImpact(invalid), /contract impact must be exactly one of/);
    }
  });
});

describe('parseNameStatus', () => {
  it('records both paths of a rename', () => {
    assert.deepEqual(parseNameStatus('A\ta.md\nR087\told.md\tnew.md\nM\tb.md\n'), [
      { status: 'A', path: 'a.md' },
      { status: 'R', previousPath: 'old.md', path: 'new.md' },
      { status: 'M', path: 'b.md' }
    ]);
  });
});

describe('contract range checker', () => {
  it('accepts none when the contract is unchanged', () => {
    const head = commit({ 'webapp/src/App.tsx': 'export const a = 1;\n' });
    const result = check(start, head, 'none');
    assert.equal(result.computedImpact, 'none');
    assert.deepEqual(result.violations, []);
  });

  it('refuses none when contract/ changed', () => {
    const head = commit({ 'contract/CONTRACT.md': '# Contract\n\nClarified.\n' });
    const { violations } = check(start, head, 'none');
    assert.equal(violations.length, 1);
    assert.match(violations[0], /cannot change contract\/: contract\/CONTRACT\.md/);
  });

  for (const level of ['patch', 'minor', 'major']) {
    it(`accepts a matching ${level} declaration`, () => {
      const head = commit({ ...bumpFiles(level), 'contract/CONTRACT.md': `# Contract ${level}\n` });
      const result = check(start, head, level);
      assert.equal(result.computedImpact, level);
      assert.equal(result.startVersion, '168.0.0');
      assert.equal(result.headVersion, version);
      assert.deepEqual(result.violations, []);
    });
  }

  it('refuses a declaration that does not match the VERSION delta', () => {
    const head = commit(bumpFiles('minor'));
    assert.deepEqual(check(start, head, 'patch').violations, [
      'Declared contract impact patch does not match the VERSION delta 168.0.0 -> 168.1.0, which is minor'
    ]);
    assert.throws(
      () =>
        checkContractRange({
          rangeStart: start,
          head,
          declaredImpact: 'major',
          repository: gitRepository({ cwd: root })
        }),
      /refused/
    );
  });

  it('compares the delta across several bumps in one range', () => {
    commit(bumpFiles('patch'));
    commit(bumpFiles('minor'));
    const head = commit(bumpFiles('patch'));
    const result = check(start, head, 'minor');
    assert.equal(result.headVersion, '168.1.1');
    assert.deepEqual(result.violations, []);
    const major = commit(bumpFiles('major'));
    assert.deepEqual(check(start, major, 'major').violations, []);
  });

  it('refuses a decreasing contract version', () => {
    const middle = commit(bumpFiles('minor'));
    changelog = changelog.replace('\n## [', '\n## [168.0.5] - 2026-11-14\n\n- Lower.\n\n## [');
    const head = commit({
      'contract/VERSION': '168.0.5\n',
      'contract/CHANGELOG.md': changelog
    });
    assert.deepEqual(check(middle, head, 'patch').violations, [
      'Contract version decreased from 168.1.0 to 168.0.5'
    ]);
  });

  it('refuses a non-SemVer version anywhere in the range', () => {
    commit({ 'contract/VERSION': '169\n' });
    const head = commit(bumpFiles('patch'));
    const { violations } = check(start, head, 'patch');
    assert.equal(violations.length, 1);
    assert.match(
      violations[0],
      /VERSION at [0-9a-f]{40} in the range is not strict Semantic Versioning: 169/
    );
  });

  it('requires a current changelog heading for the head version', () => {
    const head = commit(bumpFiles('minor', { withHeading: false }));
    assert.deepEqual(check(start, head, 'minor').violations, [
      'contract/CHANGELOG.md at head has no current heading for 168.1.0'
    ]);
  });

  it('ignores OpenAPI rules while no description exists', () => {
    const head = commit(bumpFiles('minor'));
    assert.deepEqual(check(start, head, 'minor').violations, []);
  });

  it('accepts the commit that introduces the OpenAPI description', () => {
    const head = commit({ ...bumpFiles('minor', { withOpenapi: true }) });
    assert.deepEqual(check(start, head, 'minor').violations, []);
  });

  it('requires info.version to change when openapi.yaml changed', () => {
    const withApi = commit({ ...bumpFiles('patch', { withOpenapi: true }) });
    const head = commit({
      ...bumpFiles('patch', { withOpenapi: true }),
      'contract/api/openapi.yaml': openapi(infoVersion, 'Liveness')
    });
    assert.deepEqual(check(withApi, head, 'patch').violations, [
      'contract/api/openapi.yaml changed in the range but info.version is still 1.0.0'
    ]);
    const fixed = commit({ 'contract/api/openapi.yaml': openapi('1.0.1', 'Liveness') });
    assert.deepEqual(check(withApi, fixed, 'patch').violations, []);
  });

  it('does not require info.version to change when only the contract-version extension moved', () => {
    const withApi = commit({ ...bumpFiles('patch', { withOpenapi: true }) });
    const head = commit(bumpFiles('minor', { withOpenapi: true }));
    assert.deepEqual(check(withApi, head, 'minor').violations, []);
  });

  for (const [file, content] of [
    ['contract/authorization.md', '# Authorization\n\nNarrowed.\n'],
    ['contract/protocol.md', '# Protocol\n\nNew lifecycle step.\n'],
    ['contract/data/README.md', '# Data\n\nNew route rule.\n'],
    ['database/sqlite/migrations/20261113000000_change.sql', 'select 2;\n'],
    ['database/postgres/migrations/20261113000000_change.sql', 'select 2;\n']
  ]) {
    it(`requires a new decision record when ${file} changed`, () => {
      const head = commit({ ...bumpFiles('major'), [file]: content });
      assert.deepEqual(check(start, head, 'major').violations, [
        `The range changes ${file} but adds no decision record under contract/decisions/`
      ]);
      const withAdr = commit({ 'contract/decisions/0002-second.md': '# ADR 0002\n' });
      assert.deepEqual(check(start, withAdr, 'major').violations, []);
    });
  }

  it('does not require a decision record for conformance.md alone', () => {
    const head = commit({ ...bumpFiles('patch'), 'contract/conformance.md': '# Conformance\n\nFixed.\n' });
    assert.deepEqual(check(start, head, 'patch').violations, []);
  });

  it('does not count a renamed decision record as a new one', () => {
    git('mv', 'contract/decisions/0001-first.md', 'contract/decisions/0001-renamed.md');
    const head = commit({
      ...bumpFiles('patch'),
      'contract/authorization.md': '# Authorization\n\nFixed.\n'
    });
    const { violations } = check(start, head, 'patch');
    assert.equal(violations.length, 1);
    assert.match(violations[0], /adds no decision record/);
  });

  it('has no MCP-specific rules', () => {
    const source = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'contract-impact.mjs'),
      'utf8'
    );
    assert.doesNotMatch(source, /mcp/i);
  });
});
