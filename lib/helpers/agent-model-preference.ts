import {
  isLaunchAgentTypeValue,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { AgentConfig } from '@/lib/schemas/agent-config';

export type AgentModelSelection = {
  agent: LaunchAgentTypeValue;
  model: string | null;
  thinking: string | null;
};

export type UserLaunchPreference = AgentModelSelection;

const DEFAULT_SELECTION: AgentModelSelection = {
  agent: 'claude',
  model: null,
  thinking: null
};

function resolveAgentConfigSelection(
  config?: AgentConfig
): Pick<AgentModelSelection, 'model' | 'thinking'> {
  return {
    model: config?.defaultModel ?? null,
    thinking: config?.defaultModel ? (config?.defaultThinking ?? null) : null
  };
}

export function resolveAgentSelectionForAgent(
  configs: Record<string, AgentConfig>,
  agent: LaunchAgentTypeValue,
  launchPreference?: UserLaunchPreference | null
): AgentModelSelection {
  const configSelection = resolveAgentConfigSelection(configs[agent]);
  const isMatchingLaunchPreference = launchPreference?.agent === agent;
  const launchPreferenceModel = isMatchingLaunchPreference
    ? (launchPreference?.model ?? null)
    : null;
  const model = launchPreferenceModel ?? configSelection.model;

  return {
    agent,
    model,
    thinking: model
      ? launchPreferenceModel !== null
        ? (launchPreference?.thinking ?? configSelection.thinking)
        : (configSelection.thinking ??
          (isMatchingLaunchPreference ? (launchPreference?.thinking ?? null) : null))
      : null
  };
}

export function resolveAgentModelSelection(
  configs: Record<string, AgentConfig>,
  launchPreference?: UserLaunchPreference | null
): AgentModelSelection {
  if (launchPreference && isLaunchAgentTypeValue(launchPreference.agent)) {
    return resolveAgentSelectionForAgent(configs, launchPreference.agent, launchPreference);
  }

  for (const agent of LAUNCH_AGENT_VALUES) {
    const config = configs[agent];
    if (config?.defaultModel) {
      const selection = resolveAgentConfigSelection(config);
      return {
        agent,
        ...selection
      };
    }
  }

  const firstConfiguredAgent = LAUNCH_AGENT_VALUES.find(agent => configs[agent] !== undefined);
  if (firstConfiguredAgent) {
    const selection = resolveAgentConfigSelection(configs[firstConfiguredAgent]);
    return {
      agent: firstConfiguredAgent,
      ...selection
    };
  }

  return DEFAULT_SELECTION;
}
