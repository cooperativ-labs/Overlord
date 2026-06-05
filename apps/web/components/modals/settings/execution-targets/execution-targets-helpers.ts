import type { ExecutionTargetOwnership } from '@/lib/actions/resource-directories';
import { LAUNCH_AGENT_VALUES, type LaunchAgentType } from '@/lib/helpers/agent-types';

export type TerminalProfileState = {
  terminalApp: string;
  terminalLaunchMode: string;
  terminalCustomHotkey: string;
  customTerminalApp: string;
  terminalTmuxHostApp: string;
  customTerminalTmuxHostApp: string;
  terminalTmuxCommand: string;
};

export const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'tmux', label: 'tmux' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'cmux', label: 'cmux' },
  { value: 'custom', label: 'Custom…' }
] as const;

export const externalTerminalLaunchModeOptions = [
  { value: 'window', label: 'New window' },
  { value: 'tab', label: 'New tab' },
  { value: 'custom', label: 'Custom' }
] as const;

export const tmuxHostTerminalOptions = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'custom', label: 'Custom…' }
] as const;

export const DEFAULT_TMUX_COMMAND = 'tmux new-session bash {script}';

export const DEFAULT_TERMINAL_PROFILE: TerminalProfileState = {
  terminalApp: 'default',
  terminalLaunchMode: 'tab',
  terminalCustomHotkey: '',
  customTerminalApp: '',
  terminalTmuxHostApp: 'terminal',
  customTerminalTmuxHostApp: '',
  terminalTmuxCommand: DEFAULT_TMUX_COMMAND
};

export const PROFILE_FIELDS: (keyof TerminalProfileState)[] = [
  'terminalApp',
  'terminalLaunchMode',
  'terminalCustomHotkey',
  'customTerminalApp',
  'terminalTmuxHostApp',
  'customTerminalTmuxHostApp',
  'terminalTmuxCommand'
];

export const AGENTS: readonly LaunchAgentType[] = LAUNCH_AGENT_VALUES;

export const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi'
};

export const COPY_AGENT_LABELS: Record<string, string> = {
  'copy-local': 'For Local',
  'copy-cloud': 'For Cloud',
  'copy-terminal': 'For Terminal'
};

export function removeOrganizationFromOwnership(
  ownership: ExecutionTargetOwnership,
  organizationId: number
): ExecutionTargetOwnership | null {
  const organizations = ownership.organizations.filter(
    organization => organization.organizationId !== organizationId
  );

  return organizations.length > 0 ? { ...ownership, organizations } : null;
}

export function settingKey(targetId: string, field: keyof TerminalProfileState): string {
  return `executionTarget.${targetId}.${field}`;
}

export function isTmuxLikeProfile(profile: TerminalProfileState) {
  if (profile.terminalApp === 'tmux' || profile.terminalApp === 'cmux') return true;
  if (profile.terminalApp !== 'custom') return false;
  const normalized = profile.customTerminalApp.trim().toLowerCase();
  return normalized.includes('tmux') || normalized.includes('cmux');
}

export function authMethodLabel(method: string): string {
  switch (method) {
    case 'agent':
      return 'SSH Agent';
    case 'key':
      return 'Private Key';
    case 'tailscale':
      return 'Tailscale SSH';
    default:
      return method;
  }
}
