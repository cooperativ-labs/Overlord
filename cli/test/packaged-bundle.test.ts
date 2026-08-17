import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageRoot = path.resolve(import.meta.dirname, '..');
const bundlePath = path.join(packageRoot, 'dist', 'index.js');

function collectBarePackageImports({ source }: { source: string }): string[] {
  const specifiers: string[] = [];
  for (const line of source.split('\n')) {
    const match =
      /^import\s+['"]([^'"]+)['"]/.exec(line) ??
      /^import\s+.+\sfrom\s+['"]([^'"]+)['"]/.exec(line) ??
      /^}\s*from\s+['"]([^'"]+)['"]/.exec(line);
    if (!match) continue;
    const specifier = match[1];
    if (!specifier.startsWith('node:') && !specifier.startsWith('.')) {
      specifiers.push(specifier);
    }
  }
  return [...new Set(specifiers)];
}

test('published CLI bundle inlines workspace packages instead of importing them', () => {
  const leftover = collectBarePackageImports({ source: readFileSync(bundlePath, 'utf8') });
  assert.deepEqual(
    leftover,
    [],
    `cli/dist/index.js must not import unpublished packages; found: ${leftover.join(', ')}`
  );
});

test('packaged CLI runs version without node_modules', () => {
  const packagedRoot = mkdtempSync(path.join(tmpdir(), 'ovld-packaged-bundle-'));

  try {
    cpSync(path.join(packageRoot, 'bin'), path.join(packagedRoot, 'bin'), { recursive: true });
    cpSync(bundlePath, path.join(packagedRoot, 'dist', 'index.js'));
    writeFileSync(
      path.join(packagedRoot, 'package.json'),
      JSON.stringify({ name: 'overlord-cli', version: '0.0.0-test', type: 'module' })
    );

    const result = spawnSync(process.execPath, ['bin/ovld.mjs', 'version'], {
      cwd: packagedRoot,
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Overlord CLI 0\.0\.0-test\n$/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(packagedRoot, { recursive: true, force: true });
  }
});
