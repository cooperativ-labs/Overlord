import type {
  AgentModelRecord,
  AgentModelSelection,
  AssignedAgent,
  LaunchAgentType
} from '@/lib/types';

/** Reserved `user_agent_configs.agent_type` row for custom agent definitions. */
export const CUSTOM_AGENTS_CONFIG_KEY = '__custom__';

export type CustomAgentOption = {
  value: string;
  label: string;
};

export type CustomAgentPlaceholder = {
  token: string;
  label: string;
  role: 'model' | 'thinking' | 'other';
  options: CustomAgentOption[];
};

export type CustomAgent = {
  id: string;
  name: string;
  commandTemplate: string;
  placeholders: CustomAgentPlaceholder[];
};

/** Parsed `user_agent_configs.config` — mirrors `lib/schemas/agent-config.ts`. */
export type AgentUserConfig = {
  flags: string[];
  preCommand?: string;
  defaultModel?: string;
  defaultThinking?: string;
  hidden?: boolean;
  hiddenModels?: string[];
  customAgents?: CustomAgent[];
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
  'antigravity',
  'opencode',
  'pi'
];

export const AGENT_OPTIONS: ReadonlyArray<{
  value: LaunchAgentType;
  label: string;
}> = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'pi', label: 'Pi' }
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

function parseCustomAgentOption(value: unknown): CustomAgentOption | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.value !== 'string' || typeof record.label !== 'string') return null;
  return { value: record.value, label: record.label };
}

function parseCustomAgentPlaceholder(value: unknown): CustomAgentPlaceholder | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.token !== 'string' || typeof record.label !== 'string') return null;
  const role =
    record.role === 'model' || record.role === 'thinking' || record.role === 'other'
      ? record.role
      : 'other';
  const options = Array.isArray(record.options)
    ? record.options
        .map(parseCustomAgentOption)
        .filter((option): option is CustomAgentOption => option !== null)
    : [];
  return { token: record.token, label: record.label, role, options };
}

function parseCustomAgent(value: unknown): CustomAgent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.commandTemplate !== 'string'
  ) {
    return null;
  }
  const placeholders = Array.isArray(record.placeholders)
    ? record.placeholders
        .map(parseCustomAgentPlaceholder)
        .filter((placeholder): placeholder is CustomAgentPlaceholder => placeholder !== null)
    : [];
  return {
    id: record.id,
    name: record.name,
    commandTemplate: record.commandTemplate,
    placeholders
  };
}

export function parseAgentUserConfig(config: unknown): AgentUserConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  const flags = Array.isArray(record.flags)
    ? record.flags.filter((flag): flag is string => typeof flag === 'string')
    : [];
  const hiddenModels = Array.isArray(record.hiddenModels)
    ? record.hiddenModels.filter((modelId): modelId is string => typeof modelId === 'string')
    : undefined;
  const customAgents = Array.isArray(record.customAgents)
    ? record.customAgents
        .map(parseCustomAgent)
        .filter((agent): agent is CustomAgent => agent !== null)
    : undefined;

  return {
    flags,
    preCommand: typeof record.preCommand === 'string' ? record.preCommand : undefined,
    defaultModel: typeof record.defaultModel === 'string' ? record.defaultModel : undefined,
    defaultThinking:
      typeof record.defaultThinking === 'string' ? record.defaultThinking : undefined,
    hidden: record.hidden === true ? true : undefined,
    hiddenModels: hiddenModels?.length ? hiddenModels : undefined,
    customAgents: customAgents?.length ? customAgents : undefined
  };
}

export function normalizeUserAgentConfigs(
  rows: Array<{ agent_type: string; config: unknown }>
): Record<string, AgentUserConfig> {
  const configs: Record<string, AgentUserConfig> = {};

  for (const row of rows) {
    const parsed = parseAgentUserConfig(row.config);
    if (parsed) {
      configs[row.agent_type] = parsed;
    }
  }

  return configs;
}

export function getCustomAgents(configs: Record<string, AgentUserConfig>): CustomAgent[] {
  return configs[CUSTOM_AGENTS_CONFIG_KEY]?.customAgents ?? [];
}

/** Built-in agents the user has not hidden (the selected agent always remains visible). */
export function getVisibleBuiltInAgents({
  configs,
  selectedAgent
}: {
  configs: Record<string, AgentUserConfig>;
  selectedAgent: LaunchAgentType;
}) {
  return AGENT_OPTIONS.filter(
    option => !configs[option.value]?.hidden || selectedAgent === option.value
  );
}

export function getVisibleModelsForAgent({
  models,
  agent,
  configs
}: {
  models: AgentModelRecord[];
  agent: LaunchAgentType;
  configs: Record<string, AgentUserConfig>;
}): AgentModelRecord[] {
  const hiddenModelIds = configs[agent]?.hiddenModels ?? [];
  return models.filter(model => !hiddenModelIds.includes(model.model_id));
}

export function getAgentThinkingLabel(agent: LaunchAgentType): 'Thinking' | 'Effort' {
  return agent === 'codex' ? 'Effort' : 'Thinking';
}

/** Matches `supportsBuiltInThinkingSelection` in the web agent model store. */
export function supportsBuiltInThinkingSelection(
  agent: LaunchAgentType,
  antigravityManagesModels: boolean
): boolean {
  return !antigravityManagesModels && agent !== 'cursor';
}

export function getModelPlaceholder(agent: CustomAgent): CustomAgentPlaceholder | null {
  return agent.placeholders.find(placeholder => placeholder.role === 'model') ?? null;
}

export function getThinkingPlaceholder(agent: CustomAgent): CustomAgentPlaceholder | null {
  return agent.placeholders.find(placeholder => placeholder.role === 'thinking') ?? null;
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

function resolveAgentConfigSelection(config?: AgentUserConfig) {
  return {
    model: config?.defaultModel ?? null,
    thinking: config?.defaultModel ? (config.defaultThinking ?? null) : null
  };
}

export function resolveSelectionForAgent(
  configs: Record<string, AgentUserConfig>,
  agent: LaunchAgentType,
  launchPreference?: UserLaunchPreference
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
  configs: Record<string, AgentUserConfig>,
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
