import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type AgentLaunchConfig,
  parseObjectiveLaunchConfig,
  parseTargetAgentConfigs
} from '@/lib/schemas/target-agent-config';
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

/**
 * Resolve an objective's per-objective launch config override. The mobile
 * AgentLaunchFooter writes this so a single objective can override the execution
 * target's CliPage config. When present (even with empty values) it is the
 * source of truth and the target config must NOT be consulted; `null` means no
 * override and the caller should fall back to the target config.
 *
 * A lookup failure returns `null` rather than throwing: the override is optional
 * and degrading to the target config is preferable to failing the launch.
 */
export async function resolveObjectiveLaunchOverride(
  supabase: SupabaseClient<Database>,
  objectiveId: string | null | undefined
): Promise<{ flags: string[]; preCommand: string | null } | null> {
  if (!objectiveId) return null;

  const { data, error } = await supabase
    .from('objectives')
    .select('launch_config')
    .eq('id', objectiveId)
    .maybeSingle();

  if (error || !data) return null;

  const config = parseObjectiveLaunchConfig(data.launch_config);
  if (!config) return null;

  return {
    flags: config.flags,
    preCommand: config.preCommand?.trim() ? config.preCommand.trim() : null
  };
}
