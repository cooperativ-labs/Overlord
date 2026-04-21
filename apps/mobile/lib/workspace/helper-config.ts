import * as SecureStore from 'expo-secure-store';

import type { MobileHelperConfig } from './types';

const HELPER_CONFIG_PREFIX = 'overlord.workspace-helper.';

function storageKey(serverId: string): string {
  return `${HELPER_CONFIG_PREFIX}${serverId}`;
}

export async function getHelperConfig(serverId: string): Promise<MobileHelperConfig | null> {
  const raw = await SecureStore.getItemAsync(storageKey(serverId), {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to access workspace helper credentials'
  });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MobileHelperConfig;
  } catch {
    await SecureStore.deleteItemAsync(storageKey(serverId));
    return null;
  }
}

export async function saveHelperConfig(config: MobileHelperConfig): Promise<void> {
  await SecureStore.setItemAsync(storageKey(config.serverId), JSON.stringify(config), {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to save workspace helper credentials',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

export async function deleteHelperConfig(serverId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(serverId));
}
