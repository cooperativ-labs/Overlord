/**
 * Unified workspace types.
 *
 * A WorkspaceClient provides filesystem and git operations against a project's
 * working directory, regardless of whether that directory lives locally or on
 * a remote host reached through the Overlord remote helper. Both the Electron
 * desktop app and the mobile app consume this interface.
 */

export type GitStatusFile = {
  linesAdded: number | null;
  linesRemoved: number | null;
  originalPath: string | null;
  path: string;
  stagedStatus: string;
  status: string;
  unstagedStatus: string;
};

export type GitStatusResult = {
  branch: string | null;
  files: GitStatusFile[];
  linkedDirectory: string | null;
  repoRoot: string | null;
  error?: string;
};

export type GitDiffResult = {
  diff: string;
  path: string | null;
  repoRoot: string | null;
  status: string | null;
  error?: string;
};

export type ListFilesResult = {
  files: string[];
  linkedDirectory: string | null;
  truncated: boolean;
  error?: string;
};

export type AggregateDiffResult = {
  branch: string | null;
  diff: string;
  filesChanged: number;
  repoRoot: string | null;
  status: string;
  error?: string;
};

export type GitBranchEntry = {
  current: boolean;
  name: string;
  upstream: string | null;
};

export type GitBranchesResult = {
  branches: GitBranchEntry[];
  currentBranch: string | null;
  defaultBranch: string | null;
  repoRoot: string | null;
  error?: string;
};

export type GitBranchOperationResult = {
  ok: boolean;
  branch: string | null;
  error?: string;
};

export type GitPullResult = {
  ok: boolean;
  branch: string | null;
  output: string;
  error?: string;
};

export type GitPushResult = {
  ok: boolean;
  branch: string | null;
  pushed: boolean;
  output: string;
  error?: string;
};

export type GitCreatePullRequestResult = {
  ok: boolean;
  branch: string | null;
  number: number | null;
  url: string | null;
  error?: string;
};

export type CommitAndPushResult = {
  ok: boolean;
  branch: string | null;
  commitSha: string | null;
  pushed: boolean;
  error?: string;
};

export type ReadFileResult = {
  content: string;
  path: string;
  truncated: boolean;
  error?: string;
};

export type WorkspaceHealth = {
  ok: boolean;
  error?: string;
  helperVersion?: string;
};

export type ListFilesOptions = {
  maxDepth?: number;
  maxEntriesPerDirectory?: number;
  maxFiles?: number;
};

export type GitDiffOptions = {
  originalPath?: string;
  path: string;
  status?: string;
};

export type GitBranchOptions = {
  name: string;
};

export type ReadFileOptions = {
  path: string;
  maxBytes?: number;
};

export type CommitAndPushOptions = {
  message: string;
};

export type CreatePullRequestOptions = {
  baseBranch?: string;
  body: string;
  title: string;
};

/**
 * WorkspaceClient — the contract every workspace (local or remote) implements.
 * Every method must be safe to call with the workspace's configured
 * working directory; implementations resolve repo roots internally.
 */
export interface WorkspaceClient {
  readonly kind: 'local' | 'remote';
  readonly workingDirectory: string;

  checkHealth(): Promise<WorkspaceHealth>;
  directoryExists(): Promise<boolean>;
  listProjectFiles(options?: ListFilesOptions): Promise<ListFilesResult>;
  readFile(options: ReadFileOptions): Promise<ReadFileResult>;
  getGitStatus(): Promise<GitStatusResult>;
  getGitDiff(options: GitDiffOptions): Promise<GitDiffResult>;
  getAggregateDiff(): Promise<AggregateDiffResult>;
  getGitBranches(): Promise<GitBranchesResult>;
  checkoutBranch(options: GitBranchOptions): Promise<GitBranchOperationResult>;
  createBranch(options: GitBranchOptions): Promise<GitBranchOperationResult>;
  pullBranch(): Promise<GitPullResult>;
  pushBranch(): Promise<GitPushResult>;
  commitAndPush(options: CommitAndPushOptions): Promise<CommitAndPushResult>;
  createPullRequest(options: CreatePullRequestOptions): Promise<GitCreatePullRequestResult>;
  dispose?(): Promise<void> | void;
}

/**
 * Structured SSH connection configuration — replaces the legacy free-form
 * ssh_command string. Supports ssh-agent (default) and explicit private key.
 */
export type SshAuthMethod = 'agent' | 'key' | 'tailscale';

export type SshConnectionConfig = {
  host: string;
  port?: number;
  user: string;
  authMethod: SshAuthMethod;
  privateKeyPath?: string;
  /** Optional passphrase for private keys that are not loaded into ssh-agent. */
  passphrase?: string;
};

/**
 * Tailscale presence — surfaced to the renderer so the SSH config panel can
 * hint when Tailscale SSH is usable. Populated by shelling out to the
 * `tailscale` CLI from the Electron main process.
 */
export type TailscaleStatus = {
  installed: boolean;
  running: boolean;
  loggedIn: boolean;
  selfName: string | null;
  tailnet: string | null;
  error?: string;
};

/**
 * Configuration for creating a workspace client.
 */
export type WorkspaceConfig =
  | {
      mode: 'local';
      workingDirectory: string;
    }
  | {
      mode: 'remote';
      ssh: SshConnectionConfig;
      remoteWorkingDirectory: string;
      /** Local port that the Electron/mobile tunnel has forwarded to the remote helper. */
      tunnelEndpoint: { host: string; port: number };
      /** Bearer token issued at helper install time, stored on the remote host. */
      helperAuthToken: string;
    };
