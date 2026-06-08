import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared agent-token (`oat_…`) generation and persistence.
 *
 * Both the Settings → Agents & MCP server action (`createUserAgentTokenAction`)
 * and the CLI-facing `POST /api/auth/agent-token` route create tokens through
 * these helpers so generation, hashing, validation, and the row shape stay
 * identical. Only the SHA-256 hash and a short prefix are stored; the full
 * token is returned exactly once to the caller.
 */

export const AGENT_TOKEN_PREFIX = 'oat_';
const MAX_LABEL_LENGTH = 80;

export type AgentTokenInfo = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Generate a fresh, unguessable `oat_…` agent token. */
export function generateAgentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return AGENT_TOKEN_PREFIX + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** Hash a token for storage. Never store the raw token. */
export async function hashAgentToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

/** Validate and normalize an agent-token label. Throws on invalid input. */
export function normalizeAgentTokenLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label is required');
  if (trimmed.length > MAX_LABEL_LENGTH) {
    throw new Error(`Label must be ${MAX_LABEL_LENGTH} characters or fewer`);
  }
  return trimmed;
}

/**
 * Create a labeled agent token for `userId` using the supplied Supabase client.
 *
 * The client must be authenticated as the owning user (cookie session or bearer
 * access token) so the `user_agent_tokens` RLS `WITH CHECK (user_id = auth.uid())`
 * policy is satisfied. Returns the full token once plus its metadata.
 */
export async function createAgentTokenForUser(
  supabase: SupabaseClient,
  userId: string,
  label: string
): Promise<{ token: string; info: AgentTokenInfo }> {
  const normalizedLabel = normalizeAgentTokenLabel(label);

  const token = generateAgentToken();
  const tokenHash = await hashAgentToken(token);
  const tokenPrefix = token.slice(0, 12);

  const { data, error } = await supabase
    .from('user_agent_tokens')
    .insert({
      user_id: userId,
      label: normalizedLabel,
      token_hash: tokenHash,
      token_prefix: tokenPrefix
    })
    .select('id, label, token_prefix, created_at, last_used_at')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to generate token');

  return {
    token,
    info: {
      id: data.id,
      label: data.label,
      tokenPrefix: data.token_prefix,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at
    }
  };
}
