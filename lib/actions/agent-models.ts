'use server';

import { createClient } from '@/supabase/utils/server';

export type AgentModel = {
  id: string;
  agent_type: string;
  model_id: string;
  display_name: string;
  thinking_options: string[];
  capabilities: Record<string, unknown>;
  is_recommended: boolean;
  sort_order: number;
  updated_at: string;
};

export async function getAgentModelsAction(agentType?: string): Promise<AgentModel[]> {
  const supabase = await createClient();

  let query = supabase
    .from('agent_models')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('is_recommended', { ascending: false });

  if (agentType) {
    query = query.eq('agent_type', agentType);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch agent models:', error);
    return [];
  }

  return (data ?? []) as AgentModel[];
}
