// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'npm:jose@6.1.0';

// ---------------------------------------------------------------------------
// Auth — Supabase OAuth JWTs only
// ---------------------------------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_AUTH_ISSUER = `${SUPABASE_URL}/auth/v1`;
const SUPABASE_JWKS = createRemoteJWKSet(new URL(`${SUPABASE_AUTH_ISSUER}/.well-known/jwks.json`));

export type TokenContext = {
  userId: string;
  organizationId: number;
  /** The raw bearer value. */
  tokenValue: string;
  /** Identifies how the caller authenticated. */
  authMethod: 'oauth_jwt';
  /** Streamable HTTP session id when provided by MCP clients. */
  mcpSessionId?: string | null;
};

/**
 * Resolve the bearer token from the request.
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

  return resolveOAuthJwt(token, supabase, parsedOrgId);
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
    // First try with audience: 'authenticated' (standard Supabase tokens)
    const verified = await jwtVerify(token, SUPABASE_JWKS, {
      issuer: SUPABASE_AUTH_ISSUER,
      audience: 'authenticated'
    });
    payload = verified.payload as Record<string, unknown>;
  } catch {
    // OAuth provider tokens have aud = client_id (not 'authenticated').
    // Retry JWKS verification without an audience constraint.
    try {
      const verified = await jwtVerify(token, SUPABASE_JWKS, {
        issuer: SUPABASE_AUTH_ISSUER
      });
      payload = verified.payload as Record<string, unknown>;
    } catch (error) {
      // Final fallback for HS256 or non-JWKS-compatible tokens.
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser(token);

      if (userError || !user) {
        console.warn(
          '[mcp] oauth token validation failed',
          summarizeJwtValidationFailure(token, error)
        );
        return null;
      }

      payload = decodeJwt(token) as Record<string, unknown>;
    }
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
