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

export function createTicketAssignedAgent(selection: AgentModelSelection): TicketAssignedAgent {
  return {
    agent: selection.agent,
    model: selection.model ?? null,
    thinking: selection.model ? (selection.thinking ?? null) : null
  };
}

export function parseTicketAssignedAgent(value: Json | null): TicketAssignedAgent | null {
  if (!value) return null;

  if (typeof value === 'string') {
    return {
      agent: getLaunchAgentTypeByIdentifier(value),
      model: null,
      thinking: null
    };
  }

  if (!isRecord(value) || typeof value.agent !== 'string' || !isLaunchAgent(value.agent)) {
    return null;
  }

  const model = typeof value.model === 'string' ? value.model : null;
  const thinking = model && typeof value.thinking === 'string' ? value.thinking : null;

  return {
    agent: value.agent,
    model,
    thinking
  };
}

export const createObjectiveAssignedAgent = createTicketAssignedAgent;
export const parseObjectiveAssignedAgent = parseTicketAssignedAgent;

export function getAssignedAgentIdentifier(
  assignedAgent: TicketAssignedAgent | null | undefined
): string | null {
  return assignedAgent?.agent ?? null;
}
