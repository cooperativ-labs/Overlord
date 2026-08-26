import {
  branchHasUnpushedCommits,
  type BranchPublicationStatus,
  deriveBranchPublicationStatus
} from './branch-status-git.ts';
import { resolveBranchCheckoutPath, worktreeIsDirty } from './worktree-git.ts';

export interface BranchObservationInput {
  repoPath: string;
  branchName: string;
  baseBranch: string | null;
  /** Canonical or predicted worktree path when git cannot resolve one yet. */
  worktreePathHint?: string | null;
}

export interface BranchObservationResult {
  status: BranchPublicationStatus;
  dirty: boolean;
  worktreePath: string | null;
  /** Local branch tip is ahead of `origin/<branchName>`. */
  hasUnpushedCommits: boolean;
}

/** Observe live branch publication status, worktree location, and dirty state. */
export function observeMissionBranchGit(input: BranchObservationInput): BranchObservationResult {
  const status = deriveBranchPublicationStatus(input);
  const resolved = resolveBranchCheckoutPath({
    repoPath: input.repoPath,
    branchName: input.branchName,
    worktreePathHint: input.worktreePathHint
  });
  return {
    status,
    dirty: resolved ? worktreeIsDirty(resolved) : false,
    worktreePath: resolved,
    hasUnpushedCommits:
      status === 'published' &&
      branchHasUnpushedCommits({ repoPath: input.repoPath, branchName: input.branchName })
  };
}
