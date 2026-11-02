/**
 * The "Manual" executor: a person, not an agent, does the objective.
 *
 * Every client stores it the same way as a real agent — as the objective's
 * `assigned_agent` — under the key the web selector has always written
 * (`MANUAL_AGENT_KEY` in AgentModelSelector.tsx) and the iOS app mirrors
 * (`LaunchAgentType.manual`). It is never in a workspace agent catalog and can
 * never be launched: there is no runner to hand the work to.
 */
export const MANUAL_AGENT_KEY = 'manual';

/**
 * Words callers reach for when they mean the Manual executor. MCP and CLI
 * callers are language models and people, and "human" is the natural word,
 * so it is accepted and stored as the canonical key.
 */
const MANUAL_AGENT_ALIASES = new Set([MANUAL_AGENT_KEY, 'human']);

/** True when `agent` names the Manual executor (canonical key or alias). */
export function isManualAgentKey(agent: string | null | undefined): boolean {
  return MANUAL_AGENT_ALIASES.has((agent ?? '').trim().toLowerCase());
}

/**
 * Trim an agent identifier and fold Manual aliases onto the canonical key.
 * Blank input stays blank (null); other identifiers pass through unchanged.
 */
export function normalizeAgentKey(agent: string | null | undefined): string | null {
  const trimmed = agent?.trim();
  if (!trimmed) return null;
  return isManualAgentKey(trimmed) ? MANUAL_AGENT_KEY : trimmed;
}
