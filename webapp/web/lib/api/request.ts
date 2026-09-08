import type { MetaDto } from '../../../shared/contract.ts';
import { fetchApi } from '../api-transport.ts';

export type LocalTargetServerCapability = 'in_process_server' | 'unavailable';

export interface MetaCapabilities {
  projects: boolean;
  missions: boolean;
  objectives: boolean;
  realtime: boolean;
  sqlStudio: boolean;
  launchAgents: boolean;
  executionTargets: boolean;
  localTarget: LocalTargetServerCapability;
  mcp: boolean;
}

/** Interactive login providers this backend offers (drives the auth UI). */
export interface AuthProviders {
  email: boolean;
  github: boolean;
}

export interface Meta extends MetaDto {
  databasePath: string;
  backendMode: 'local' | 'cloud';
  web: { host: string; port: number; url: string };
  sqlStudio: { enabled: boolean; url: string | null };
  authProviders: AuthProviders;
  capabilities: MetaCapabilities;
}

/** Error thrown for a non-2xx REST response; carries the server's typed `code`. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    /** Machine-readable code (e.g. `STATUS_UNAVAILABLE_FOR_WORKSPACE`), when present. */
    public code?: string,
    /**
     * The server's `detail` field on its own. `message` already folds this in for
     * generic display; `detail` is kept separate so callers that render a tailored
     * message per `code` can surface the specifics (paths, files) on their own line.
     */
    public detail?: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Build an {@link ApiRequestError} from a non-2xx response, folding the server's
 * JSON `error`/`detail`/`code` shape into a display message. Shared by every
 * request helper so error extraction lives in one place.
 */
async function parseErrorResponse(res: Response): Promise<ApiRequestError> {
  let message = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  let detail: string | undefined;
  try {
    const payload = (await res.json()) as { error?: string; detail?: string; code?: string };
    message = payload.error ?? message;
    detail = payload.detail;
    if (payload.detail) message += ` — ${payload.detail}`;
    code = payload.code;
  } catch {
    /* non-JSON error body */
  }
  return new ApiRequestError(message, res.status, code, detail);
}

export async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  rawHeaders?: Record<string, string>
): Promise<T> {
  // A Blob/File body is sent as-is (used by the upload service); everything else
  // is JSON. `rawHeaders` lets callers send a binary body with its own headers.
  const isRaw = rawHeaders !== undefined;
  const res = await fetchApi(url, {
    method,
    headers: isRaw
      ? rawHeaders
      : body !== undefined
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body: isRaw ? (body as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function parseDownloadFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const basic = disposition.match(/filename="([^"]+)"/i) ?? disposition.match(/filename=([^;]+)/i);
  return basic?.[1]?.trim() ?? null;
}

export async function requestDownload(
  method: string,
  url: string
): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetchApi(url, { method });
  if (!res.ok) {
    throw await parseErrorResponse(res);
  }
  return {
    blob: await res.blob(),
    filename: parseDownloadFilename(res.headers.get('content-disposition'))
  };
}
