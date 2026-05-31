import type { SupabaseClient } from '@supabase/supabase-js';

import { type AgentLaunchConfig, parseTargetAgentConfigs } from '@/lib/schemas/target-agent-config';
import type { Database } from '@/types/database.types';

/**
 * Result of resolving a per-target agent launch config.
 *
 * The three cases are intentionally distinct so the claim path can fail closed
 * on a genuine lookup error instead of silently falling back to the
 * request-captured flags (Phase 9 of the launch-pipeline remediation):
 * - `configured`: the target has a config for this agent — use it.
 * - `not_configured`: no row/agent config — callers may fall back to the
 *   request-captured global flags/pre-command.
 * - `error`: the lookup itself failed — callers must NOT fall back; treat it as
 *   a claim failure.
 */
export type ResolvedTargetAgentLaunch =
  | { kind: 'configured'; flags: string[]; preCommand: string | null }
  | { kind: 'not_configured' }
  | { kind: 'error'; error: string };

/**
 * Resolve the per-target local launch config for a given agent on a given
 * execution target.
 *
 * Uses whatever client is passed (service-role on the runner/claim path), so it
 * filters by `user_id` explicitly rather than relying on RLS.
 */
export async function resolveTargetAgentLaunch(
  supabase: SupabaseClient<Database>,
  userId: string,
  executionTargetId: string,
  agentIdentifier: string | null | undefined
): Promise<ResolvedTargetAgentLaunch> {
  const agentType = agentIdentifier?.trim();
  if (!agentType) return { kind: 'not_configured' };

  const { data, error } = await supabase
    .from('user_execution_targets')
    .select('agent_flags')
    .eq('user_id', userId)
    .eq('execution_target_id', executionTargetId)
    .maybeSingle();

  // A real lookup failure must not be confused with "no config": callers fall
  // back to request flags only for `not_configured`, never for `error`.
  if (error) return { kind: 'error', error: error.message };
  if (!data) return { kind: 'not_configured' };

  const configs = parseTargetAgentConfigs(data.agent_flags);
  const config: AgentLaunchConfig | undefined = configs[agentType];
  if (!config) return { kind: 'not_configured' };

  return {
    kind: 'configured',
    flags: config.flags,
    preCommand: config.preCommand?.trim() ? config.preCommand.trim() : null
  };
}
