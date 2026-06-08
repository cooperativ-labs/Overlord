'use server';

import { type AgentTokenInfo, createAgentTokenForUser } from '@/lib/overlord/agent-tokens';
import { createClientForRequest } from '@/supabase/utils/server';

export type UserAgentTokenInfo = AgentTokenInfo;

/** Create a new labeled AGENT_TOKEN for the current user. Returns the full token once. */
export async function createUserAgentTokenAction(
  label: string
): Promise<{ token: string; info: UserAgentTokenInfo }> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Not authenticated');

  return createAgentTokenForUser(supabase, user.id, label);
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
