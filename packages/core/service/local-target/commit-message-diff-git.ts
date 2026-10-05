import { existsSync } from 'node:fs';

import { currentDiffArgs } from './current-diff-git.ts';
import { runGitResult } from './git-run.ts';
import { worktreeIsDirty } from './worktree-git.ts';

export type CommitMessageGatherErrorCode = 'BRANCH_NO_WORKTREE' | 'BRANCH_NOTHING_TO_COMMIT';

export type CommitMessageGatherResult =
  | { ok: true; diff: string }
  | { ok: false; code: CommitMessageGatherErrorCode; message: string; detail?: string };

/**
 * Read-only snapshot of uncommitted work for commit-message drafting. The diff
 * comes from the shared current-diff builder under the hardened inspection
 * configuration, so this and `readCurrentDiff` are one diff definition.
 */
export function collectWorktreeChanges(worktreePath: string): string {
  const status = runGitResult(worktreePath, ['status', '--porcelain'], { inspection: true });
  const diff = runGitResult(worktreePath, currentDiffArgs({ scope: 'all' }), { inspection: true });
  const sections: string[] = [];
  if (status.ok && status.stdout) {
    sections.push(`Changed files (git status --porcelain):\n${status.stdout}`);
  }
  if (diff.ok && diff.stdout) {
    sections.push(`Diff against HEAD:\n${diff.stdout}`);
  }
  return sections.join('\n\n');
}

export function gatherCommitMessageDiff(worktreePath: string): CommitMessageGatherResult {
  if (!existsSync(worktreePath)) {
    return {
      ok: false,
      code: 'BRANCH_NO_WORKTREE',
      message: `The branch's worktree is not present at ${worktreePath}.`
    };
  }
  if (!worktreeIsDirty(worktreePath)) {
    return {
      ok: false,
      code: 'BRANCH_NOTHING_TO_COMMIT',
      message: 'There are no uncommitted changes to draft a commit message from.',
      detail: worktreePath
    };
  }
  return { ok: true, diff: collectWorktreeChanges(worktreePath) };
}
