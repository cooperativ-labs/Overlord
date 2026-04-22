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
const DEFAULT_MAX_RETRIES = 1;
const RETRY_BASE_DELAY_MS = 750;

export type RemoteHelperErrorKind =
  | 'timeout'
  | 'network'
  | 'auth'
  | 'helper_error'
  | 'bad_response';

export class RemoteHelperError extends Error {
  readonly kind: RemoteHelperErrorKind;
  readonly status?: number;

  constructor(kind: RemoteHelperErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'RemoteHelperError';
    this.kind = kind;
    this.status = status;
  }
}

export type MobileRemoteClientOptions = {
  baseUrl: string;
  authToken: string;
  remoteWorkingDirectory: string;
  timeoutMs?: number;
  maxRetries?: number;
};

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Helper URL is required.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Helper URL must start with http:// or https://');
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapFetchError(error: unknown): RemoteHelperError {
  if (error instanceof RemoteHelperError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new RemoteHelperError('timeout', 'Helper request timed out.');
    }
    return new RemoteHelperError('network', error.message || 'Helper unreachable.');
  }
  return new RemoteHelperError('network', 'Helper unreachable.');
}

export class MobileRemoteWorkspaceClient {
  readonly workingDirectory: string;
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: MobileRemoteClientOptions) {
    if (!options.remoteWorkingDirectory?.trim()) {
      throw new Error('remoteWorkingDirectory is required.');
    }
    if (!options.authToken) throw new Error('authToken is required.');
    this.workingDirectory = options.remoteWorkingDirectory.trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private async performRequest(path: string, body?: unknown): Promise<unknown> {
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
        const snippet = text.slice(0, 500);
        if (response.status === 401 || response.status === 403) {
          throw new RemoteHelperError(
            'auth',
            `Helper auth rejected (${response.status}).`,
            response.status
          );
        }
        throw new RemoteHelperError(
          'helper_error',
          `Remote helper responded ${response.status}: ${snippet}`,
          response.status
        );
      }
      if (!text) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        throw new RemoteHelperError('bad_response', 'Helper returned non-JSON payload.');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(
    path: string,
    body: unknown,
    validate: (value: unknown) => T
  ): Promise<T> {
    let lastError: RemoteHelperError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const raw = await this.performRequest(path, body);
        return validate(raw);
      } catch (error) {
        const mapped = mapFetchError(error);
        // Only retry transient network/timeout conditions; auth and
        // bad_response are deterministic and will not resolve by retrying.
        const retriable = mapped.kind === 'network' || mapped.kind === 'timeout';
        if (!retriable || attempt === this.maxRetries) {
          throw mapped;
        }
        lastError = mapped;
        await sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }
    throw lastError ?? new RemoteHelperError('network', 'Helper unreachable.');
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
      const data = (await response.json()) as unknown;
      if (!isRecord(data)) return { ok: false, error: 'Helper returned malformed health payload.' };
      const version = typeof data.version === 'string' ? data.version : undefined;
      return { ok: Boolean(data.ok), helperVersion: version };
    } catch (error) {
      const mapped = mapFetchError(error);
      return { ok: false, error: mapped.message };
    } finally {
      clearTimeout(timer);
    }
  }

  directoryExists(): Promise<boolean> {
    return this.request<boolean>('/directory-exists', undefined, raw => {
      if (!isRecord(raw) || typeof raw.exists !== 'boolean') {
        throw new RemoteHelperError('bad_response', 'Invalid directory-exists response.');
      }
      return raw.exists;
    });
  }

  listProjectFiles(options?: ListFilesOptions): Promise<ListFilesResult> {
    return this.request<ListFilesResult>('/list-project-files', { options }, raw => {
      if (!isRecord(raw) || !Array.isArray(raw.files)) {
        throw new RemoteHelperError('bad_response', 'Invalid list-project-files response.');
      }
      return raw as unknown as ListFilesResult;
    });
  }

  readFile(options: ReadFileOptions): Promise<ReadFileResult> {
    return this.request<ReadFileResult>('/read-file', { options }, raw => {
      if (!isRecord(raw) || typeof raw.content !== 'string' || typeof raw.path !== 'string') {
        throw new RemoteHelperError('bad_response', 'Invalid read-file response.');
      }
      return raw as unknown as ReadFileResult;
    });
  }

  getGitStatus(): Promise<GitStatusResult> {
    return this.request<GitStatusResult>('/git/status', undefined, raw => {
      if (!isRecord(raw) || !Array.isArray(raw.files)) {
        throw new RemoteHelperError('bad_response', 'Invalid git status response.');
      }
      return raw as unknown as GitStatusResult;
    });
  }

  getGitDiff(options: GitDiffOptions): Promise<GitDiffResult> {
    return this.request<GitDiffResult>('/git/diff', { options }, raw => {
      if (!isRecord(raw) || typeof raw.diff !== 'string') {
        throw new RemoteHelperError('bad_response', 'Invalid git diff response.');
      }
      return raw as unknown as GitDiffResult;
    });
  }
}
