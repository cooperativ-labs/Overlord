'use server';

import { type AgentConfig, agentConfigSchema } from '@/lib/schemas/agent-config';
import { createClientForRequest } from '@/supabase/utils/server';

export async function getAgentConfigAction(agentType: string): Promise<AgentConfig | null> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('user_agent_configs')
    .select('config')
    .eq('user_id', user.id)
    .eq('agent_type', agentType)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows found, return null
      return null;
    }
    throw error;
  }

  return agentConfigSchema.parse(data.config);
}

export async function getAllAgentConfigsAction(): Promise<Record<string, AgentConfig>> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  return getAllAgentConfigsByUserIdAction(user.id, supabase);
}

type SupabaseClient = Awaited<ReturnType<typeof createClientForRequest>>;

export async function getAllAgentConfigsByUserIdAction(
  userId: string,
  supabase?: SupabaseClient
): Promise<Record<string, AgentConfig>> {
  if (!supabase) {
    // When no trusted server-side client is supplied, this is callable as a
    // server action from the browser. Require the requested userId to match
    // the authenticated user so a caller can't read someone else's configs
    // if RLS ever regresses.
    supabase = await createClientForRequest();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      throw new Error('User not authenticated');
    }
    if (user.id !== userId) {
      throw new Error('Not authorized to read configs for another user');
    }
  }

  const { data, error } = await supabase
    .from('user_agent_configs')
    .select('agent_type, config')
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  const configs: Record<string, AgentConfig> = {};
  data.forEach((row: { agent_type: string; config: unknown }) => {
    configs[row.agent_type] = agentConfigSchema.parse(row.config);
  });

  return configs;
}

export async function upsertAgentConfigAction(
  agentType: string,
  config: Partial<AgentConfig>
): Promise<AgentConfig> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  // Get existing config if it exists
  let existingConfig: AgentConfig = {
    flags: []
  };

  const { data: existing } = await supabase
    .from('user_agent_configs')
    .select('config')
    .eq('user_id', user.id)
    .eq('agent_type', agentType)
    .single();

  if (existing) {
    existingConfig = agentConfigSchema.parse(existing.config);
  }

  // Merge with new config
  const mergedConfig = {
    ...existingConfig,
    ...config
  };

  const validated = agentConfigSchema.parse(mergedConfig);

  const { data, error } = await supabase
    .from('user_agent_configs')
    .upsert(
      {
        user_id: user.id,
        agent_type: agentType,
        config: validated,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id,agent_type' }
    )
    .select('config')
    .single();

  if (error) {
    throw error;
  }

  return agentConfigSchema.parse(data.config);
}

export async function updateAgentFlagsAction(
  agentType: string,
  flags: string[]
): Promise<AgentConfig> {
  return upsertAgentConfigAction(agentType, { flags });
}

export async function updateAgentModelPreferenceAction(
  agentType: string,
  model: string | null,
  thinking: string | null
): Promise<AgentConfig> {
  return upsertAgentConfigAction(agentType, {
    defaultModel: model ?? undefined,
    defaultThinking: thinking ?? undefined
  });
}

export async function deleteAgentConfigAction(agentType: string): Promise<void> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const { error } = await supabase
    .from('user_agent_configs')
    .delete()
    .eq('user_id', user.id)
    .eq('agent_type', agentType);

  if (error) {
    throw error;
  }
}
