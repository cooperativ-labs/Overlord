'use server';

import { revalidatePath } from 'next/cache';

import { isAdminEmail } from '@/lib/auth/admin';
import type { AgentModel } from '@/lib/helpers/agent-model-catalog';
import { createClientForRequest } from '@/supabase/utils/server';
import { createServiceRoleClient } from '@/supabase/utils/service-role';

async function requireAdminUser(): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    throw new Error('Unauthorized');
  }
}

export async function getAdminAgentModelsAction(): Promise<AgentModel[]> {
  await requireAdminUser();

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('agent_models')
    .select('*')
    .order('agent_type', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('display_name', { ascending: true });

  if (error) {
    throw new Error(error.message ?? 'Failed to load agent models.');
  }

  return (data ?? []) as AgentModel[];
}

export async function updateAgentModelOfferingAction(
  modelId: string,
  isOffered: boolean
): Promise<AgentModel> {
  await requireAdminUser();

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from('agent_models')
    .update({
      is_offered: isOffered,
      updated_at: new Date().toISOString()
    })
    .eq('id', modelId)
    .select('*')
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to update model offering.');
  }

  revalidatePath('/admin');

  return data as AgentModel;
}
