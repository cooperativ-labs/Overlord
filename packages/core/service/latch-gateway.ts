/**
 * Latch v2 gateway discovery for Overlord's Conversation Hub client (coo:833).
 *
 * `latch serve` binds a loopback HTTP/WebSocket gateway (default
 * `127.0.0.1:4610`) and authenticates every request with the bearer token it
 * mints at `$LATCH_HOME/serve.token`. Overlord dials that gateway **only** over
 * loopback: the gateway speaks plaintext HTTP, so the token is safe nowhere
 * else, and Latch itself grants a loopback caller that presents no
 * `x-latch-device-grant` header the `control` grant — which is what makes the
 * `interact`-grant `send_message` operation available to a local Overlord
 * process without opening the session's single terminal surface (the terminal
 * channel is a different route; see Latch `docs/DECISION_EXCLUSIVE_ATTACH.md`).
 *
 * The token travels in the `latch.v2.<token>` WebSocket subprotocol rather than
 * an `Authorization` header because the platform `WebSocket` client cannot set
 * request headers. Latch accepts either.
 */

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SUPPORTED_LATCH_PROTOCOL_VERSION } from './latch-discovery.ts';

/** Where `latch serve` binds unless the operator moved it. */
export const DEFAULT_LATCH_GATEWAY_URL = 'http://127.0.0.1:4610';

/** Latch's protocol-major-2 WebSocket subprotocol, `latch.v2.<token>`. */
export const LATCH_GATEWAY_SUBPROTOCOL_PREFIX = 'latch.v2.';

/** Filename Latch mints the gateway bearer token into, under its state root. */
export const LATCH_SERVE_TOKEN_FILENAME = 'serve.token';

/** How long a gateway capabilities probe may take before it is unreachable. */
export const LATCH_GATEWAY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Latch is not reachable, not configured, or is a build that cannot carry a
 * conversation. Distinct from a refusal by a gateway we did reach.
 */
export class LatchGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatchGatewayError';
  }
}

export type LatchGatewayConfig = {
  /** Origin of the loopback gateway, without a trailing slash. */
  baseUrl: string;
  /** Bearer token minted by `latch serve`. */
  token: string;
};

export type LatchGatewayEndpoints = {
  sessions: boolean;
  terminal: boolean;
  conversation: boolean;
  preview: boolean | null;
};

export type LatchGatewayCapabilities = {
  protocolVersion: number;
  productVersion: string;
  endpoints: LatchGatewayEndpoints;
  exclusiveTerminal: boolean;
  gatewayInstanceId: string;
  operationRetentionSeconds: number;
};

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Loopback allow-list. Written as an allow-list rather than a wildcard denial
 * so no bind-everything literal can ever appear in this file — the source guard
 * fixture pins that property.
 */
function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Latch's state root: `LATCH_HOME`, else `~/.latch`. */
export function latchHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return trimmed(env.LATCH_HOME) ?? path.join(os.homedir(), '.latch');
}

/**
 * Resolve where the gateway lives and which token opens it. Environment
 * overrides exist for an operator who moved the bind or the token file; the
 * defaults match `latch serve` with no flags.
 */
export function resolveLatchGatewayConfig({
  env = process.env,
  readFile = (filePath: string) => readFileSync(filePath, 'utf8'),
  fileExists = existsSync
}: {
  env?: NodeJS.ProcessEnv;
  readFile?: (filePath: string) => string;
  fileExists?: (filePath: string) => boolean;
} = {}): LatchGatewayConfig {
  const rawUrl = trimmed(env.LATCH_GATEWAY_URL) ?? DEFAULT_LATCH_GATEWAY_URL;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new LatchGatewayError(`LATCH_GATEWAY_URL is not a URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:') {
    throw new LatchGatewayError('The Latch gateway must be reached over http on loopback.');
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new LatchGatewayError(
      `Refusing to reach the Latch gateway at a non-loopback host (${parsed.hostname}).`
    );
  }

  const inlineToken = trimmed(env.LATCH_GATEWAY_TOKEN);
  if (inlineToken) return { baseUrl: parsed.origin, token: inlineToken };

  const tokenFile =
    trimmed(env.LATCH_SERVE_TOKEN_FILE) ??
    path.join(latchHomeDirectory(env), LATCH_SERVE_TOKEN_FILENAME);
  if (!fileExists(tokenFile)) {
    throw new LatchGatewayError(
      `Latch's gateway token is missing (${tokenFile}). Start it with \`latch serve\`.`
    );
  }
  let token: string | null = null;
  try {
    token = trimmed(readFile(tokenFile));
  } catch {
    throw new LatchGatewayError(`Latch's gateway token could not be read (${tokenFile}).`);
  }
  if (!token) throw new LatchGatewayError(`Latch's gateway token is empty (${tokenFile}).`);
  return { baseUrl: parsed.origin, token };
}

