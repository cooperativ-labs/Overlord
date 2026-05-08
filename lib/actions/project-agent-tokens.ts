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

export type AgentTokenInfo = {
  id: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Generate (or rotate) the AGENT_TOKEN for a project. Returns the full token once. */
export async function generateProjectAgentTokenAction(
  projectId: string
): Promise<{ token: string; info: AgentTokenInfo }> {
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
    .from('project_agent_tokens')
    .upsert(
      {
        project_id: projectId,
        user_id: user.id,
        token_hash: tokenHash,
        token_prefix: tokenPrefix,
        created_at: new Date().toISOString(),
        last_used_at: null
      },
      { onConflict: 'project_id,user_id' }
    )
    .select('id, token_prefix, created_at, last_used_at')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to generate token');

  return {
    token,
    info: {
      id: data.id,
      tokenPrefix: data.token_prefix,
      createdAt: data.created_at,
      lastUsedAt: data.last_used_at
    }
  };
}

/** Revoke the current AGENT_TOKEN for a project. */
export async function revokeProjectAgentTokenAction(projectId: string): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('project_agent_tokens')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);
}

/** Get metadata about the current AGENT_TOKEN (never returns the token itself). */
export async function getProjectAgentTokenInfoAction(
  projectId: string
): Promise<AgentTokenInfo | null> {
  const supabase = await createClientForRequest();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data } = await supabase
    .from('project_agent_tokens')
    .select('id, token_prefix, created_at, last_used_at')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    tokenPrefix: data.token_prefix,
    createdAt: data.created_at,
    lastUsedAt: data.last_used_at
  };
}
