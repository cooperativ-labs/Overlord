import {
  type AgentSelectorValue,
  getAgentTypeByValue,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';

import type { AgentPluginInstallOption, BundleAgent, SlashCommandConfig } from './cli-page-types';

export const CONNECTOR_UPDATE_WARNING_KEY = 'overlord_connector_update_warning_dismissed';

export const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi'
};

export const COPY_AGENT_LABELS: Record<Extract<AgentSelectorValue, `copy-${string}`>, string> = {
  'copy-local': 'For Local',
  'copy-cloud': 'For Cloud',
  'copy-terminal': 'For Terminal'
};

export function getAgentSelectorLabel(agentValue: LaunchAgentType): string {
  if (agentValue in COPY_AGENT_LABELS) {
    return COPY_AGENT_LABELS[agentValue as keyof typeof COPY_AGENT_LABELS];
  }
  return getAgentTypeByValue(agentValue as LaunchAgentType).label;
}

export const SLASH_COMMAND_CONFIGS: Record<string, SlashCommandConfig> = {
  claude: {
    label: 'Claude Code',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `~/.claude/commands/`.',
    filePaths: [
      '~/.claude/commands/connect.md',
      '~/.claude/commands/load.md',
      '~/.claude/commands/spawn.md'
    ]
  },
  cursor: {
    label: 'Cursor',
    description:
      'Slash commands ship inside the Overlord Cursor plugin under ~/.cursor/plugins/local/overlord/commands (legacy ~/.cursor/commands files are removed on install).',
    supportNote:
      'Uses /connect, /load, /spawn, /create, and /prompt from the plugin directory when the Overlord plugin is enabled.',
    filePaths: [
      '~/.cursor/plugins/local/overlord/commands/connect.md',
      '~/.cursor/plugins/local/overlord/commands/load.md',
      '~/.cursor/plugins/local/overlord/commands/spawn.md',
      '~/.cursor/plugins/local/overlord/commands/create.md',
      '~/.cursor/plugins/local/overlord/commands/prompt.md'
    ]
  },
  antigravity: {
    label: 'Antigravity CLI',
    description:
      'Installs the Overlord Antigravity plugin for mid-session Overlord ticket operations.',
    supportNote:
      'Installs the plugin via `agy plugin install`. Run `ovld setup antigravity` to install.',
    filePaths: [
      '~/.gemini/antigravity-cli/plugins/plugin.json',
      '~/.gemini/antigravity-cli/plugins/hooks.json'
    ]
  },
  opencode: {
    label: 'OpenCode',
    description: 'Installs global slash commands for mid-session Overlord ticket operations.',
    supportNote: 'Creates `/connect`, `/load`, and `/spawn` in `~/.config/opencode/commands/`.',
    filePaths: [
      '~/.config/opencode/commands/connect.md',
      '~/.config/opencode/commands/load.md',
      '~/.config/opencode/commands/spawn.md'
    ]
  }
};

export const BUNDLE_FILE_PATHS: Record<BundleAgent, string[]> = {
  claude: ['~/.ovld/bundle-manifest.json'],
  cursor: [
    '~/.ovld/bundle-manifest.json',
    '~/.cursor/plugins/local/overlord/.cursor-plugin/plugin.json',
    '~/.cursor/hooks.json'
  ],
  antigravity: [
    '~/.ovld/bundle-manifest.json',
    '~/.ovld/antigravity/scripts/overlord-mcp.mjs',
    '~/.gemini/antigravity-cli/plugins/plugin.json',
    '~/.gemini/antigravity-cli/plugins/hooks.json'
  ],
  opencode: ['~/.config/opencode/AGENTS.md', '~/.config/opencode/opencode.json']
};

export const AGENT_PLUGIN_OPTIONS: AgentPluginInstallOption[] = [
  {
    key: 'claude:bundle',
    agentKey: 'claude',
    label: 'Claude plugin',
    description:
      'Gives Claude Code access to Overlord tickets, workflow skills, and mid-session slash commands so it can receive and deliver tickets directly from your terminal.',
    kind: 'bundle',
    bundleAgent: 'claude',
    supportNote: 'https://www.ovld.ai/docs/surfaces/agent-plugins?tab=claude-desktop'
  },
  {
    key: 'codex:overlord-plugin',
    agentKey: 'codex',
    label: 'Chat plugin',
    description:
      'Gives Codex CLI access to Overlord tickets, workflow skills, PermissionRequest notifications, and permission rules so it can receive and deliver tickets directly from your terminal.',
    kind: 'service',
    serviceKey: 'overlord-plugin',
    supportNote: 'https://www.ovld.ai/docs/surfaces/agent-plugins?tab=codex-desktop'
  },
  {
    key: 'cursor:bundle',
    agentKey: 'cursor',
    label: 'Cursor plugin',
    description:
      'Installs the Overlord Cursor local plugin in ~/.cursor/plugins/local/overlord, merges a beforeSubmitPrompt hook into ~/.cursor/hooks.json for activity-feed follow-ups, and permission allow rules so terminal cursor-agent sessions get durable workflow rules, skills, MCP bridge, and slash commands.',
    kind: 'bundle',
    bundleAgent: 'cursor',
    supportNote:
      'Managed by the desktop app or `ovld setup cursor` in ~/.cursor/plugins/local/overlord, ~/.cursor/hooks.json, and ~/.cursor/settings.json. Legacy ~/.cursor/rules and ~/.cursor/commands files are removed during install.'
  },
  {
    key: 'antigravity:bundle',
    agentKey: 'antigravity',
    label: 'Antigravity plugin',
    description: SLASH_COMMAND_CONFIGS.antigravity.description,
    kind: 'bundle',
    bundleAgent: 'antigravity',
    supportNote: SLASH_COMMAND_CONFIGS.antigravity.supportNote
  },
  {
    key: 'opencode:bundle',
    agentKey: 'opencode',
    label: 'Prompt / skills',
    description:
      'Installs durable Overlord workflow instructions and OpenCode config so ticket lifecycle rules, permissions, and slash commands live in local config.',
    kind: 'bundle',
    bundleAgent: 'opencode',
    supportNote: 'Managed by the desktop app in your local ~/.config/opencode configuration.'
  },
  {
    key: 'opencode:slash',
    agentKey: 'opencode',
    label: '/connect /load /spawn',
    description: SLASH_COMMAND_CONFIGS.opencode.description,
    kind: 'slash',
    slashAgent: 'opencode',
    supportNote: SLASH_COMMAND_CONFIGS.opencode.supportNote
  }
];

export const AGENT_PLUGIN_GROUPS = [
  { key: 'claude', label: 'Claude Code' },
  { key: 'codex', label: 'Codex CLI' },
  { key: 'cursor', label: 'Cursor' },
  { key: 'antigravity', label: 'Antigravity CLI' },
  { key: 'opencode', label: 'OpenCode' },
  { key: 'pi', label: 'Pi' }
] as const;
