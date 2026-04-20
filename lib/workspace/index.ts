export { LocalWorkspaceClient } from './local';
export { RemoteWorkspaceClient } from './remote';
export { createWorkspaceClient } from './factory';
export type {
  AggregateDiffResult,
  CommitAndPushOptions,
  CommitAndPushResult,
  GitDiffOptions,
  GitDiffResult,
  GitStatusFile,
  GitStatusResult,
  ListFilesOptions,
  ListFilesResult,
  ReadFileOptions,
  ReadFileResult,
  SshAuthMethod,
  SshConnectionConfig,
  WorkspaceClient,
  WorkspaceConfig,
  WorkspaceHealth
} from './types';
