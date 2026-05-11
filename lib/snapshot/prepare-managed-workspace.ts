import { createSnapshotBackend } from './backend';

/** Payload shape aligned with protocol `snapshotContextSchema` / `X-Overlord-Snapshot-Context`. */
export type ManagedSnapshotContextPayload = {
  backend: string;
  baseGitCommitId: null;
  baseJjCommitId: null;
  projectId: string;
  shadowRepoPath: string;
  workspaceName: string;
  workspacePath: string;
};

/**
 * Provisions a managed JJ (or git-worktree) workspace on the **local filesystem**
 * where `sourceDirectory` is reachable (Desktop / CLI host). Intended for
 * Electron and `ovld` launch flows — not for serverless API handlers that cannot
 * see the user's disk.
 */
export async function prepareManagedSnapshotWorkspace(args: {
  projectId: string;
  sourceDirectory: string;
  sessionId: string;
  ticketId: string;
  ticketSequence: number;
  prefer?: 'jj' | 'git-worktree';
}): Promise<ManagedSnapshotContextPayload | null> {
  try {
    const snapshotBackend = await createSnapshotBackend({
      projectId: args.projectId,
      sourceDirectory: args.sourceDirectory,
      prefer: args.prefer ?? 'jj'
    });
    const projectSnapshot = await snapshotBackend.prepareProject({
      projectId: args.projectId,
      sourceDirectory: args.sourceDirectory,
      gitRemoteUrl: null
    });
    const workspace = await snapshotBackend.createWorkspace({
      baseGitCommitId: null,
      baseJjCommitId: null,
      projectId: args.projectId,
      sessionId: args.sessionId,
      sourceBinding: projectSnapshot,
      ticketId: args.ticketId,
      ticketSequence: args.ticketSequence
    });

    return {
      backend: workspace.backend,
      baseGitCommitId: null,
      baseJjCommitId: null,
      projectId: args.projectId,
      shadowRepoPath: workspace.shadowRepoPath ?? args.sourceDirectory,
      workspaceName: workspace.workspaceName ?? args.sessionId,
      workspacePath: workspace.workspacePath
    };
  } catch (error) {
    console.warn('[prepareManagedSnapshotWorkspace] failed:', error);
    return null;
  }
}
