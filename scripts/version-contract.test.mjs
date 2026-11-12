import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bumpContractVersion,
  checkContractVersion,
  compareVersions,
  componentsContractVersion,
  consistencyErrors,
  impactBetween,
  nextVersion,
  openapiContractVersion,
  openapiInfoVersion,
  parseVersion,
  planContractBump,
  readContractState,
  writeAtomically
} from './version-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = [];

afterEach(() => {
  for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const baseOpenapi = (infoVersion, extension) =>
  [
    'openapi: 3.1.0',
    'info:',
    '  title: Overlord API',
    `  version: ${infoVersion}`,
    ...(extension === null ? [] : [`  x-overlord-contract-version: ${extension}`]),
    '  description: >-',
    '    Normative boundary.',
    'paths:',
    '  /api/health:',
    '    get:',
    '      operationId: getHealth',
    'components:',
    '  schemas:',
    '    Thing:',
    '      properties:',
    '        version:',
    '          type: string',
    ''
  ].join('\n');

const baseComponents = version =>
  [
    '# Overlord Component Registry',
    '',
    `contractVersion: '${version}'`,
    '',
    'components:',
    '  - stableId: protocol',
    "    contractVersion: 'not-top-level'",
    ''
  ].join('\n');

/**
 * Options: version, header, heading, components, openapi (false = absent),
 * extension (null = missing line), infoVersion, packageVersion.
 */
function writeFixture(root, options = {}) {
  const version = options.version ?? '1.4.2';
  const files = {
    'package.json': `${JSON.stringify(
      { name: 'overlord', version: options.packageVersion ?? '0.2611091052.0' },
      null,
      2
    )}\n`,
    'contract/VERSION': `${version}\n`,
    'contract/CONTRACT.md': [
      '# Overlord contract',
      '',
      `> Contract version: **${options.header ?? version}**`,
      '',
      `Section 7 mentions ${version} in prose and must not be rewritten.`,
      ''
    ].join('\n'),
    'contract/CHANGELOG.md': [
      '# Contract changelog',
      '',
      `## [${options.heading ?? version}] - 2026-09-01`,
      '',
      '- Current.',
      '',
      '## [168]',
      '',
      '- Provenance.',
      ''
    ].join('\n'),
    'contract/components.yaml': baseComponents(options.components ?? version)
  };
  if (options.openapi !== false) {
    files['contract/api/openapi.yaml'] = baseOpenapi(
      options.infoVersion ?? '3.1.0',
      options.extension === undefined ? version : options.extension
    );
  }
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), content);
  }
  return files;
}

function fixture(options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'version-contract-'));
  fixtures.push(root);
  const files = writeFixture(root, options);
  return { root, files };
}

