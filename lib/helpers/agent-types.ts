export type LaunchAgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' | 'pi';
export type AgentSelectorValue = LaunchAgentType | 'copy-local' | 'copy-cloud' | 'copy-terminal';

export type AgentType = {
  value: LaunchAgentType;
  label: string;
  icon: string;
  identifiers: readonly string[];
  invertDark?: boolean;
};

export const AGENT_TYPES: readonly AgentType[] = [
  {
    value: 'claude',
    label: 'Claude Code',
    icon: '/images/icons/claude-code.svg',
    identifiers: ['claude-code', 'claude'],
    invertDark: false
  },
  {
    value: 'codex',
    label: 'Codex',
    icon: '/images/icons/codex.svg',
    identifiers: ['codex'],
    invertDark: true
  },
  {
    value: 'cursor',
    label: 'Cursor',
    icon: '/images/icons/cursor.svg',
    identifiers: ['cursor'],
    invertDark: true
  },
  {
    value: 'gemini',
    label: 'Gemini',
    icon: '/images/icons/gemini.svg',
    identifiers: ['gemini', 'google-gemini'],
    invertDark: false
  },
  {
    value: 'opencode',
    label: 'OpenCode',
    icon: '/images/icons/opencode.svg',
    identifiers: ['opencode', 'open-code'],
    invertDark: false
  },
  {
    value: 'pi',
    label: 'Pi',
    icon: '/images/icons/pi.svg',
    identifiers: ['pi', 'pi-coding-agent', 'pi.dev'],
    invertDark: true
  }
] as const;

const agentTypesByValue: Record<LaunchAgentType, AgentType> = {
  claude: AGENT_TYPES[0],
  codex: AGENT_TYPES[1],
  cursor: AGENT_TYPES[2],
  gemini: AGENT_TYPES[3],
  opencode: AGENT_TYPES[4],
  pi: AGENT_TYPES[5]
};

export const LAUNCH_AGENT_VALUES: readonly LaunchAgentType[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'opencode',
  'pi'
];
export const COPY_PROMPT_AGENT_VALUES: readonly LaunchAgentType[] = [
  'claude',
  'codex',
  'cursor',
  'gemini',
  'pi'
];
export const AGENT_SELECTOR_VALUES: readonly AgentSelectorValue[] = [
  ...LAUNCH_AGENT_VALUES,
  'copy-local',
  'copy-cloud',
  'copy-terminal'
];

export function isLaunchAgentTypeValue(value: string): value is LaunchAgentType {
  return LAUNCH_AGENT_VALUES.includes(value as LaunchAgentType);
}

export function getAgentTypeByValue(value: LaunchAgentType): AgentType {
  return agentTypesByValue[value];
}

export function getAgentTypeByIdentifier(identifier?: string | null): AgentType | null {
  if (!identifier) return null;
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return null;

  return AGENT_TYPES.find(agent => agent.identifiers.includes(normalizedIdentifier)) ?? null;
}

export function isAgentIdentifierMatch(
  agentValue: LaunchAgentType,
  identifier?: string | null
): boolean {
  if (!identifier) return false;
  const normalizedIdentifier = identifier.trim().toLowerCase();
  if (!normalizedIdentifier) return false;

  return getAgentTypeByValue(agentValue).identifiers.includes(normalizedIdentifier);
}

export function getLaunchAgentTypeByIdentifier(identifier?: string | null): LaunchAgentType {
  const agent = getAgentTypeByIdentifier(identifier);
  if (!agent) return 'claude';
  if (LAUNCH_AGENT_VALUES.includes(agent.value as LaunchAgentType)) {
    return agent.value as LaunchAgentType;
  }
  return 'claude';
}
