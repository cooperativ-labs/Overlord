import { getSupabase } from '@/lib/supabase';
import type { AgentLaunchConfig, AgentLaunchConfigUpdate, ExecutionTarget } from '@/lib/types';

type ExecutionTargetRow = {
  id: string;
  host: string | null;
  port: number | null;
  transport: string | null;
  platform: string | null;
  name: string | null;
  is_placeholder: boolean | null;
  last_seen_at: string | null;
};

type OrgTargetRow = {
  execution_target_id: string;
  label: string;
  organization_id: number;
  execution_targets: ExecutionTargetRow | ExecutionTargetRow[] | null;
};

type UserTargetRow = {
  execution_target_id: string;
  agent_flags: unknown;
  access_status: string | null;
  default_username: string | null;
};

function firstRow(
  value: ExecutionTargetRow | ExecutionTargetRow[] | null
): ExecutionTargetRow | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Parse the `user_execution_targets.agent_flags` jsonb into a typed map. */
export function parseAgentFlags(value: unknown): Record<string, AgentLaunchConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, AgentLaunchConfig> = {};
  for (const [agentType, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry = raw as { flags?: unknown; preCommand?: unknown };
    const flags = Array.isArray(entry.flags)
      ? entry.flags.filter((flag): flag is string => typeof flag === 'string')
      : [];
    const preCommand =
      typeof entry.preCommand === 'string' && entry.preCommand.trim().length > 0
        ? entry.preCommand
        : null;
    result[agentType] = { flags, preCommand };
  }
  return result;
}

/**
 * Load every execution target the signed-in user can see, merging the
 * organization label, the canonical target identity, and the user's per-target
 * agent launch config (pre-commands + flags).
 */
export async function loadExecutionTargets(userId: string): Promise<ExecutionTarget[]> {
  const supabase = getSupabase();

  const [orgRes, userRes] = await Promise.all([
    supabase
      .from('organization_execution_targets')
      .select(
        'execution_target_id, label, organization_id, execution_targets(id, host, port, transport, platform, name, is_placeholder, last_seen_at)'
      )
      .order('label', { ascending: true }),
    supabase
      .from('user_execution_targets')
      .select('execution_target_id, agent_flags, access_status, default_username')
      .eq('user_id', userId)
  ]);

  if (orgRes.error) {
    throw new Error(orgRes.error.message);
  }

  const userById = new Map<string, UserTargetRow>();
  for (const row of (userRes.data ?? []) as UserTargetRow[]) {
    userById.set(row.execution_target_id, row);
  }

  const targets: ExecutionTarget[] = [];
  // A single execution target can be shared across multiple organizations, so
  // `organization_execution_targets` returns one row per (org, target). Dedupe
  // by the underlying execution_target_id so each machine appears once.
  const seenTargetIds = new Set<string>();
  for (const row of (orgRes.data ?? []) as OrgTargetRow[]) {
    const target = firstRow(row.execution_targets);
    if (!target) continue;
    if (seenTargetIds.has(row.execution_target_id)) continue;
    seenTargetIds.add(row.execution_target_id);
    const userRow = userById.get(row.execution_target_id) ?? null;

    targets.push({
      id: row.execution_target_id,
      label: row.label,
      organizationId: row.organization_id,
      host: target.host ?? '',
      port: target.port ?? 22,
      transport: target.transport ?? 'local',
      platform: target.platform,
      name: target.name,
      isPlaceholder: Boolean(target.is_placeholder),
      lastSeenAt: target.last_seen_at,
      accessStatus: userRow?.access_status ?? null,
      defaultUsername: userRow?.default_username ?? null,
      agentFlags: parseAgentFlags(userRow?.agent_flags)
    });
  }

  return targets;
}

/** Trim flags, drop blanks/dupes, and normalize an empty pre-command to null. */
export function normalizeAgentLaunchConfig(config: AgentLaunchConfig): AgentLaunchConfig {
  const flags = Array.from(
    new Set(
      config.flags.map(flag => flag.trim().replace(/[\r\n]+/g, ' ')).filter(flag => flag.length > 0)
    )
  );
  const preCommand = config.preCommand?.trim();
  return { flags, preCommand: preCommand && preCommand.length > 0 ? preCommand : null };
}

/**
 * Merge a stored per-agent config with a partial update. An omitted field is
 * left unchanged; `preCommand: null`/blank clears the stored pre-command.
 */
export function mergeAgentLaunchConfig(
  current: AgentLaunchConfig,
  update: AgentLaunchConfigUpdate
): AgentLaunchConfig {
  const merged: AgentLaunchConfig = {
    flags: update.flags ?? current.flags,
    preCommand: 'preCommand' in update ? (update.preCommand ?? null) : current.preCommand
  };
  return normalizeAgentLaunchConfig(merged);
}

/**
 * Serialize a per-target agent config map back into the `agent_flags` jsonb
 * shape, omitting `preCommand` when empty so it matches what the web writes and
 * the runner reads (a missing pre-command, not an explicit null).
 */
function serializeAgentFlags(
  configs: Record<string, AgentLaunchConfig>
): Record<string, { flags: string[]; preCommand?: string }> {
  const out: Record<string, { flags: string[]; preCommand?: string }> = {};
  for (const [agentType, config] of Object.entries(configs)) {
    out[agentType] = config.preCommand
      ? { flags: config.flags, preCommand: config.preCommand }
      : { flags: config.flags };
  }
  return out;
}

/**
 * Upsert the launch config for a single agent on a single execution target,
 * preserving the other agents' configs. Reads the latest stored row, merges, and
 * writes it back to `user_execution_targets.agent_flags`. Returns the full,
 * updated per-agent config map for the target.
 */
export async function persistTargetAgentConfig(
  userId: string,
  executionTargetId: string,
  agentType: string,
  update: AgentLaunchConfigUpdate
): Promise<Record<string, AgentLaunchConfig>> {
  const supabase = getSupabase();
  const trimmedAgent = agentType.trim();
  if (!trimmedAgent) throw new Error('Agent type is required.');

  const { data: existing, error: readError } = await supabase
    .from('user_execution_targets')
    .select('agent_flags')
    .eq('user_id', userId)
    .eq('execution_target_id', executionTargetId)
    .maybeSingle();

  if (readError) throw new Error(readError.message);
  if (!existing) throw new Error('Execution target not found for this user.');

  const configs = parseAgentFlags(existing.agent_flags);
  const current = configs[trimmedAgent] ?? { flags: [], preCommand: null };
  configs[trimmedAgent] = mergeAgentLaunchConfig(current, update);

  const { error: updateError } = await supabase
    .from('user_execution_targets')
    .update({ agent_flags: serializeAgentFlags(configs) })
    .eq('user_id', userId)
    .eq('execution_target_id', executionTargetId);

  if (updateError) throw new Error(updateError.message);

  return configs;
}
