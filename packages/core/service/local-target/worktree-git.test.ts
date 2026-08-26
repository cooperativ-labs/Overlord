import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { performBranchActionGit } from './branch-actions-git.ts';
import {
  collectManagedWorktrees,
  removeManagedWorktree,
  resolveBranchCheckoutPath,
  resolveRealPath,
  worktreeIsDirty
} from './worktree-git.ts';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ovld-wt-git-'));
  git(dir, ['init']);
  git(dir, ['checkout', '-b', 'main']);
  writeFileSync(path.join(dir, 'README.md'), '# Test\n');
  git(dir, ['add', 'README.md']);
  git(dir, [
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test User',
    'commit',
    '-m',
    'init'
  ]);
  return dir;
}

describe('worktree-git', () => {
  it('collects managed worktrees under the configured root', () => {
    const repo = makeRepo();
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ovld-wt-root-'));
    const branch = 'feature/demo';
    git(repo, ['branch', branch]);
    const worktreePath = path.join(worktreeRoot, 'demo');
    git(repo, ['worktree', 'add', worktreePath, branch]);

    const worktrees = collectManagedWorktrees({
      worktreeRoot,
      projects: [{ primaryRepoPath: repo }]
    });
    assert.equal(worktrees.length, 1);
    assert.equal(worktrees[0]?.path, resolveRealPath(worktreePath));
    assert.equal(worktrees[0]?.branch, branch);
    assert.equal(worktrees[0]?.dirty, false);

    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('refuses to remove a dirty worktree without force', () => {
    const repo = makeRepo();
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ovld-wt-root-'));
    const branch = 'feature/dirty';
    git(repo, ['branch', branch]);
    const worktreePath = path.join(worktreeRoot, 'dirty');
    git(repo, ['worktree', 'add', worktreePath, branch]);
    writeFileSync(path.join(worktreePath, 'dirty.txt'), 'change');
    assert.equal(worktreeIsDirty(worktreePath), true);

    const result = removeManagedWorktree({
      path: worktreePath,
      primaryRepoPath: repo,
      force: false
    });
    assert.deepEqual(result.removed, []);
    assert.equal(result.skipped[0]?.reason, 'uncommitted changes');
    assert.equal(existsSync(worktreePath), true);

    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });
});

describe('resolveBranchCheckoutPath', () => {
  it('prefers the recorded worktree while it is still on the branch', () => {
    const repo = makeRepo();
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ovld-wt-root-'));
    const worktreePath = path.join(worktreeRoot, 'demo');
    git(repo, ['branch', 'feature/demo']);
    git(repo, ['worktree', 'add', worktreePath, 'feature/demo']);

    assert.equal(
      resolveBranchCheckoutPath({
        repoPath: repo,
        branchName: 'feature/demo',
        worktreePathHint: worktreePath
      }),
      worktreePath
    );

    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('falls back to the primary repo once the worktree is gone and the branch lives there', () => {
    const repo = makeRepo();
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ovld-wt-root-'));
    const worktreePath = path.join(worktreeRoot, 'demo');
    git(repo, ['branch', 'feature/demo']);
    git(repo, ['worktree', 'add', worktreePath, 'feature/demo']);
    git(repo, ['worktree', 'remove', worktreePath]);
    git(repo, ['checkout', 'feature/demo']);

    const resolved = resolveBranchCheckoutPath({
      repoPath: repo,
      branchName: 'feature/demo',
      worktreePathHint: worktreePath
    });
    assert.ok(resolved, 'expected the primary repo checkout');
    assert.equal(resolveRealPath(resolved), resolveRealPath(repo));

    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns null when the branch is checked out nowhere', () => {
    const repo = makeRepo();
    git(repo, ['branch', 'feature/idle']);
    assert.equal(
      resolveBranchCheckoutPath({
        repoPath: repo,
        branchName: 'feature/idle',
        worktreePathHint: path.join(repo, 'missing')
      }),
      null
    );
    rmSync(repo, { recursive: true, force: true });
  });
});

describe('branch-actions-git', () => {
  it('commits in the primary repo when the recorded worktree no longer exists', () => {
    const repo = makeRepo();
    const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'ovld-wt-root-'));
    const worktreePath = path.join(worktreeRoot, 'demo');
    git(repo, ['branch', 'feature/demo']);
    git(repo, ['worktree', 'add', worktreePath, 'feature/demo']);
    git(repo, ['worktree', 'remove', worktreePath]);
    git(repo, ['checkout', 'feature/demo']);
    writeFileSync(path.join(repo, 'change.txt'), 'change');

    const result = performBranchActionGit({
      action: 'commit',
      branchName: 'feature/demo',
      baseBranch: 'main',
      worktreePath,
      primaryRepoPath: repo,
      message: 'commit from primary'
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(worktreeIsDirty(repo), false);

    rmSync(worktreeRoot, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it('reports a branch checked out nowhere instead of a missing path', () => {
    const repo = makeRepo();
    git(repo, ['branch', 'feature/idle']);
    const result = performBranchActionGit({
      action: 'commit',
      branchName: 'feature/idle',
      baseBranch: 'main',
      worktreePath: path.join(repo, 'missing'),
      primaryRepoPath: repo,
      message: 'noop'
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'BRANCH_NO_WORKTREE');
    rmSync(repo, { recursive: true, force: true });
  });

  it('requires a commit message for the commit action', () => {
    const result = performBranchActionGit({
      action: 'commit',
      branchName: 'feat',
      baseBranch: 'main',
      worktreePath: '/missing',
      primaryRepoPath: '/repo',
      message: '   '
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'BRANCH_COMMIT_MESSAGE_REQUIRED');
  });
});
