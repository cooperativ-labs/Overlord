'use server';

import {
  type AgentModelSelection,
  type UserLaunchPreference
} from '@/lib/helpers/agent-model-preference';
import { createClient } from '@/supabase/utils/server';

type LaunchPreferenceRow = {
  agent_type: string;
  model_id: string | null;
  thinking: string | null;
};

export async function getUserLaunchPreferenceAction(): Promise<UserLaunchPreference | null> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('user_launch_preferences')
    .select('agent_type,model_id,thinking')
    .eq('user_id', user.id)
    .single();

  if (error || !data) {
    return null;
  }

  const row = data as LaunchPreferenceRow;
  return {
    agent: row.agent_type as AgentModelSelection['agent'],
    model: row.model_id,
    thinking: row.thinking
  };
}

export async function upsertUserLaunchPreferenceAction(
  selection: AgentModelSelection
): Promise<UserLaunchPreference> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('User not authenticated');
  }

  const { data, error } = await supabase
    .from('user_launch_preferences')
    .upsert(
      {
        user_id: user.id,
        agent_type: selection.agent,
        model_id: selection.model,
        thinking: selection.thinking,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    .select('agent_type,model_id,thinking')
    .single();

  if (error || !data) {
    throw error ?? new Error('Failed to save launch preference.');
  }

  const row = data as LaunchPreferenceRow;
  return {
    agent: row.agent_type as AgentModelSelection['agent'],
    model: row.model_id,
    thinking: row.thinking
  };
}

export async function updateUserLaunchAgentPreferenceAction(
  agent: AgentModelSelection['agent']
): Promise<UserLaunchPreference> {
  return upsertUserLaunchPreferenceAction({
    agent,
    model: null,
    thinking: null
  });
}
