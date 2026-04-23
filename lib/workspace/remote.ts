/**
 * RemoteWorkspaceClient — talks to the Overlord remote helper over HTTP.
 *
 * The tunnel endpoint is a local port that the Electron tunnel manager (or the
 * mobile app's SSH tunnel) has forwarded to the helper process running on the
 * remote host. The helper listens on 127.0.0.1 on the remote side; the
 * port-forward means we address it as if it were on our local machine.
 *
 * All requests carry the bearer token issued during `overlord install-remote`.
 */

import type {
  AggregateDiffResult,
  CommitAndPushOptions,
  CommitAndPushResult,
  CreatePullRequestOptions,
  GitBranchesResult,
  GitBranchOperationResult,
  GitBranchOptions,
  GitCreatePullRequestResult,
  GitDiffOptions,
  GitDiffResult,
  GitPullResult,
  GitPushResult,
  GitStatusResult,
  ListFilesOptions,
  ListFilesResult,
  ReadFileOptions,
  ReadFileResult,
  WorkspaceClient,
  WorkspaceHealth
} from './types';

export type RemoteWorkspaceClientOptions = {
  endpoint: { host: string; port: number };
  authToken: string;
  remoteWorkingDirectory: string;
  /** Provided by the Electron main process or mobile client; lets us inject the tunneled fetch. */
  fetchImpl?: typeof fetch;
  /** Request timeout in ms. Defaults to 30s — helper calls are lightweight. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;

export class RemoteWorkspaceClient implements WorkspaceClient {
  readonly kind = 'remote' as const;
  readonly workingDirectory: string;

  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: RemoteWorkspaceClientOptions) {
    if (!options.remoteWorkingDirectory?.trim()) {
      throw new Error('remoteWorkingDirectory is required.');
    }
    if (!options.authToken) throw new Error('authToken is required.');

    this.workingDirectory = options.remoteWorkingDirectory.trim();
    this.baseUrl = `http://${options.endpoint.host}:${options.endpoint.port}`;
    this.authToken = options.authToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.authToken}`
        },
        body: JSON.stringify({ workingDirectory: this.workingDirectory, ...(body ?? {}) }),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Remote helper responded ${response.status}: ${text.slice(0, 500)}`);
      }
      return text ? (JSON.parse(text) as T) : (undefined as T);
    } finally {
      clearTimeout(timer);
    }
  }

  async checkHealth(): Promise<WorkspaceHealth> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.authToken}` }
      });
      if (!response.ok) return { ok: false, error: `Helper returned ${response.status}` };
      const data = (await response.json()) as { ok: boolean; version?: string };
      return { ok: Boolean(data.ok), helperVersion: data.version };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Helper unreachable.' };
    }
  }

  directoryExists(): Promise<boolean> {
    return this.request<{ exists: boolean }>('/directory-exists').then(r => r.exists);
  }

  listProjectFiles(options?: ListFilesOptions): Promise<ListFilesResult> {
    return this.request<ListFilesResult>('/list-project-files', { options });
  }

  readFile(options: ReadFileOptions): Promise<ReadFileResult> {
    return this.request<ReadFileResult>('/read-file', { options });
  }

  getGitStatus(): Promise<GitStatusResult> {
    return this.request<GitStatusResult>('/git/status');
  }

  getGitDiff(options: GitDiffOptions): Promise<GitDiffResult> {
    return this.request<GitDiffResult>('/git/diff', { options });
  }

  getAggregateDiff(): Promise<AggregateDiffResult> {
    return this.request<AggregateDiffResult>('/git/aggregate-diff');
  }

  getGitBranches(): Promise<GitBranchesResult> {
    return this.request<GitBranchesResult>('/git/branches');
  }

  checkoutBranch(options: GitBranchOptions): Promise<GitBranchOperationResult> {
    return this.request<GitBranchOperationResult>('/git/checkout-branch', { options });
  }

  createBranch(options: GitBranchOptions): Promise<GitBranchOperationResult> {
    return this.request<GitBranchOperationResult>('/git/create-branch', { options });
  }

  pullBranch(): Promise<GitPullResult> {
    return this.request<GitPullResult>('/git/pull');
  }

  pushBranch(): Promise<GitPushResult> {
    return this.request<GitPushResult>('/git/push');
  }

  commitAndPush(options: CommitAndPushOptions): Promise<CommitAndPushResult> {
    return this.request<CommitAndPushResult>('/git/commit-and-push', { options });
  }

  createPullRequest(options: CreatePullRequestOptions): Promise<GitCreatePullRequestResult> {
    return this.request<GitCreatePullRequestResult>('/git/create-pull-request', { options });
  }
}
