import type { Json } from '@/types/database.types';

export type RunnerTerminalProfile = {
  terminalApp: string;
  terminalLaunchMode: string;
  terminalCustomHotkey: string;
  customTerminalApp: string;
  terminalTmuxHostApp: string;
  customTerminalTmuxHostApp: string;
  terminalTmuxCommand: string;
};

export const DEFAULT_RUNNER_TERMINAL_PROFILE: RunnerTerminalProfile = {
  terminalApp: 'default',
  terminalLaunchMode: 'tab',
  terminalCustomHotkey: '',
  customTerminalApp: '',
  terminalTmuxHostApp: 'terminal',
  customTerminalTmuxHostApp: '',
  terminalTmuxCommand: 'tmux new-session bash {script}'
};

export const RUNNER_TERMINAL_PROFILE_PREFERENCE_KEY = 'runner_terminal_profile';

const PROFILE_FIELDS = Object.keys(
  DEFAULT_RUNNER_TERMINAL_PROFILE
) as (keyof RunnerTerminalProfile)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeRunnerTerminalProfile(value: unknown): RunnerTerminalProfile {
  const source = isRecord(value) ? value : {};
  const next = { ...DEFAULT_RUNNER_TERMINAL_PROFILE };
  for (const field of PROFILE_FIELDS) {
    const fieldValue = source[field];
    if (typeof fieldValue === 'string') {
      next[field] = fieldValue;
    }
  }
  if (!next.terminalTmuxCommand.trim()) {
    next.terminalTmuxCommand = DEFAULT_RUNNER_TERMINAL_PROFILE.terminalTmuxCommand;
  }
  return next;
}

export function runnerTerminalProfileToJson(profile: RunnerTerminalProfile): Json {
  return normalizeRunnerTerminalProfile(profile) as unknown as Json;
}
