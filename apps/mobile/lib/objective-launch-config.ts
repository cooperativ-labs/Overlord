import { normalizeAgentLaunchConfig } from '@/lib/execution-targets';
import type { AgentLaunchConfig } from '@/lib/types';

/**
 * Per-objective launch config override (pre-command + flags) stored on
 * `objectives.launch_config`. The mobile AgentLaunchFooter writes this so a
 * single objective can override a selected execution target's config without
 * mutating the shared target config.
 *
 * `null` means no overrides (inherit target configs). A present target+agent
 * value — even with empty flags / no pre-command — is active and means the user
 * explicitly wants none for that objective launch context.
 */

export type ObjectiveLaunchConfigMap = Record<string, Record<string, AgentLaunchConfig>>;

function parseAgentLaunchConfig(value: unknown): AgentLaunchConfig | null {
  if (typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const rawFlags = record.flags;
  const flags = Array.isArray(rawFlags)
    ? rawFlags.filter((flag): flag is string => typeof flag === 'string')
    : [];
  const rawPreCommand = record.preCommand;
  const preCommand = typeof rawPreCommand === 'string' ? rawPreCommand : null;

  return normalizeAgentLaunchConfig({ flags, preCommand });
}

/** Coerce a stored `objectives.launch_config` value into a nested override map. */
export function parseObjectiveLaunchConfig(value: unknown): ObjectiveLaunchConfigMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: ObjectiveLaunchConfigMap = {};
  for (const [targetId, targetValue] of Object.entries(value as Record<string, unknown>)) {
    if (
      !targetId ||
      !targetValue ||
      typeof targetValue !== 'object' ||
      Array.isArray(targetValue)
    ) {
      continue;
    }

    const targetOverrides: Record<string, AgentLaunchConfig> = {};
    for (const [agentKey, configValue] of Object.entries(targetValue as Record<string, unknown>)) {
      const config = parseAgentLaunchConfig(configValue);
      if (config) {
        targetOverrides[agentKey] = config;
      }
    }

    if (Object.keys(targetOverrides).length > 0) {
      result[targetId] = targetOverrides;
    }
  }

  return result;
}

export function getObjectiveLaunchConfigOverride({
  value,
  executionTargetId,
  agentKey
}: {
  value: unknown;
  executionTargetId: string | null | undefined;
  agentKey: string | null | undefined;
}): AgentLaunchConfig | null {
  const targetId = executionTargetId?.trim();
  const key = agentKey?.trim();
  if (!targetId || !key) return null;
  return parseObjectiveLaunchConfig(value)[targetId]?.[key] ?? null;
}

export function upsertObjectiveLaunchConfigOverride({
  value,
  executionTargetId,
  agentKey,
  config
}: {
  value: unknown;
  executionTargetId: string;
  agentKey: string;
  config: AgentLaunchConfig;
}): ObjectiveLaunchConfigMap {
  const current = parseObjectiveLaunchConfig(value);
  return {
    ...current,
    [executionTargetId]: {
      ...(current[executionTargetId] ?? {}),
      [agentKey]: normalizeAgentLaunchConfig(config)
    }
  };
}

/**
 * Serialize an override for storage, omitting `preCommand` when empty so the
 * shape matches what the runner reads (a missing pre-command, not an explicit
 * null) — mirroring how the per-target `agent_configs` is serialized.
 */
export function serializeObjectiveLaunchConfig(
  overrides: ObjectiveLaunchConfigMap
): Record<string, Record<string, { flags: string[]; preCommand?: string }>> {
  const serialized: Record<string, Record<string, { flags: string[]; preCommand?: string }>> = {};

  for (const [targetId, targetOverrides] of Object.entries(overrides)) {
    const agents: Record<string, { flags: string[]; preCommand?: string }> = {};
    for (const [agentKey, config] of Object.entries(targetOverrides)) {
      const normalized = normalizeAgentLaunchConfig(config);
      agents[agentKey] = normalized.preCommand
        ? { flags: normalized.flags, preCommand: normalized.preCommand }
        : { flags: normalized.flags };
    }
    if (Object.keys(agents).length > 0) {
      serialized[targetId] = agents;
    }
  }

  return serialized;
}
