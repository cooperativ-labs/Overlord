import { AGENT_SELECTOR_VALUES, type LaunchAgentType } from './agent-types';

export const DEFAULT_AGENT_TRIGGER_STORAGE_KEY = 'overlord-default-agent-trigger';
export const DEFAULT_AGENT_TRIGGER: LaunchAgentType = 'claude';

export function parseDefaultAgentTrigger(rawValue: string | null | undefined): LaunchAgentType {
  if (!rawValue) return DEFAULT_AGENT_TRIGGER;
  if (AGENT_SELECTOR_VALUES.includes(rawValue as LaunchAgentType)) {
    return rawValue as LaunchAgentType;
  }
  return DEFAULT_AGENT_TRIGGER;
}

export function readDefaultAgentTriggerFromStorage(): LaunchAgentType {
  if (typeof window === 'undefined') return DEFAULT_AGENT_TRIGGER;
  return parseDefaultAgentTrigger(window.localStorage.getItem(DEFAULT_AGENT_TRIGGER_STORAGE_KEY));
}
