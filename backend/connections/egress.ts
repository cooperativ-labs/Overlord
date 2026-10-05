/**
 * Outbound HTTP for account connections. Every request must target an approved
 * HTTPS origin, never follows redirects, has a time bound, and reads at most a
 * bounded number of body bytes (the Knowledgebase applies no output cap of its
 * own). Callers never log request or response bodies.
 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class EgressError extends Error {
  constructor(
    readonly code: 'egress_denied' | 'timeout' | 'network' | 'redirect',
    message = code
  ) {
    super(message);
  }
}

export interface EgressResponse {
  status: number;
  headers: Headers;
  text: string;
  /** True when the body exceeded `maxBytes` and was cut off. */
  truncated: boolean;
  bytes: number;
}

export function assertEgress(url: string, allowedOrigins: readonly string[]): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EgressError('egress_denied');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !allowedOrigins.includes(parsed.origin)
  )
    throw new EgressError('egress_denied');
  return parsed;
}

export async function egressFetch(
  fetchImpl: FetchLike,
  allowedOrigins: readonly string[],
  url: string,
  init: RequestInit,
  bounds: { timeoutMs: number; maxBytes: number; signal?: AbortSignal }
): Promise<EgressResponse> {
  assertEgress(url, allowedOrigins);
  const timeout = AbortSignal.timeout(bounds.timeoutMs);
  const signal = bounds.signal ? AbortSignal.any([timeout, bounds.signal]) : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'manual', signal });
  } catch {
    throw new EgressError(timeout.aborted ? 'timeout' : 'network');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new EgressError('redirect');
  }
  const chunks: Uint8Array[] = [];
  let bytes = 0,
    truncated = false;
  try {
    const reader = response.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      if (bytes + value.byteLength > bounds.maxBytes) {
        chunks.push(value.subarray(0, bounds.maxBytes - bytes));
        bytes = bounds.maxBytes;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
  } catch {
    throw new EgressError(timeout.aborted ? 'timeout' : 'network');
  }
  return {
    status: response.status,
    headers: response.headers,
    text: Buffer.concat(chunks).toString('utf8'),
    truncated,
    bytes
  };
}
