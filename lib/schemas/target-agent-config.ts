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
