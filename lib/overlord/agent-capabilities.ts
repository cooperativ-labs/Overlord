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
 * @param agent - The agent type (claude, codex, cursor, gemini)
 * @param bundleInstalled - Whether the Overlord local bundle is installed for this agent
 */
export function resolveAgentCapabilities(agent: string, bundleInstalled: boolean): AgentCapability {
  // Only Claude and Codex support the bundle today
  const bundleSupported = agent === 'claude' || agent === 'codex';

  return {
    agent,
    instructionMode: bundleSupported && bundleInstalled ? 'bundle' : 'legacy',
    hasPermissionHook: agent === 'claude' && bundleInstalled
  };
}
