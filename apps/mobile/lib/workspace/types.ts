/**
 * Mobile-side workspace types — mirrors lib/workspace/types.ts at the repo root.
 * Kept as a lightweight local copy so the mobile app (Metro + RN) does not need
 * to pull Node-flavored modules out of the root lib/workspace/ directory.
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

export type ReadFileOptions = {
  path: string;
  maxBytes?: number;
};

/**
 * Per-server workspace helper configuration. The mobile client reaches the
 * Overlord remote-agent daemon directly — usually over Tailscale — at a URL
 * the user provides. The bearer token is issued by the helper install script
 * on the remote host (`~/.overlord/remote/token`).
 */
export type MobileHelperConfig = {
  serverId: string;
  baseUrl: string;
  authToken: string;
  remoteWorkingDirectory: string;
};
