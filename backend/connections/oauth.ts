import { createHash, randomBytes } from 'node:crypto';

import { EgressError, egressFetch, type FetchLike } from './egress.ts';

/**
 * Knowledgebase OAuth client (Phase A, coo:1108.cag9): authorization code with
 * PKCE S256 and the RFC 8707 `resource` parameter, registered through a Client
 * ID Metadata Document. No device grant and no dynamic registration. Token
 * values never leave this module except inside a sealed envelope.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until the access token expires, when the server reports it. */
  expiresIn: number | null;
  refreshExpiresIn: number | null;
  scope: string | null;
}

export class OAuthError extends Error {
  constructor(
    /** `invalid_grant`: the grant is gone and the user must sign in again. */
    readonly code: 'invalid_grant' | 'unavailable' | 'misconfigured'
  ) {
    super(code);
  }
}

interface ServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
}

export const OAUTH_SCOPE = 'openid offline_access';
const METADATA_TTL_MS = 10 * 60 * 1000;
const METADATA_BYTES = 64 * 1024;
const TOKEN_BYTES = 64 * 1024;
const TIMEOUT_MS = 10_000;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

export class KnowledgebaseOAuth {
  private metadata: { value: ServerMetadata; at: number } | null = null;
  constructor(
    private readonly options: {
      mcpUrl: string;
      egressOrigins: readonly string[];
      clientId: string;
      redirectUri: string;
      fetch: FetchLike;
      now?: () => number;
    }
  ) {}

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async json(url: string, init: RequestInit = {}) {
    const response = await egressFetch(this.options.fetch, this.options.egressOrigins, url, init, {
      timeoutMs: TIMEOUT_MS,
      maxBytes: init.method === 'POST' ? TOKEN_BYTES : METADATA_BYTES
    });
    let body: Record<string, unknown> | null = null;
    if (!response.truncated) {
      try {
        const parsed: unknown = JSON.parse(response.text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          body = parsed as Record<string, unknown>;
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  /** RFC 9728 protected-resource metadata, then RFC 8414 authorization-server metadata. */
  async discover(): Promise<ServerMetadata> {
    if (this.metadata && this.now() - this.metadata.at < METADATA_TTL_MS)
      return this.metadata.value;
    try {
      const resource = new URL(this.options.mcpUrl);
      const prm = await this.json(
        `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname.replace(/\/+$/, '')}`
      );
      const servers = prm.body?.authorization_servers;
      if (
        prm.status !== 200 ||
        typeof prm.body?.resource !== 'string' ||
        !sameResource(prm.body.resource, this.options.mcpUrl) ||
        !Array.isArray(servers) ||
        typeof servers[0] !== 'string'
      )
        throw new OAuthError('misconfigured');
      const issuer = new URL(servers[0]);
      const as = await this.json(
        `${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/+$/, '')}`
      );
      const body = as.body;
      const methods = body?.code_challenge_methods_supported;
      if (
        as.status !== 200 ||
        !body ||
        typeof body.authorization_endpoint !== 'string' ||
        typeof body.token_endpoint !== 'string' ||
        !Array.isArray(methods) ||
        !methods.includes('S256')
      )
        throw new OAuthError('misconfigured');
      const value: ServerMetadata = {
        issuer: String(body.issuer ?? issuer.toString()),
        authorizationEndpoint: body.authorization_endpoint,
        tokenEndpoint: body.token_endpoint,
        revocationEndpoint:
          typeof body.revocation_endpoint === 'string' ? body.revocation_endpoint : null
      };
      // The browser opens the authorize endpoint; the backend calls the others. All must be approved.
      for (const endpoint of [
        value.authorizationEndpoint,
        value.tokenEndpoint,
        ...(value.revocationEndpoint ? [value.revocationEndpoint] : [])
      ]) {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' || !this.options.egressOrigins.includes(url.origin))
          throw new OAuthError('misconfigured');
      }
      this.metadata = { value, at: this.now() };
      return value;
    } catch (error) {
      if (error instanceof OAuthError) throw error;
      throw new OAuthError(error instanceof EgressError ? 'unavailable' : 'misconfigured');
    }
  }

  async authorizeUrl(state: string, challenge: string): Promise<string> {
    const { authorizationEndpoint } = await this.discover();
    const url = new URL(authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      scope: OAUTH_SCOPE,
      resource: this.options.mcpUrl,
      state
    }).toString();
    return url.toString();
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const { tokenEndpoint } = await this.discover();
    let response;
    try {
      response = await this.json(tokenEndpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json'
        },
        body: new URLSearchParams({
          ...params,
          client_id: this.options.clientId,
          resource: this.options.mcpUrl
        }).toString()
      });
    } catch {
      throw new OAuthError('unavailable');
    }
    const body = response.body;
    if (response.status === 200 && typeof body?.access_token === 'string') {
      const number = (value: unknown) =>
        typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
      return {
        accessToken: body.access_token,
        refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
        expiresIn: number(body.expires_in),
        refreshExpiresIn: number(body.refresh_token_expires_in),
        scope: typeof body.scope === 'string' ? body.scope : null
      };
    }
    // RFC 6749 §5.2: a rejected grant or client is permanent; anything else may be transient.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      ['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(String(body?.error))
    )
      throw new OAuthError('invalid_grant');
    throw new OAuthError('unavailable');
  }

  exchangeCode(code: string, verifier: string): Promise<TokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.options.redirectUri,
      code_verifier: verifier
    });
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Best-effort RFC 7009 revocation; never throws. */
  async revoke(token: string, hint: 'refresh_token' | 'access_token'): Promise<boolean> {
    try {
      const { revocationEndpoint } = await this.discover();
      if (!revocationEndpoint) return false;
      const response = await this.json(revocationEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token,
          token_type_hint: hint,
          client_id: this.options.clientId
        }).toString()
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
