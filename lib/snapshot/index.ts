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
  installLocalVersionControl,
  type InstallLocalVersionControlInput,
  type InstallLocalVersionControlResult
} from './install-local-version-control';
export {
  createLocalCheckpoint,
  type LocalCheckpointBackend,
  type LocalCheckpointInput,
  type LocalCheckpointResult
} from './local-checkpoint';
export {
  buildManagedBookmarkName,
  buildManagedShadowRepoPath,
  buildManagedSnapshotRoot,
  buildManagedWorkspaceName,
  buildManagedWorkspacePath,
  isManagedWorkspaceName
} from './paths';
export type { ManagedSnapshotContextPayload } from './prepare-managed-workspace';
export { prepareManagedSnapshotWorkspace } from './prepare-managed-workspace';
export { resolveManagedSnapshotBaseDirectory } from './root';
export type { SnapshotBackend, SnapshotBinding, SnapshotIdentity } from './types';
