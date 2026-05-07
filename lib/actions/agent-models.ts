'use server';

import * as Sentry from '@sentry/nextjs';
import { unstable_cache } from 'next/cache';

import { type AgentModel, filterOfferedAgentModels } from '@/lib/helpers/agent-model-catalog';
import { createClientForRequest } from '@/supabase/utils/server';

export type { AgentModel } from '@/lib/helpers/agent-model-catalog';

// agent_models is global configuration data — cache for 1 hour across all requests
const fetchAllAgentModels = unstable_cache(
  async (): Promise<AgentModel[]> => {
    const supabase = await createClientForRequest();

    const { data, error } = await supabase
      .from('agent_models')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('is_recommended', { ascending: false });

    if (error) {
      console.error('Failed to fetch agent models:', error);
      Sentry.captureException(error);
      return [];
    }

    return (data ?? []) as AgentModel[];
  },
  ['agent-models'],
  { revalidate: 3600 }
);

export async function getAgentModelsAction(agentType?: string): Promise<AgentModel[]> {
  const all = await fetchAllAgentModels();
  return filterOfferedAgentModels(all, agentType);
}