function parseEndpoints(value: unknown): LatchGatewayEndpoints | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cast = value as Record<string, unknown>;
  return {
    sessions: cast.sessions === true,
    terminal: cast.terminal === true,
    // Absent means "this gateway predates the route", which a client must read
    // as unavailable rather than as false-by-default.
    preview: typeof cast.preview === 'boolean' ? cast.preview : null,
    conversation: cast.conversation === true
  };
}

/** Parse `GET /v2/capabilities`; null when the document is not a v2 report. */
export function parseLatchGatewayCapabilities(raw: unknown): LatchGatewayCapabilities | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const cast = raw as Record<string, unknown>;
  const protocolVersion =
    typeof cast.protocolVersion === 'number' && Number.isFinite(cast.protocolVersion)
      ? Math.trunc(cast.protocolVersion)
      : null;
  const productVersion = trimmed(cast.productVersion);
  const endpoints = parseEndpoints(cast.endpoints);
  const gatewayInstanceId = trimmed(cast.gatewayInstanceId);
  if (protocolVersion === null || !productVersion || !endpoints || !gatewayInstanceId) return null;
  const features =
    cast.features && typeof cast.features === 'object' && !Array.isArray(cast.features)
      ? (cast.features as Record<string, unknown>)
      : {};
  return {
    protocolVersion,
    productVersion,
    endpoints,
    exclusiveTerminal: features.exclusiveTerminal === true,
    gatewayInstanceId,
    operationRetentionSeconds:
      typeof cast.operationRetentionSeconds === 'number' &&
      Number.isFinite(cast.operationRetentionSeconds)
        ? Math.trunc(cast.operationRetentionSeconds)
        : 0
  };
}

/** Read the gateway's discovery document. Throws when it cannot be reached. */
export async function readLatchGatewayCapabilities({
  gateway,
  fetchImpl = fetch,
  timeoutMs = LATCH_GATEWAY_PROBE_TIMEOUT_MS
}: {
  gateway: LatchGatewayConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<LatchGatewayCapabilities> {
  let response: Response;
  try {
    response = await fetchImpl(`${gateway.baseUrl}/v2/capabilities`, {
      headers: { authorization: `Bearer ${gateway.token}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new LatchGatewayError(
      `Latch's gateway is not answering at ${gateway.baseUrl}. Start it with \`latch serve\`.`
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new LatchGatewayError("Latch's gateway rejected Overlord's token.");
  }
  if (!response.ok) {
    throw new LatchGatewayError(`Latch's gateway answered ${response.status} for capabilities.`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LatchGatewayError("Latch's gateway returned an invalid capabilities document.");
  }
  const parsed = parseLatchGatewayCapabilities(payload);
  if (!parsed) {
    throw new LatchGatewayError("Latch's gateway returned an unrecognized capabilities document.");
  }
  return parsed;
}

/**
 * Resolve a gateway that can actually carry a conversation: protocol major 2
 * and the conversation endpoint served. Anything else fails here rather than on
 * an upgrade that would only report a 404.
 */
export async function requireLatchConversationGateway({
  gateway,
  env,
  fetchImpl,
  timeoutMs
}: {
  gateway?: LatchGatewayConfig | null;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<{ gateway: LatchGatewayConfig; capabilities: LatchGatewayCapabilities }> {
  const resolved = gateway ?? resolveLatchGatewayConfig({ env });
  const capabilities = await readLatchGatewayCapabilities({
    gateway: resolved,
    fetchImpl,
    timeoutMs
  });
  if (capabilities.protocolVersion !== SUPPORTED_LATCH_PROTOCOL_VERSION) {
    throw new LatchGatewayError(
      `Latch gateway protocolVersion ${capabilities.protocolVersion} is not supported (need ${SUPPORTED_LATCH_PROTOCOL_VERSION}).`
    );
  }
  if (!capabilities.endpoints.conversation) {
    throw new LatchGatewayError('This Latch gateway does not serve the conversation endpoint.');
  }
  return { gateway: resolved, capabilities };
}

/** WebSocket URL for one session's Conversation Hub channel. */
export function latchConversationSocketUrl({
  gateway,
  providerSessionId
}: {
  gateway: LatchGatewayConfig;
  providerSessionId: string;
}): string {
  const base = new URL(gateway.baseUrl);
  base.protocol = 'ws:';
  base.pathname = `/v2/sessions/${encodeURIComponent(providerSessionId)}/conversation`;
  return base.toString();
}

/** The subprotocol that carries the bearer token on the upgrade. */
export function latchConversationSubprotocol(gateway: LatchGatewayConfig): string {
  return `${LATCH_GATEWAY_SUBPROTOCOL_PREFIX}${gateway.token}`;
}
