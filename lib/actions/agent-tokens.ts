'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';

export type AgentTokenListItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

export async function getAgentTokenAction(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('agent_tokens')
    .select('token, created_at, revoked_at, expires_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && !data) {
    throw new Error(error.message ?? 'Failed to load agent token.');
  }

  if (data?.expires_at && new Date(data.expires_at) <= new Date()) {
    return null;
  }

  return data?.token ?? null;
}

export async function rotateAgentTokenAction(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data: orgRow, error: orgError } = await supabase
    .from('organizations')
    .select('id')
    .order('id', { ascending: true })
    .limit(1)
    .single();

  if (orgError || !orgRow) {
    throw new Error(orgError?.message ?? 'No organization found for this user.');
  }

  const { error: revokeError } = await supabase
    .from('agent_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('revoked_at', null);

  if (revokeError) {
    throw new Error(revokeError.message ?? 'Failed to revoke existing agent tokens.');
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: orgRow.id,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (tokenError || !tokenRow) {
    throw new Error(tokenError.message ?? 'Failed to create new agent token.');
  }

  revalidatePath('/account/tokens');

  return tokenRow.token;
}

export async function getActiveAgentTokensAction(): Promise<AgentTokenListItem[]> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('agent_tokens')
    .select('id, name, created_at, last_used_at, expires_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message ?? 'Failed to load active agent tokens.');
  }

  const now = Date.now();

  return (data ?? [])
    .filter(token => !token.expires_at || new Date(token.expires_at).getTime() > now)
    .map(token => ({
      id: token.id,
      name: token.name,
      createdAt: token.created_at,
      lastUsedAt: token.last_used_at,
      expiresAt: token.expires_at
    }));
}

export async function revokeAgentTokenAction(tokenId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data, error } = await supabase
    .from('agent_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message ?? 'Failed to revoke token.');
  }

  if (!data) {
    throw new Error('Token not found or already revoked.');
  }

  revalidatePath('/account/tokens');
}
