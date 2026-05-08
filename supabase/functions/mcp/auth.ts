// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'npm:jose@6.1.0';

// ---------------------------------------------------------------------------
// Auth — Supabase OAuth JWTs + per-project AGENT_TOKEN
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_AUTH_ISSUER = `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWKS = createRemoteJWKSet(new URL(`${SUPABASE_AUTH_ISSUER}/.well-known/jwks.json`));

export type TokenContext = {
  userId: string;
  organizationId: number;
  /** Set when authenticated via a per-project AGENT_TOKEN. */
  projectId?: string | null;
  /** The raw bearer value. */
  tokenValue: string;
  /** Identifies how the caller authenticated. */
  authMethod: 'oauth_jwt' | 'agent_token';
  /** Streamable HTTP session id when provided by MCP clients. */
  mcpSessionId?: string | null;
};

/**
 * Resolve the bearer token from the request.
 *
 * Accepts two forms:
 *   1. OAuth JWT / opaque token — standard Supabase auth (existing path)
 *   2. Per-project AGENT_TOKEN (prefix "oat_") — looks up a hashed token row
 *      in project_agent_tokens and derives user + org from there.
 *
 * For OAuth JWT auth with multi-org users, the `x-organization-id` header
 * selects which organization to scope the request to.
 */
export async function resolveToken(
  req: Request,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  // Agent token path — prefix-routed so we never attempt JWT validation
  if (token.startsWith('oat_')) {
    return resolveAgentToken(token, supabase);
  }

  // Optional org hint for multi-org OAuth users
  const orgIdHint = req.headers.get('x-organization-id');
  const parsedOrgId = orgIdHint ? parseInt(orgIdHint, 10) : null;

  return resolveOAuthJwt(token, supabase, parsedOrgId);
}

// ---------------------------------------------------------------------------
// Per-project AGENT_TOKEN resolution
// ---------------------------------------------------------------------------

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function resolveAgentToken(
  token: string,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const tokenHash = await hashToken(token);

  const { data: row } = await supabase
    .from('project_agent_tokens')
    .select('user_id, project_id')
    .eq('token_hash', tokenHash)
    .single();

  if (!row) {
    console.warn('[mcp] agent token lookup failed — no matching token');
    return null;
  }

  // Resolve the user's organization via project membership
  const { data: project } = await supabase
    .from('projects')
    .select('organization_id')
    .eq('id', row.project_id)
    .single();

  if (!project) {
    console.warn('[mcp] agent token: project not found for token');
    return null;
  }

  // Fire-and-forget last_used_at update
  supabase
    .from('project_agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)
    .then(() => {});

  return {
    userId: row.user_id,
    organizationId: project.organization_id,
    projectId: row.project_id,
    tokenValue: token,
    authMethod: 'agent_token'
  };
}

// ---------------------------------------------------------------------------
// Supabase OAuth JWT resolution
// ---------------------------------------------------------------------------

async function resolveOAuthJwt(
  token: string,
  supabase: SupabaseClient,
  organizationIdHint: number | null = null
): Promise<TokenContext | null> {
  let payload: Record<string, unknown> | null = null;
  let lastVerifyError: unknown = null;

  // Path 1 — JWT: try JWKS verification with and without audience.
  // Supabase session tokens have aud='authenticated'; OAuth-issued JWTs use
  // aud=client_id or the resource URI per RFC 8707.
  try {
    const verified = await jwtVerify(token, SUPABASE_JWKS, {
      issuer: SUPABASE_AUTH_ISSUER,
      audience: 'authenticated'
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    try {
      const verified = await jwtVerify(token, SUPABASE_JWKS, {
        issuer: SUPABASE_AUTH_ISSUER
      });
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      lastVerifyError = error;
    }
  }

  // Path 2 — Opaque access token (Supabase OAuth 2.1 server issues these by
  // default to dynamically-registered MCP clients). Resolve via userinfo.
  if (!payload) {
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.warn(
        '[mcp] oauth token validation failed',
        summarizeJwtValidationFailure(token, lastVerifyError)
      );
      return null;
    }

    payload = { sub: user.id };
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : null;

  if (!userId) {
    console.warn('[mcp] oauth token missing sub claim');
    return null;
  }

  // If caller specified an organization, verify membership in that org
  if (organizationIdHint && !isNaN(organizationIdHint)) {
    const { data: targetMember } = await supabase
      .from('members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationIdHint)
      .single();

    if (targetMember) {
      return {
        userId,
        organizationId: targetMember.organization_id,
        tokenValue: token,
        authMethod: 'oauth_jwt'
      };
    }
    // If not a member of the requested org, fall through to default
  }

  // Default: pick the user's first organization (by ID ascending)
  const { data: member } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', userId)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (!member) return null;

  return {
    userId,
    organizationId: member.organization_id,
    tokenValue: token,
    authMethod: 'oauth_jwt'
  };
}

function summarizeJwtValidationFailure(token: string, error: unknown) {
  const decoded = safeDecodeJwt(token);

  return {
    reason: error instanceof Error ? error.message : String(error),
    iss: typeof decoded?.iss === 'string' ? decoded.iss : null,
    aud: decoded?.aud ?? null,
    hasClientId: typeof decoded?.client_id === 'string' && decoded.client_id.trim().length > 0
  };
}

function safeDecodeJwt(token: string): Record<string, unknown> | null {
  try {
    return decodeJwt(token) as Record<string, unknown>;
  } catch {
    return null;
  }
}
