import * as SecureStore from 'expo-secure-store';

export type ServerTerminalLaunchMode = 'tmux' | 'custom';

export interface ServerTerminalPreference {
  launchMode: ServerTerminalLaunchMode;
  customCommand: string;
}

const SERVER_TERMINAL_PREFERENCE_KEY = 'overlord.server-terminal-preference';

export const DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND =
  'tmux new-window -d -n {window} {command} || tmux new-session -d -s overlord -n {window} {command}';

export const DEFAULT_SERVER_TERMINAL_PREFERENCE: ServerTerminalPreference = {
  launchMode: 'tmux',
  customCommand: DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND
};

export async function getServerTerminalPreference(): Promise<ServerTerminalPreference> {
  const rawValue = await SecureStore.getItemAsync(SERVER_TERMINAL_PREFERENCE_KEY);
  if (!rawValue) return DEFAULT_SERVER_TERMINAL_PREFERENCE;

  try {
    const parsed = JSON.parse(rawValue) as Partial<ServerTerminalPreference>;
    return {
      launchMode: parsed.launchMode === 'custom' ? 'custom' : 'tmux',
      customCommand:
        typeof parsed.customCommand === 'string' && parsed.customCommand.trim().length > 0
          ? parsed.customCommand
          : DEFAULT_SERVER_TERMINAL_CUSTOM_COMMAND
    };
  } catch {
    await SecureStore.deleteItemAsync(SERVER_TERMINAL_PREFERENCE_KEY);
    return DEFAULT_SERVER_TERMINAL_PREFERENCE;
  }
}

export async function saveServerTerminalPreference(
  preference: ServerTerminalPreference
): Promise<void> {
  await SecureStore.setItemAsync(SERVER_TERMINAL_PREFERENCE_KEY, JSON.stringify(preference), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}
