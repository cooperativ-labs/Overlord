export type AgentTypeValue = 'claude' | 'codex' | 'cursor' | 'gemini';
export type LaunchAgentTypeValue = AgentTypeValue;
export type CopyPromptAgentTypeValue = AgentTypeValue;
export type AgentSelectorValue = LaunchAgentTypeValue | 'copy-local' | 'copy-cloud';

export type AgentType = {
  value: AgentTypeValue;
  label: string;
  icon: string;
  identifiers: readonly string[];
};

export const AGENT_TYPES: readonly AgentType[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: '/images/icons/claude-code.svg',
    identifiers: ['claude-code', 'claude']
  },
  {
    value: 'codex',
    label: 'Codex',
    icon: '/images/icons/codex.svg',
    identifiers: ['codex']
  },
  {
    value: 'cursor',
    label: 'Cursor',
    icon: '/images/icons/cursor.svg',
    identifiers: ['cursor']
  },
  {
    value: 'gemini',
    label: 'Gemini',
    icon: '/images/icons/gemini.svg',
    identifiers: ['gemini', 'google-gemini']
  }
] as const;

const agentTypesByValue: Record<AgentTypeValue, AgentType> = {
  claude: AGENT_TYPES[0],
  codex: AGENT_TYPES[1],
  cursor: AGENT_TYPES[2],
  gemini: AGENT_TYPES[3]
};

export const LAUNCH_AGENT_VALUES: readonly LaunchAgentTypeValue[] = [
  'claude',
  'codex',
  'cursor',
  'gemini'
];
export const COPY_PROMPT_AGENT_VALUES: readonly CopyPromptAgentTypeValue[] = [
  'claude',
  'codex',
  'cursor',
  'gemini'
];
export const AGENT_SELECTOR_VALUES: readonly AgentSelectorValue[] = [
  ...LAUNCH_AGENT_VALUES,
  'copy-local',
  'copy-cloud'
];

export function getAgentTypeByValue(value: AgentTypeValue): AgentType {
  return agentTypesByValue[value];
}

export function getAgentTypeByIdentifier(identifier?: string | null): AgentType | null {
  if (!identifier) return null;
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return null;

  return AGENT_TYPES.find(agent => agent.identifiers.includes(normalizedIdentifier)) ?? null;
}

export function isAgentIdentifierMatch(
  agentValue: AgentTypeValue,
  identifier?: string | null
): boolean {
  if (!identifier) return false;
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return false;

  return getAgentTypeByValue(agentValue).identifiers.includes(normalizedIdentifier);
}

export function getLaunchAgentTypeByIdentifier(identifier?: string | null): LaunchAgentTypeValue {
  const agent = getAgentTypeByIdentifier(identifier);
  if (!agent) return 'claude';
  if (LAUNCH_AGENT_VALUES.includes(agent.value as LaunchAgentTypeValue)) {
    return agent.value as LaunchAgentTypeValue;
  }
  return 'claude';
}
