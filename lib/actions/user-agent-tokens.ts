'use server';

import { createClientForRequest } from '@/supabase/utils/server';

function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return 'oat_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export type UserAgentTokenInfo = {
  id: string;
  label: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Create a new labeled AGENT_TOKEN for the current user. Returns the full token once. */
export async function createUserAgentTokenAction(
  label: string
): Promise<{ token: string; info: UserAgentTokenInfo }> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error('Label is required');
  if (trimmed.length > 80) throw new Error('Label must be 80 characters or fewer');

  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Not authenticated');

  const token = generateSecureToken();
  const tokenHash = await hashToken(token);
  const tokenPrefix = token.slice(0, 12);

  const { data, error } = await supabase
    .from('user_agent_tokens')
    .insert({
      user_id: user.id,
      label: trimmed,
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

/** Revoke a single AGENT_TOKEN owned by the current user. */
export async function revokeUserAgentTokenAction(tokenId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('user_agent_tokens')
    .delete()
    .eq('id', tokenId)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
}

/** List metadata for all of the current user's tokens (never returns the token itself). */
export async function listUserAgentTokensAction(): Promise<UserAgentTokenInfo[]> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) return [];

  const { data } = await supabase
    .from('user_agent_tokens')
    .select('id, label, token_prefix, created_at, last_used_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (!data) return [];

  return data.map(row => ({
    id: row.id,
    label: row.label,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }));
}
