/**
 * Mobile RemoteWorkspaceClient — talks to the Overlord remote-agent HTTP
 * daemon over a direct base URL (e.g. a tailnet-bound host:port). No SSH
 * port-forward is required: mobile relies on the device's VPN/Tailscale
 * stack reaching the helper. See ai/feature-plans/tailscale-ssh-followups.md
 * item #6 option 2.
 */

import type {
  GitDiffOptions,
  GitDiffResult,
  GitStatusResult,
  ListFilesOptions,
  ListFilesResult,
  ReadFileOptions,
  ReadFileResult,
  WorkspaceHealth
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

export type MobileRemoteClientOptions = {
  baseUrl: string;
  authToken: string;
  remoteWorkingDirectory: string;
  timeoutMs?: number;
};

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Helper URL is required.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Helper URL must start with http:// or https://');
  }
  return trimmed;
}

export class MobileRemoteWorkspaceClient {
  readonly workingDirectory: string;
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;

  constructor(options: MobileRemoteClientOptions) {
    if (!options.remoteWorkingDirectory?.trim()) {
      throw new Error('remoteWorkingDirectory is required.');
    }
    if (!options.authToken) throw new Error('authToken is required.');
    this.workingDirectory = options.remoteWorkingDirectory.trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.authToken}` },
        signal: controller.signal
      });
      if (!response.ok) return { ok: false, error: `Helper returned ${response.status}` };
      const data = (await response.json()) as { ok: boolean; version?: string };
      return { ok: Boolean(data.ok), helperVersion: data.version };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Helper unreachable.' };
    } finally {
      clearTimeout(timer);
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
}
