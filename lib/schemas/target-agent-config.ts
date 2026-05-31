import { z } from 'zod';

/**
 * Local launch configuration for a single agent on a single execution target.
 * Mirrors the launch-relevant subset of {@link agentConfigSchema}, but is stored
 * per execution target (in `user_execution_targets.agent_flags`) rather than once
 * per user, because the flags/pre-command a user wants typically differ by target.
 */
export const agentLaunchConfigSchema = z.object({
  /** Extra CLI flags appended to the agent launch command on this target. */
  flags: z.array(z.string()).default([]),
  /** Tokens prepended before the agent binary on this target, e.g. "ollama". */
  preCommand: z.string().optional()
});

export type AgentLaunchConfig = z.infer<typeof agentLaunchConfigSchema>;

/** Partial update; `preCommand: null` clears a stored pre-command (survives server-action JSON). */
export type AgentLaunchConfigUpdate = Omit<Partial<AgentLaunchConfig>, 'preCommand'> & {
  preCommand?: string | null;
};

/**
 * Map of agent type -> launch config for one execution target. Stored as the
 * `agent_flags` jsonb column on `user_execution_targets`.
 */
export const targetAgentConfigsSchema = z.record(z.string(), agentLaunchConfigSchema).default({});

export type TargetAgentConfigs = z.infer<typeof targetAgentConfigsSchema>;

/**
 * Safely coerce an arbitrary JSON value (from the DB) into a TargetAgentConfigs,
 * dropping anything that doesn't match the expected shape. Never throws.
 */
export function parseTargetAgentConfigs(raw: unknown): TargetAgentConfigs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: TargetAgentConfigs = {};
  for (const [agentType, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = agentLaunchConfigSchema.safeParse(value);
    if (parsed.success) {
      result[agentType] = parsed.data;
    }
  }
  return result;
}

/**
 * Normalize a single agent's launch config: trim flags, drop blanks/dupes, and
 * drop an empty pre-command. Returns the cleaned config.
 */
export function normalizeAgentLaunchConfig(config: AgentLaunchConfig): AgentLaunchConfig {
  const flags = Array.from(
    new Set(
      config.flags.map(flag => flag.trim().replace(/[\r\n]+/g, ' ')).filter(flag => flag.length > 0)
    )
  );
  const preCommand = config.preCommand?.trim();
  return preCommand ? { flags, preCommand } : { flags };
}

/**
 * Merge a stored config with a partial update. Uses `preCommand: null` (or blank
 * string) to clear; omitted `preCommand` leaves the existing value unchanged.
 * Server actions strip `undefined`, so callers must send `null` to clear.
 */
export function mergeAgentLaunchConfig(
  current: AgentLaunchConfig,
  update: AgentLaunchConfigUpdate
): AgentLaunchConfig {
  const merged: AgentLaunchConfig = {
    flags: update.flags ?? current.flags,
    ...(current.preCommand !== undefined ? { preCommand: current.preCommand } : {})
  };

  if ('preCommand' in update) {
    const next = update.preCommand;
    if (next === null || next === undefined || (typeof next === 'string' && next.trim() === '')) {
      delete merged.preCommand;
    } else {
      merged.preCommand = next;
    }
  }

  return normalizeAgentLaunchConfig(agentLaunchConfigSchema.parse(merged));
}
