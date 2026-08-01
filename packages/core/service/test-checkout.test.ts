import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { writeProjectJson } from './local-target/project-metadata.ts';
import { createIsolatedCheckout } from './test-checkout.ts';

function gitRootOf(directory: string): string {
  return execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8'
  }).trim();
}

describe('createIsolatedCheckout', () => {
  // Regression guard for the real damage this helper exists to prevent: linking
  // a resource rewrites the *enclosing git root's* AGENTS.md, CLAUDE.md,
  // .gitignore and pre-commit hook. Before this helper, tests linked
  // `process.cwd()` or a `tmpdir()` path — and Overlord pins TMPDIR to
  // `<project>/.overlord/tmp` in agent sessions — so both resolved to this
  // repository and every test run mutated the working tree.
  it('is its own git root even when tmpdir points inside this repository', () => {
    const directory = createIsolatedCheckout('ovld-isolation-guard-');

    // `--show-toplevel` reports the real path, so compare against the real path
    // of the checkout (macOS resolves the temp root through /private).
    assert.equal(realpathSync(gitRootOf(directory)), realpathSync(directory));
  });

  it('keeps writeProjectJson side effects inside the throwaway checkout', () => {
    const directory = createIsolatedCheckout('ovld-isolation-writes-');

    writeProjectJson({
      directoryPath: directory,
      projectId: 'project-1',
      resourceId: 'resource-1',
      isPrimary: true
    });

    // Every artifact the metadata-protection pass produces lands here, not in
    // whatever repository happens to enclose `tmpdir()`.
    for (const relative of [
      '.overlord/project.json',
      'AGENTS.md',
      'CLAUDE.md',
      '.gitignore',
      '.git/hooks/pre-commit'
    ]) {
      assert.equal(existsSync(path.join(directory, relative)), true, relative);
    }
    assert.match(
      readFileSync(path.join(directory, 'CLAUDE.md'), 'utf8'),
      /OVERLORD PROJECT METADATA PROTECTION: START/
    );
  });
});
