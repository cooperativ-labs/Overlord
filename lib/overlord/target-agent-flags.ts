import type { SupabaseClient } from '@supabase/supabase-js';

import { type AgentLaunchConfig, parseTargetAgentConfigs } from '@/lib/schemas/target-agent-config';
import type { Database } from '@/types/database.types';

export type ResolvedTargetAgentLaunch = {
  flags: string[];
  preCommand: string | null;
};

/**
 * Resolve the per-target local launch config for a given agent on a given
 * execution target. Returns `null` when the target has no configuration for the
 * agent, so callers can fall back to globally-configured flags/pre-command.
 *
 * Uses whatever client is passed (service-role on the runner/claim path), so it
 * filters by `user_id` explicitly rather than relying on RLS.
 */
export async function resolveTargetAgentLaunch(
  supabase: SupabaseClient<Database>,
  userId: string,
  executionTargetId: string,
  agentIdentifier: string | null | undefined
): Promise<ResolvedTargetAgentLaunch | null> {
  const agentType = agentIdentifier?.trim();
  if (!agentType) return null;

  const { data, error } = await supabase
    .from('user_execution_targets')
    .select('agent_flags')
    .eq('user_id', userId)
    .eq('execution_target_id', executionTargetId)
    .maybeSingle();

  if (error || !data) return null;

  const configs = parseTargetAgentConfigs(data.agent_flags);
  const config: AgentLaunchConfig | undefined = configs[agentType];
  if (!config) return null;

  return {
    flags: config.flags,
    preCommand: config.preCommand?.trim() ? config.preCommand.trim() : null
  };
}
