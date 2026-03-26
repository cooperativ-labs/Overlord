'use server';

import { revalidatePath } from 'next/cache';

import { createClient } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

export type AgentTokenListItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
};

async function ensureAgentTokenRecord(preferredOrganizationId?: number): Promise<{
  token: string;
  created: boolean;
}> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const now = Date.now();
  const tokenQuery = supabase
    .from('agent_tokens')
    .select('token, expires_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: tokenRow, error: tokenError } = preferredOrganizationId
    ? await tokenQuery.eq('organization_id', preferredOrganizationId).maybeSingle()
    : await tokenQuery.maybeSingle();

  if (tokenError && !tokenRow) {
    throw new Error(tokenError.message ?? 'Failed to load agent token.');
  }

  if (tokenRow && (!tokenRow.expires_at || new Date(tokenRow.expires_at).getTime() > now)) {
    return { token: tokenRow.token, created: false };
  }

  const serviceSupabase = createServiceRoleClient();
  let organizationId = preferredOrganizationId;

  if (!organizationId) {
    const { data: orgRow, error: orgError } = await serviceSupabase
      .from('members')
      .select('organization_id')
      .eq('user_id', user.id)
      .order('organization_id', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (orgError || !orgRow) {
      throw new Error(orgError?.message ?? 'No organization found for this user.');
    }

    organizationId = orgRow.organization_id;
  }

  const { data: createdToken, error: createError } = await serviceSupabase
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: organizationId,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (createError || !createdToken) {
    throw new Error(createError?.message ?? 'Failed to create new agent token.');
  }

  return { token: createdToken.token, created: true };
}

export async function getAgentTokenAction(
  preferredOrganizationId?: number
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const query = supabase
    .from('agent_tokens')
    .select('token, created_at, revoked_at, expires_at')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  const { data, error } = preferredOrganizationId
    ? await query.eq('organization_id', preferredOrganizationId).maybeSingle()
    : await query.maybeSingle();

  if (error && !data) {
    throw new Error(error.message ?? 'Failed to load agent token.');
  }

  if (data?.expires_at && new Date(data.expires_at) <= new Date()) {
    return null;
  }

  return data?.token ?? null;
}

export async function ensureAgentTokenAction(preferredOrganizationId?: number): Promise<string> {
  const { token, created } = await ensureAgentTokenRecord(preferredOrganizationId);

  if (created) {
    revalidatePath('/u');
  }

  return token;
}

export async function ensureAgentTokenForLaunchAction(
  preferredOrganizationId?: number
): Promise<string> {
  const { token } = await ensureAgentTokenRecord(preferredOrganizationId);
  return token;
}

export async function rotateAgentTokenAction(preferredOrganizationId?: number): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Unauthorized');
  }

  const { data: orgRow, error: orgError } = preferredOrganizationId
    ? await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('organization_id', preferredOrganizationId)
        .limit(1)
        .maybeSingle()
    : await supabase
        .from('members')
        .select('organization_id')
        .eq('user_id', user.id)
        .order('organization_id', { ascending: true })
        .limit(1)
        .single();

  if (orgError || !orgRow) {
    throw new Error(orgError?.message ?? 'No organization found for this user.');
  }

  const { error: revokeError } = await supabase
    .from('agent_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('organization_id', preferredOrganizationId ?? orgRow.organization_id)
    .is('revoked_at', null);

  if (revokeError) {
    throw new Error(revokeError.message ?? 'Failed to revoke existing agent tokens.');
  }

  const { data: tokenRow, error: tokenError } = await supabase
    .from('agent_tokens')
    .insert({
      user_id: user.id,
      organization_id: preferredOrganizationId ?? orgRow.organization_id,
      name: 'CLI Token'
    })
    .select('token')
    .single();

  if (tokenError || !tokenRow) {
    throw new Error(tokenError.message ?? 'Failed to create new agent token.');
  }

  revalidatePath('/u');

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

  revalidatePath('/u');
}
