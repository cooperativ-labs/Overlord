import type {
  AgentModelRecord,
  AgentModelSelection,
  AssignedAgent,
  LaunchAgentType
} from '@/lib/types';

type UserAgentConfig = {
  defaultModel?: string;
  defaultThinking?: string;
};

type UserLaunchPreference = AgentModelSelection | null;

export const DEFAULT_AGENT_MODEL_SELECTION: AgentModelSelection = {
  agent: 'claude',
  model: null,
  thinking: null
};

export const LAUNCH_AGENT_VALUES: readonly LaunchAgentType[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'opencode'
];

export const AGENT_OPTIONS: ReadonlyArray<{
  value: LaunchAgentType;
  label: string;
  icon: string;
}> = [
  { value: 'claude', label: 'Claude Code', icon: 'flash-outline' },
  { value: 'codex', label: 'Codex', icon: 'code-slash-outline' },
  { value: 'cursor', label: 'Cursor', icon: 'navigate-outline' },
  { value: 'gemini', label: 'Gemini', icon: 'diamond-outline' },
  { value: 'opencode', label: 'OpenCode', icon: 'terminal-outline' }
];

export function createAssignedAgent(selection: AgentModelSelection): AssignedAgent {
  return {
    agent: selection.agent,
    model: selection.model ?? null,
    thinking: selection.model ? (selection.thinking ?? null) : null
  };
}

export function selectionFromAssignedAgent(
  assignedAgent: AssignedAgent | null | undefined
): AgentModelSelection | null {
  if (!assignedAgent?.agent || !LAUNCH_AGENT_VALUES.includes(assignedAgent.agent)) {
    return null;
  }

  return {
    agent: assignedAgent.agent,
    model: assignedAgent.model ?? null,
    thinking: assignedAgent.model ? (assignedAgent.thinking ?? null) : null
  };
}

export function formatAssignedAgentLabel(agent: AssignedAgent | null): string | null {
  if (!agent?.agent) return null;

  const option = AGENT_OPTIONS.find(item => item.value === agent.agent);
  const parts = [option?.label ?? agent.agent];

  if (agent.model) parts.push(agent.model);
  if (agent.thinking) parts.push(agent.thinking);

  return parts.join(' · ');
}

export function normalizeAgentModels(rows: Record<string, unknown>[]): AgentModelRecord[] {
  return rows
    .map(row => {
      const agentType = row.agent_type;
      if (
        typeof agentType !== 'string' ||
        !LAUNCH_AGENT_VALUES.includes(agentType as LaunchAgentType)
      ) {
        return null;
      }

      return {
        id: String(row.id),
        agent_type: agentType as LaunchAgentType,
        model_id: String(row.model_id),
        display_name: String(row.display_name),
        thinking_options: Array.isArray(row.thinking_options)
          ? row.thinking_options.filter((item): item is string => typeof item === 'string')
          : [],
        is_offered: Boolean(row.is_offered),
        is_recommended: Boolean(row.is_recommended),
        sort_order: typeof row.sort_order === 'number' ? row.sort_order : 0,
        updated_at: typeof row.updated_at === 'string' ? row.updated_at : ''
      } satisfies AgentModelRecord;
    })
    .filter((model): model is AgentModelRecord => Boolean(model && model.is_offered));
}

export function normalizeUserAgentConfigs(
  rows: Array<{ agent_type: string; config: unknown }>
): Record<LaunchAgentType, UserAgentConfig> {
  const configs = {} as Record<LaunchAgentType, UserAgentConfig>;

  for (const row of rows) {
    if (!LAUNCH_AGENT_VALUES.includes(row.agent_type as LaunchAgentType)) continue;
    const config = row.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) continue;

    configs[row.agent_type as LaunchAgentType] = {
      defaultModel:
        typeof (config as UserAgentConfig).defaultModel === 'string'
          ? (config as UserAgentConfig).defaultModel
          : undefined,
      defaultThinking:
        typeof (config as UserAgentConfig).defaultThinking === 'string'
          ? (config as UserAgentConfig).defaultThinking
          : undefined
    };
  }

  return configs;
}

export function normalizeLaunchPreference(
  row:
    | {
        agent_type: string;
        model_id: string | null;
        thinking: string | null;
      }
    | null
    | undefined
): UserLaunchPreference {
  if (!row || !LAUNCH_AGENT_VALUES.includes(row.agent_type as LaunchAgentType)) {
    return null;
  }

  return {
    agent: row.agent_type as LaunchAgentType,
    model: row.model_id ?? null,
    thinking: row.model_id ? (row.thinking ?? null) : null
  };
}

function resolveAgentConfigSelection(config?: UserAgentConfig) {
  return {
    model: config?.defaultModel ?? null,
    thinking: config?.defaultModel ? (config.defaultThinking ?? null) : null
  };
}

export function resolveSelectionForAgent(
  configs: Record<LaunchAgentType, UserAgentConfig>,
  agent: LaunchAgentType,
  launchPreference?: UserLaunchPreference
): AgentModelSelection {
  const configSelection = resolveAgentConfigSelection(configs[agent]);
  const isMatchingLaunchPreference = launchPreference?.agent === agent;
  const model =
    configSelection.model ??
    (isMatchingLaunchPreference ? (launchPreference?.model ?? null) : null);

  return {
    agent,
    model,
    thinking: model
      ? (configSelection.thinking ??
        (isMatchingLaunchPreference ? (launchPreference?.thinking ?? null) : null))
      : null
  };
}

export function resolveAgentModelSelection(
  configs: Record<LaunchAgentType, UserAgentConfig>,
  launchPreference?: UserLaunchPreference
): AgentModelSelection {
  if (launchPreference) {
    return resolveSelectionForAgent(configs, launchPreference.agent, launchPreference);
  }

  for (const agent of LAUNCH_AGENT_VALUES) {
    if (configs[agent]?.defaultModel) {
      return resolveSelectionForAgent(configs, agent, launchPreference);
    }
  }

  const configuredAgent = LAUNCH_AGENT_VALUES.find(agent => configs[agent] !== undefined);
  if (configuredAgent) {
    return resolveSelectionForAgent(configs, configuredAgent, launchPreference);
  }

  return DEFAULT_AGENT_MODEL_SELECTION;
}
