'use server';

import { createClient } from '@/supabase/utils/server';

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
    .select('token, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && !data) {
    throw new Error(error.message ?? 'Failed to load agent token.');
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

  const { error: deleteError } = await supabase
    .from('agent_tokens')
    .delete()
    .eq('user_id', user.id);

  if (deleteError) {
    throw new Error(deleteError.message ?? 'Failed to revoke existing agent tokens.');
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

  return tokenRow.token;
}
