// Test-only helper for tests that need a directory they can link as a project
// resource. Deliberately dependency-free (no database, no service context) so
// even the lowest-level local-target tests can import it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const isolatedCheckouts: string[] = [];
let cleanupRegistered = false;

/**
 * Creates a throwaway git checkout that is safe to pass as a resource directory
 * to `addProjectResource` / `writeProjectJson`.
 *
 * Linking a resource does far more than write `<dir>/.overlord/project.json`:
 * `writeProjectJson` walks up to the *enclosing git root* and rewrites that
 * checkout's `AGENTS.md`, `CLAUDE.md`, `.gitignore`, and
 * `.git/hooks/pre-commit`. A test that links any directory inside this
 * repository therefore mutates the real working tree.
 *
 * Two habits make that easy to do by accident:
 *   - `process.cwd()` during a workspace test run is a package inside the repo;
 *   - Overlord pins `TMPDIR` to `<project>/.overlord/tmp` when it launches an
 *     agent, so even `os.tmpdir()` resolves inside the repo in agent sessions.
 *
 * `git init` is what actually contains the blast radius: it makes the throwaway
 * directory its own git root, so the metadata-protection walk stops there and
 * can never reach this repo, wherever `tmpdir()` happens to point.
 *
 * Never pass `process.cwd()` — or any other in-repo path — as a resource
 * directory; call this instead.
 */
export function createIsolatedCheckout(prefix = 'ovld-checkout-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  execFileSync('git', ['init', '--quiet', directory], { stdio: 'ignore' });

  isolatedCheckouts.push(directory);
  if (!cleanupRegistered) {
    cleanupRegistered = true;
    process.on('exit', () => {
      for (const checkout of isolatedCheckouts) {
        // Best-effort: a leftover temp checkout must never fail a passing suite.
        try {
          rmSync(checkout, { recursive: true, force: true });
        } catch {
          // Another worker removed it, or is still writing to it.
        }
      }
    });
  }
  return directory;
}
