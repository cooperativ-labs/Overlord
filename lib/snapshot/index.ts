export {
  type CheckpointRef,
  type CleanupInput,
  createSnapshotBackend,
  type DiffInput,
  type ExportInput,
  type GitExportRef,
  GitWorktreeSnapshotBackend,
  JjCliSnapshotBackend,
  type ProjectSnapshotBinding,
  type RetryInput,
  type SnapshotCommandOptions,
  type SnapshotCommandResult,
  type SnapshotCommandRunner,
  type SnapshotHealth,
  type SnapshotInput,
  type SnapshotProjectSource,
  type UnifiedDiff,
  type WorkspaceBinding
} from './backend';
export {
  buildManagedBookmarkName,
  buildManagedShadowRepoPath,
  buildManagedSnapshotRoot,
  buildManagedWorkspaceName,
  buildManagedWorkspacePath,
  isManagedWorkspaceName
} from './paths';
export { resolveManagedSnapshotBaseDirectory } from './root';
export type { SnapshotBackend, SnapshotBinding, SnapshotIdentity } from './types';
