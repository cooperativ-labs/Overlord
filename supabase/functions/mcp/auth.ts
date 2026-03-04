// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Auth — supports both legacy agent_tokens and Supabase OAuth JWTs
// ---------------------------------------------------------------------------

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
 */
export async function resolveToken(
  req: Request,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  // --- Path 1: agent_token lookup ---
  const agentCtx = await resolveAgentToken(token, supabase);
  if (agentCtx) return agentCtx;

  // --- Path 2: Supabase OAuth JWT ---
  const oauthCtx = await resolveOAuthJwt(token, supabase);
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
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  // Validate the JWT via Supabase Auth — this checks signature, expiry, etc.
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser(token);

  if (userError || !user) return null;

  // Look up the user's organization via the members table
  const { data: member } = await supabase
    .from('members')
    .select('organization_id')
    .eq('user_id', user.id)
    .order('organization_id', { ascending: true })
    .limit(1)
    .single();

  if (!member) return null;

  return {
    userId: user.id,
    organizationId: member.organization_id,
    tokenId: null,
    tokenValue: token,
    authMethod: 'oauth_jwt'
  };
}
