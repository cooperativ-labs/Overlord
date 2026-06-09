'use server';

import {
  agentLaunchConfigSchema,
  type AgentLaunchConfigUpdate,
  mergeAgentLaunchConfig,
  parseTargetAgentConfigs,
  type TargetAgentConfigs
} from '@/lib/schemas/target-agent-config';
import { createClientForRequest } from '@/supabase/utils/server';

/**
 * Returns the per-target local agent launch config for every execution target
 * the current user can access, keyed by execution target id. RLS restricts the
 * rows to the signed-in user.
 */
export async function getExecutionTargetAgentConfigsAction(): Promise<
  Record<string, TargetAgentConfigs>
> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from('user_execution_targets')
    .select('execution_target_id, agent_configs')
    .eq('user_id', user.id);

  if (error) {
    console.error('getExecutionTargetAgentConfigsAction', error);
    return {};
  }

  const result: Record<string, TargetAgentConfigs> = {};
  for (const row of data ?? []) {
    result[row.execution_target_id] = parseTargetAgentConfigs(row.agent_configs);
  }
  return result;
}

/**
 * Upserts the launch config for a single agent on a single execution target,
 * preserving config for the other agents on that target. Returns the full,
 * updated per-agent config map for the target.
 */
export async function updateExecutionTargetAgentConfigAction(
  executionTargetId: string,
  agentType: string,
  config: AgentLaunchConfigUpdate
): Promise<TargetAgentConfigs> {
  const supabase = await createClientForRequest();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const trimmedAgent = agentType.trim();
  if (!trimmedAgent) throw new Error('Agent type is required.');

  const { data: existing, error: readError } = await supabase
    .from('user_execution_targets')
    .select('agent_configs')
    .eq('user_id', user.id)
    .eq('execution_target_id', executionTargetId)
    .maybeSingle();

  if (readError) throw readError;
  if (!existing) throw new Error('Execution target not found.');

  const configs = parseTargetAgentConfigs(existing.agent_configs);
  const current = configs[trimmedAgent] ?? agentLaunchConfigSchema.parse({});
  const merged = mergeAgentLaunchConfig(current, config);

  // Preserve an explicit empty config so clearing flags/pre-command on a target
  // remains a real override instead of falling back to the request-captured
  // global config during claim-time launch resolution.
  configs[trimmedAgent] = merged;

  const { error: updateError } = await supabase
    .from('user_execution_targets')
    .update({ agent_configs: configs })
    .eq('user_id', user.id)
    .eq('execution_target_id', executionTargetId);

  if (updateError) throw updateError;

  return configs;
}
