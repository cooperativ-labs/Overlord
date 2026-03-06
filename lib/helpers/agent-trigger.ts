import { AGENT_SELECTOR_VALUES, type AgentSelectorValue } from './agent-types';

export const DEFAULT_AGENT_TRIGGER_STORAGE_KEY = 'overlord-default-agent-trigger';
export const DEFAULT_AGENT_TRIGGER: AgentSelectorValue = 'claude';

export function parseDefaultAgentTrigger(rawValue: string | null | undefined): AgentSelectorValue {
  if (!rawValue) return DEFAULT_AGENT_TRIGGER;
  if (AGENT_SELECTOR_VALUES.includes(rawValue as AgentSelectorValue)) {
    return rawValue as AgentSelectorValue;
  }
  return DEFAULT_AGENT_TRIGGER;
}

export function readDefaultAgentTriggerFromStorage(): AgentSelectorValue {
  if (typeof window === 'undefined') return DEFAULT_AGENT_TRIGGER;
  return parseDefaultAgentTrigger(window.localStorage.getItem(DEFAULT_AGENT_TRIGGER_STORAGE_KEY));
}
