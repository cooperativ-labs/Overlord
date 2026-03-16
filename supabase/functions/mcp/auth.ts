// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'npm:jose@6.1.0';

// ---------------------------------------------------------------------------
// Auth — supports both legacy agent_tokens and Supabase OAuth JWTs
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_AUTH_ISSUER = `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_AUTH_ISSUER}/.well-known/jwks.json`)
);

export type TokenContext = {
  userId: string;
  organizationId: number;
  /** Populated for agent_token auth; null for OAuth JWT auth. */
  tokenId: string | null;
  /** The raw bearer value. */
  tokenValue: string;
  /** 'agent_token' or 'oauth_jwt' — identifies how the caller authenticated. */
  authMethod: 'agent_token' | 'oauth_jwt';
};

/**
 * Resolve the bearer token from the request.
 *
 * 1. Try matching against `agent_tokens` (legacy flow).
 * 2. If that fails, validate as a Supabase OAuth JWT (new flow for MCP OAuth clients).
 *
 * For OAuth JWT auth with multi-org users, the `x-organization-id` header
 * selects which organization to scope the request to. Without it, the first
 * membership (by org ID ascending) is used.
 */
export async function resolveToken(
  req: Request,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  // Optional org hint for multi-org OAuth users
  const orgIdHint = req.headers.get('x-organization-id');
  const parsedOrgId = orgIdHint ? parseInt(orgIdHint, 10) : null;

  // --- Path 1: agent_token lookup ---
  const agentCtx = await resolveAgentToken(token, supabase);
  if (agentCtx) return agentCtx;

  // --- Path 2: Supabase OAuth JWT ---
  const oauthCtx = await resolveOAuthJwt(token, supabase, parsedOrgId);
  if (oauthCtx) return oauthCtx;

  return null;
}

// ---------------------------------------------------------------------------
// Agent token resolution (legacy)
// ---------------------------------------------------------------------------

async function resolveAgentToken(
  token: string,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token, revoked_at, expires_at')
    .eq('token', token)
    .single();

  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Fire-and-forget last_used_at
  supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    userId: data.user_id,
    organizationId: data.organization_id,
    tokenId: data.id,
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
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, SUPABASE_JWKS, {
      issuer: SUPABASE_AUTH_ISSUER,
      audience: 'authenticated'
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (error) {
    // Fallback for projects still using HS256 or non-JWKS-compatible tokens.
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      console.warn('[mcp] oauth token validation failed', summarizeJwtValidationFailure(token, error));
      return null;
    }

    payload = decodeJwt(token) as Record<string, unknown>;
  }

  const userId = typeof payload.sub === 'string' ? payload.sub : null;
  const clientId = typeof payload.client_id === 'string' ? payload.client_id.trim() : '';

  if (!userId || !clientId) {
    console.warn('[mcp] oauth token missing required claims', {
      hasSub: Boolean(userId),
      hasClientId: clientId.length > 0
    });
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
        tokenId: null,
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
    tokenId: null,
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
