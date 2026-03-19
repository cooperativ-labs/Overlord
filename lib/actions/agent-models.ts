'use server';

import {
  type AgentModel,
  applyAgentModelCatalog,
  readAgentModelCatalog
} from '@/lib/helpers/agent-model-catalog';
import { createClient } from '@/supabase/utils/server';

export type { AgentModel } from '@/lib/helpers/agent-model-catalog';

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

  const catalog = await readAgentModelCatalog();
  return applyAgentModelCatalog((data ?? []) as AgentModel[], catalog, agentType);
}
