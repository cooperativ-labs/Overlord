import { normalizeAgentLaunchConfig } from '@/lib/execution-targets';
import type { AgentLaunchConfig } from '@/lib/types';

/**
 * Per-objective launch config override (pre-command + flags) stored on
 * `objectives.launch_config`. The mobile AgentLaunchFooter writes this so a
 * single objective can override the execution target's CliPage config without
 * mutating the shared target config.
 *
 * `null` means no override (inherit the target config). A present value — even
 * with empty flags / no pre-command — is an active override and means the user
 * explicitly wants none for this objective.
 */

/** Coerce a stored `objectives.launch_config` value into a config, or null. */
export function parseObjectiveLaunchConfig(value: unknown): AgentLaunchConfig | null {
  if (value === null || value === undefined) return null;
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

/**
 * Serialize an override for storage, omitting `preCommand` when empty so the
 * shape matches what the runner reads (a missing pre-command, not an explicit
 * null) — mirroring how the per-target `agent_flags` is serialized.
 */
export function serializeObjectiveLaunchConfig(config: AgentLaunchConfig): {
  flags: string[];
  preCommand?: string;
} {
  const normalized = normalizeAgentLaunchConfig(config);
  return normalized.preCommand
    ? { flags: normalized.flags, preCommand: normalized.preCommand }
    : { flags: normalized.flags };
}
