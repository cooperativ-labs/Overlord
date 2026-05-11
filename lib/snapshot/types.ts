export const snapshotBackends = ['git-worktree', 'jj'] as const;

export type SnapshotBackend = (typeof snapshotBackends)[number];

export type SnapshotIdentity = {
  backend: SnapshotBackend;
  jjChangeId: string | null;
  jjCommitId: string | null;
  jjOperationId: string | null;
};

export type SnapshotBinding = {
  baseGitCommitId: string | null;
  baseJjCommitId: string | null;
  backend: SnapshotBackend;
  projectId: string;
  shadowRepoPath: string;
  workspaceName: string;
  workspacePath: string;
};
