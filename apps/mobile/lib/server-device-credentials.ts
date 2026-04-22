import * as SecureStore from 'expo-secure-store';

import type { DeviceServerCredential } from './types';

const SERVER_CREDENTIAL_PREFIX = 'overlord.server-credential.';

function storageKey(serverId: string) {
  return `${SERVER_CREDENTIAL_PREFIX}${serverId}`;
}

export async function getServerDeviceCredential(
  serverId: string
): Promise<DeviceServerCredential | null> {
  const rawValue = await SecureStore.getItemAsync(storageKey(serverId), {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to access server credentials'
  });
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue) as DeviceServerCredential;
  } catch {
    await SecureStore.deleteItemAsync(storageKey(serverId));
    return null;
  }
}

export async function saveServerDeviceCredential(
  credential: DeviceServerCredential
): Promise<void> {
  await SecureStore.setItemAsync(storageKey(credential.serverId), JSON.stringify(credential), {
    requireAuthentication: true,
    authenticationPrompt: 'Authenticate to save server credentials',
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
  });
}

export async function deleteServerDeviceCredential(serverId: string): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(serverId));
}
