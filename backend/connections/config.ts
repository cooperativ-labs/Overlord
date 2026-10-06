import { type KeyRing, keyRingFromEnv, type RingKey } from './keyring.ts';

/** The standard Knowledgebase MCP resource every deployment connects to by default (v156). */
export const DEFAULT_KNOWLEDGEBASE_MCP_URL = 'https://knowledge.chaselubitz.com/mcp';
/** `KNOWLEDGEBASE_MCP_URL` values that turn the provider off on this deployment. */
const DISABLED_VALUES = new Set(['off', 'none', 'disabled', 'false']);

/**
 * Server configuration for the account-connections module (contract v152, v156).
 *
 * - `KNOWLEDGEBASE_MCP_URL`: an operator override of the one Knowledgebase MCP
 *   resource (HTTPS, validated here and enforced by egress). Unset means the
 *   standard server (`DEFAULT_KNOWLEDGEBASE_MCP_URL`, v156); `off` turns the
 *   provider off. Users never choose a server: one deployment talks to one
 *   Knowledgebase origin, so egress stays a fixed, operator-reviewed allowlist.
 * - `KNOWLEDGEBASE_EGRESS_ORIGINS`: additional approved HTTPS origins (comma
 *   separated) for the authorization server when it is not on the MCP origin.
 * - `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY`: 32-byte base64url AES-256-GCM key for
 *   credential envelopes; `ACCOUNT_CONNECTIONS_ENCRYPTION_KEY_ID` names it
 *   (default `k1`). An envelope written under another key id is unreadable and
 *   the connection requires reauthorization. Optional since v156: without it the
 *   module uses the platform key derived from `BETTER_AUTH_SECRET` (see
 *   `keyring.ts`), so no connecting user or operator generates a key.
 * - Since v153 these form the current entry of a key ring that also carries the
 *   reserved fallback ids `everhour-env` (`EVERHOUR_API_KEY_ENCRYPTION_KEY`,
 *   falling back to `GITHUB_USER_TOKEN_ENCRYPTION_KEY`) and `github-user-env`
 *   (`GITHUB_USER_TOKEN_ENCRYPTION_KEY`) for profile-scoped providers.
 */
export interface ConnectionsConfig {
  knowledgebase: {
    mcpUrl: string;
    /** Every origin the backend may contact for this provider, including the MCP origin. */
    egressOrigins: string[];
    /** `default` for the standard server, `configured` for an operator override. */
    source: 'default' | 'configured';
  } | null;
  /**
   * The Knowledgebase write key: the explicit current key, else the platform key.
   * Knowledgebase has no fallback key.
   */
  encryption: { key: Buffer; keyId: string } | null;
  keyRing: KeyRing;
  /** Public backend origin that serves the client metadata document and callback. */
  publicBaseUrl: string;
  /** Web origin the callback returns to for `returnTo: 'web'`, or null for a status page. */
  webReturnOrigin: string | null;
}

export class ConnectionsConfigError extends Error {}

function httpsOrigin(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConnectionsConfigError(`${label} is not a URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new ConnectionsConfigError(`${label} must be an HTTPS URL without credentials`);
  return url.origin;
}

export function connectionsConfigFromEnv(
  env: NodeJS.ProcessEnv,
  publicBaseUrl: string,
  webReturnOrigin: string | null
): ConnectionsConfig {
  const override = env.KNOWLEDGEBASE_MCP_URL?.trim();
  const disabled = override !== undefined && DISABLED_VALUES.has(override.toLowerCase());
  const mcpRaw = disabled ? '' : override || DEFAULT_KNOWLEDGEBASE_MCP_URL;
  let knowledgebase: ConnectionsConfig['knowledgebase'] = null;
  if (mcpRaw) {
    const mcpOrigin = httpsOrigin(mcpRaw, 'KNOWLEDGEBASE_MCP_URL');
    const extra = (env.KNOWLEDGEBASE_EGRESS_ORIGINS ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .map(value => httpsOrigin(value, 'KNOWLEDGEBASE_EGRESS_ORIGINS'));
    const url = new URL(mcpRaw);
    url.hash = '';
    knowledgebase = {
      mcpUrl: url.toString(),
      egressOrigins: [...new Set([mcpOrigin, ...extra])],
      source: override ? 'configured' : 'default'
    };
  }
  const keyRing = keyRingFromEnv(env);
  const kbKey: RingKey | null = keyRing.current ?? keyRing.platform;
  return {
    knowledgebase,
    encryption: kbKey ? { key: kbKey.key, keyId: kbKey.id } : null,
    keyRing,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    webReturnOrigin
  };
}

export const CLIENT_METADATA_PATH = '/oauth/clients/knowledgebase.json';
export const CALLBACK_PATH = '/api/connections/knowledgebase/callback';
/** Mobile completion target; `ASWebAuthenticationSession` intercepts the `overlord` scheme. */
export const MOBILE_RETURN_URL = 'overlord://connections/callback';
/** Web completion path on the web origin. */
export const WEB_RETURN_PATH = '/settings/connections';
