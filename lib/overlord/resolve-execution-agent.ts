import {
  getAgentTypeByIdentifier,
  isLaunchAgentTypeValue,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import type { Json } from '@/types/database.types';

export const NO_ASSIGNED_AGENT_ERROR =
  'No agent was assigned to this objective. Select an agent before running.';

export type ResolvedExecutionAgent = {
  agentIdentifier: string;
  launchAgent: LaunchAgentType | null;
  customAgentId: string | null;
  modelIdentifier: string | null;
  thinkingLevel: string | null;
};

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readModel(value: Record<string, Json | undefined>): string | null {
  return typeof value.model === 'string' && value.model.trim().length > 0
    ? value.model.trim()
    : null;
}

function readThinking(
  value: Record<string, Json | undefined>,
  model: string | null
): string | null {
  if (!model) return null;
  return typeof value.thinking === 'string' && value.thinking.trim().length > 0
    ? value.thinking.trim()
    : null;
}

function resolveBuiltinLaunchAgent(agent: string): LaunchAgentType | null {
  const normalized = agent.trim().toLowerCase();
  if (isLaunchAgentTypeValue(normalized)) {
    return normalized;
  }

  const matched = getAgentTypeByIdentifier(agent);
  if (matched && isLaunchAgentTypeValue(matched.value)) {
    return matched.value;
  }

  return null;
}

export function parseExecutionAgentFromAssignment(
  assignedAgent: Json | null | undefined
): ResolvedExecutionAgent | null {
  if (!assignedAgent) return null;

  if (typeof assignedAgent === 'string') {
    const trimmed = assignedAgent.trim();
    if (!trimmed) return null;

    const launchAgent = resolveBuiltinLaunchAgent(trimmed);
    if (launchAgent) {
      return {
        agentIdentifier: launchAgent,
        launchAgent,
        customAgentId: null,
        modelIdentifier: null,
        thinkingLevel: null
      };
    }

    return {
      agentIdentifier: trimmed,
      launchAgent: null,
      customAgentId: trimmed,
      modelIdentifier: null,
      thinkingLevel: null
    };
  }

  if (!isRecord(assignedAgent) || typeof assignedAgent.agent !== 'string') {
    return null;
  }

  const agent = assignedAgent.agent.trim();
  if (!agent) return null;

  const modelIdentifier = readModel(assignedAgent);
  const thinkingLevel = readThinking(assignedAgent, modelIdentifier);
  const launchAgent = resolveBuiltinLaunchAgent(agent);

  if (launchAgent) {
    return {
      agentIdentifier: launchAgent,
      launchAgent,
      customAgentId: null,
      modelIdentifier,
      thinkingLevel
    };
  }

  return {
    agentIdentifier: agent,
    launchAgent: null,
    customAgentId: agent,
    modelIdentifier,
    thinkingLevel
  };
}

export function requireExecutionAgentFromAssignment(
  assignedAgent: Json | null | undefined
): ResolvedExecutionAgent {
  const resolved = parseExecutionAgentFromAssignment(assignedAgent);
  if (!resolved) {
    throw new Error(NO_ASSIGNED_AGENT_ERROR);
  }
  return resolved;
}
