import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import {
  getLaunchAgentTypeByIdentifier,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import type { Json } from '@/types/database.types';
import type { TicketAssignedAgent } from '@/types/tickets';

function isRecord(value: Json): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLaunchAgent(value: string): value is LaunchAgentType {
  return LAUNCH_AGENT_VALUES.includes(value as LaunchAgentType);
}

export function assignedAgentSelectionToJson(selection: AgentModelSelection): Json {
  if (selection.customAgentId) {
    return {
      agent: selection.customAgentId,
      model: selection.model ?? null,
      thinking: selection.model ? (selection.thinking ?? null) : null
    };
  }

  return {
    agent: selection.agent,
    model: selection.model ?? null,
    thinking: selection.model ? (selection.thinking ?? null) : null
  };
}

export function createTicketAssignedAgent(selection: AgentModelSelection): TicketAssignedAgent {
  const parsed = parseTicketAssignedAgent(assignedAgentSelectionToJson(selection));
  if (!parsed) {
    throw new Error('Failed to build ticket agent assignment.');
  }
  return parsed;
}

export function parseTicketAssignedAgent(value: Json | null): TicketAssignedAgent | null {
  if (!value) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isLaunchAgent(trimmed)) {
      return {
        agent: trimmed,
        model: null,
        thinking: null,
        customAgentId: null
      };
    }

    return {
      agent: getLaunchAgentTypeByIdentifier(trimmed),
      model: null,
      thinking: null,
      customAgentId: trimmed
    };
  }

  if (!isRecord(value) || typeof value.agent !== 'string') {
    return null;
  }

  const agent = value.agent.trim();
  if (!agent) return null;

  const model = typeof value.model === 'string' ? value.model : null;
  const thinking = model && typeof value.thinking === 'string' ? value.thinking : null;

  if (isLaunchAgent(agent)) {
    return {
      agent,
      model,
      thinking,
      customAgentId: null
    };
  }

  const customAgentId =
    typeof value.customAgentId === 'string' && value.customAgentId.trim().length > 0
      ? value.customAgentId.trim()
      : agent;

  return {
    agent: getLaunchAgentTypeByIdentifier(customAgentId),
    model,
    thinking,
    customAgentId
  };
}

export const createObjectiveAssignedAgent = createTicketAssignedAgent;
export const parseObjectiveAssignedAgent = parseTicketAssignedAgent;

export function getAssignedAgentIdentifier(
  assignedAgent: TicketAssignedAgent | null | undefined
): string | null {
  return assignedAgent?.customAgentId ?? assignedAgent?.agent ?? null;
}
