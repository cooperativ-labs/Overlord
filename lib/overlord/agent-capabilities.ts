/**
 * Agent capability resolver — determines the prompt instruction mode
 * based on what durable configuration the agent has installed locally.
 *
 * This allows the prompt system to emit a slim prompt for agents with
 * the Overlord bundle installed, and a verbose fallback for everyone else.
 */

export type InstructionMode = 'bundle' | 'legacy';

export type AgentCapability = {
  agent: string;
  instructionMode: InstructionMode;
  /** Whether the agent has a durable permission hook installed */
  hasPermissionHook: boolean;
};

/**
 * Resolves the instruction mode for a given agent launch.
 *
 * @param agent - The agent type (claude, codex, cursor, gemini, opencode, pi)
 * @param bundleInstalled - Whether the Overlord local bundle is installed for this agent
 */
export function resolveAgentCapabilities(agent: string, bundleInstalled: boolean): AgentCapability {
  // Pi is intentionally legacy-only for the initial integration; a Pi extension
  // package can promote it to bundle mode in a follow-up change.
  const bundleSupported =
    agent === 'claude' || agent === 'codex' || agent === 'cursor' || agent === 'opencode';

  return {
    agent,
    instructionMode: bundleSupported && bundleInstalled ? 'bundle' : 'legacy',
    hasPermissionHook: agent === 'claude' && bundleInstalled
  };
}