function read(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

describe('strict Semantic Versioning arithmetic', () => {
  it('computes patch, minor, and major bumps with zero-reset', () => {
    assert.equal(nextVersion('1.4.2', 'patch'), '1.4.3');
    assert.equal(nextVersion('1.4.2', 'minor'), '1.5.0');
    assert.equal(nextVersion('1.4.2', 'major'), '2.0.0');
  });

  it('moves the 168.0.0 restatement to the 169.0.0 baseline as a major bump', () => {
    assert.equal(nextVersion('168.0.0', 'major'), '169.0.0');
    assert.equal(impactBetween('168.0.0', '169.0.0'), 'major');
  });

  it('rejects invalid versions and bump levels', () => {
    for (const invalid of ['168', '1.0', '01.0.0', '1.0.0-rc.1', '1.0.0+build', 'v1.0.0', ' 1.0.0', '']) {
      assert.throws(() => parseVersion(invalid), /strict MAJOR\.MINOR\.PATCH/);
    }
    assert.throws(() => nextVersion('1.0.0', 'hotfix'), /patch, minor, major/);
  });

  it('classifies the highest changed component and refuses a decrease', () => {
    assert.equal(impactBetween('1.2.3', '1.2.3'), 'none');
    assert.equal(impactBetween('1.2.3', '1.2.9'), 'patch');
    assert.equal(impactBetween('1.2.3', '1.4.1'), 'minor');
    assert.equal(impactBetween('1.2.3', '3.0.1'), 'major');
    assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
    assert.throws(() => impactBetween('2.0.0', '1.9.9'), /decreased/);
  });
});

describe('contract version consistency', () => {
  it('passes when VERSION, header, current heading, components.yaml and extension agree', async () => {
    const { root } = fixture();
    assert.equal(await checkContractVersion({ root }), '1.4.2');
  });

  it('tolerates a missing OpenAPI description until it exists', async () => {
    const { root } = fixture({ openapi: false });
    const state = await readContractState(root);
    assert.equal(state.openapi, undefined);
    assert.deepEqual(consistencyErrors(state), []);
  });

  it('never compares info.version or package.json version with VERSION', async () => {
    const differing = fixture({ infoVersion: '9.9.9', packageVersion: '0.1.0' });
    assert.deepEqual(consistencyErrors(await readContractState(differing.root)), []);
    const equal = fixture({ infoVersion: '1.4.2', packageVersion: '1.4.2' });
    assert.deepEqual(consistencyErrors(await readContractState(equal.root)), []);
  });

  it('validates info.version and package.json version by format', async () => {
    const { root } = fixture({ infoVersion: '1.0', packageVersion: '1.0.0-beta' });
    const errors = consistencyErrors(await readContractState(root));
    assert.equal(errors.length, 2);
    assert.match(errors[0], /OpenAPI info\.version must be strict/);
    assert.match(errors[1], /package\.json version must be strict/);
  });

  it('reports each disagreeing contract-owned location', async () => {
    const { root } = fixture({
      header: '1.4.1',
      heading: '1.4.0',
      components: '168',
      extension: '1.3.0'
    });
    const errors = consistencyErrors(await readContractState(root));
    assert.equal(errors.length, 4);
    assert.match(errors[0], /CONTRACT\.md header declares 1\.4\.1/);
    assert.match(errors[1], /CHANGELOG\.md current heading is 1\.4\.0/);
    assert.match(errors[2], /components\.yaml contractVersion is 168/);
    assert.match(errors[3], /x-overlord-contract-version is 1\.3\.0/);
  });

  it('requires the OpenAPI contract-version extension once the description exists', async () => {
    const { root } = fixture({ extension: null });
    await assert.rejects(checkContractVersion({ root }), /exactly once; found 0/);
  });

  it('rejects a non-SemVer VERSION', async () => {
    const { root } = fixture({ version: '168' });
    await assert.rejects(checkContractVersion({ root }), /not strict MAJOR\.MINOR\.PATCH/);
  });

  it('reads only the info-block version fields and the top-level components version', () => {
    const openapi = baseOpenapi('2.3.4', '1.4.2');
    assert.equal(openapiInfoVersion(openapi), '2.3.4');
    assert.equal(openapiContractVersion(openapi), '1.4.2');
    assert.deepEqual(componentsContractVersion(baseComponents('1.4.2')), {
      count: 1,
      value: '1.4.2'
    });
  });
});

describe('contract version bump', () => {
  it('updates only VERSION, the header, the changelog skeleton, components.yaml and the extension', async () => {
    const { root, files } = fixture();
    const result = await bumpContractVersion({
      root,
      level: 'minor',
      now: new Date('2026-10-02T08:00:00Z')
    });

    assert.deepEqual(result, { current: '1.4.2', next: '1.5.0' });
    assert.equal(read(root, 'contract/VERSION'), '1.5.0\n');
    assert.equal(read(root, 'package.json'), files['package.json']);
    const contract = read(root, 'contract/CONTRACT.md');
    assert.ok(contract.includes('> Contract version: **1.5.0**'));
    assert.ok(contract.includes('Section 7 mentions 1.4.2 in prose'));
    const changelog = read(root, 'contract/CHANGELOG.md');
    assert.match(
      changelog,
      /^# Contract changelog\n\n## \[1\.5\.0\] - 2026-10-02\n\n### Version\n\n- Minor contract version 1\.5\.0, from 1\.4\.2\.\n\n## \[1\.4\.2\] - 2026-09-01/
    );
    assert.equal(
      read(root, 'contract/components.yaml'),
      files['contract/components.yaml'].replace(
        "contractVersion: '1.4.2'",
        "contractVersion: '1.5.0'"
      )
    );
    const openapi = read(root, 'contract/api/openapi.yaml');
    assert.equal(
      openapi,
      files['contract/api/openapi.yaml'].replace(
        'x-overlord-contract-version: 1.4.2',
        'x-overlord-contract-version: 1.5.0'
      )
    );
    assert.equal(openapiInfoVersion(openapi), '3.1.0');
    assert.equal(await checkContractVersion({ root }), '1.5.0');
  });

  it('bumps without an OpenAPI description and does not create one', async () => {
    const { root } = fixture({ openapi: false });
    await bumpContractVersion({ root, level: 'patch' });
    assert.equal(read(root, 'contract/VERSION'), '1.4.3\n');
    assert.throws(() => read(root, 'contract/api/openapi.yaml'), /ENOENT/);
    assert.equal(await checkContractVersion({ root }), '1.4.3');
  });

  it('refuses to bump inconsistent files', async () => {
    const { root } = fixture({ header: '1.4.1' });
    await assert.rejects(bumpContractVersion({ root, level: 'patch' }), /inconsistent/);
    assert.equal(read(root, 'contract/VERSION'), '1.4.2\n');
  });

  it('rejects bump levels other than patch, minor, and major', async () => {
    const { root } = fixture();
    const state = await readContractState(root);
    for (const level of ['none', 'hotfix', 'Major', '']) {
      assert.throws(() => planContractBump(state, level), /patch, minor, major/);
    }
  });

  it('restores every file and removes staged files when a write fails', async () => {
    const { root, files } = fixture();
    const state = await readContractState(root);
    const plan = planContractBump(state, 'major');
    let renames = 0;
    const fs = await import('node:fs/promises');
    const failingFileSystem = {
      ...fs,
      rename: async (from, to) => {
        renames += 1;
        if (renames === 3) throw new Error('disk full');
        await fs.rename(from, to);
      }
    };

    await assert.rejects(
      writeAtomically({ root, updates: plan.updates, fileSystem: failingFileSystem }),
      /disk full/
    );
    for (const [relativePath, content] of Object.entries(files)) {
      assert.equal(read(root, relativePath), content);
    }
    const leftovers = [root, path.join(root, 'contract'), path.join(root, 'contract/api')]
      .flatMap(directory => readdirSync(directory))
      .filter(name => name.includes('.version-contract-'));
    assert.deepEqual(leftovers, []);
  });
});

describe('repository contract check', () => {
  it('passes against the repository', () => {
    assert.match(
      execFileSync('sh', [path.join(repoRoot, 'scripts/check-contract.sh')], { encoding: 'utf8' }),
      /^contract check passed for /
    );
  });

  function checkFixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'check-contract-'));
    fixtures.push(root);
    writeFixture(root);
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'contract/data'), { recursive: true });
    mkdirSync(path.join(root, 'contract/api'), { recursive: true });
    mkdirSync(path.join(root, 'contract/decisions'), { recursive: true });
    for (const script of ['check-contract.sh', 'version-contract.mjs', 'check-openapi.mjs']) {
      copyFileSync(path.join(repoRoot, 'scripts', script), path.join(root, 'scripts', script));
    }
    for (const document of [
      'architecture.md',
      'protocol.md',
      'authorization.md',
      'conformance.md',
      'data/README.md',
      'api/rest-notes.md',
      'protocol-commands.yaml',
      'extension-points.yaml',
      'conformance-manifest.schema.yaml',
      'harness-capabilities.schema.yaml'
    ]) {
      writeFileSync(path.join(root, 'contract', document), 'normative\n');
    }
    writeFileSync(
      path.join(root, 'contract/api/openapi-ratchet.json'),
      `${JSON.stringify({ stubOperations: 0 })}\n`
    );
    writeFileSync(
      path.join(root, 'contract/decisions/README.md'),
      '# Decisions\n\n- [0001 — First](0001-first.md)\n'
    );
    writeFileSync(path.join(root, 'contract/decisions/0001-first.md'), '# ADR 0001\n');
    for (const instructions of ['AGENTS.md', 'CLAUDE.md']) {
      writeFileSync(path.join(root, instructions), 'Read `contract/CONTRACT.md`.\n');
    }
    const run = () =>
      execFileSync('sh', [path.join(root, 'scripts/check-contract.sh')], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
    return { root, run };
  }

  it('passes a complete fixture', () => {
    const { run } = checkFixture();
    assert.equal(run(), 'contract check passed for 1.4.2\n');
  });

  it('requires the OpenAPI description, its ratchet and, until phase 4d, the REST notes', () => {
    for (const document of ['api/openapi.yaml', 'api/openapi-ratchet.json', 'api/rest-notes.md']) {
      const { root, run } = checkFixture();
      rmSync(path.join(root, 'contract', document));
      assert.throws(run, new RegExp(`missing contract/${document.replace('.', '\\.')}`));
    }
  });

  it('fails when the OpenAPI schema-stub count disagrees with the ratchet', () => {
    const { root, run } = checkFixture();
    writeFileSync(
      path.join(root, 'contract/api/openapi-ratchet.json'),
      `${JSON.stringify({ stubOperations: 3 })}\n`
    );
    assert.throws(run, /structural check/);
  });

  it('fails when the OpenAPI contract-version extension disagrees with VERSION', () => {
    const { root, run } = checkFixture();
    const file = path.join(root, 'contract/api/openapi.yaml');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(/x-overlord-contract-version: .*/, 'x-overlord-contract-version: 1.4.1')
    );
    assert.throws(run, /inconsistent/);
  });

  it('fails when a root CONTRACT.md reappears', () => {
    const { root, run } = checkFixture();
    writeFileSync(path.join(root, 'CONTRACT.md'), '# Old contract\n');
    assert.throws(run, /repository root/);
  });

  it('fails when a decision record is missing from the index, or the index names a missing record', () => {
    const { root, run } = checkFixture();
    writeFileSync(path.join(root, 'contract/decisions/0002-second.md'), '# ADR 0002\n');
    assert.throws(run, /0002-second\.md is not listed/);
    rmSync(path.join(root, 'contract/decisions/0002-second.md'));
    writeFileSync(
      path.join(root, 'contract/decisions/README.md'),
      '# Decisions\n\n- [0001 — First](0001-first.md)\n- [0003 — Third](0003-third.md)\n'
    );
    assert.throws(run, /lists 0003-third\.md, which does not exist/);
  });

  it('fails when components.yaml disagrees with VERSION', () => {
    const { root, run } = checkFixture();
    writeFileSync(path.join(root, 'contract/components.yaml'), baseComponents('168'));
    assert.throws(run, /inconsistent/);
  });
});
