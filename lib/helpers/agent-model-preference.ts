import {
  isLaunchAgentTypeValue,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import type { AgentConfig } from '@/lib/schemas/agent-config';

export type AgentModelSelection = {
  agent: LaunchAgentType;
  model: string | null;
  thinking: string | null;
  /**
   * When set, the selection targets a user-defined custom agent (see
   * lib/schemas/agent-config CustomAgent). `agent` then holds a placeholder
   * built-in value; `customAgentId` is authoritative for display/launch.
   */
  customAgentId?: string | null;
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
  agent: LaunchAgentType,
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

  // A non-built-in agent string means the user last selected a custom agent.
  if (
    launchPreference &&
    launchPreference.agent &&
    !isLaunchAgentTypeValue(launchPreference.agent)
  ) {
    return {
      agent: 'claude',
      model: launchPreference.model ?? null,
      thinking: launchPreference.thinking ?? null,
      customAgentId: launchPreference.agent
    };
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
