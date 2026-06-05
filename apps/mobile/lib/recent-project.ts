import * as SecureStore from 'expo-secure-store';

/**
 * Device-local memory of the project the user most recently created a ticket
 * against. Used as the default project selection in the Create tab and the
 * QuickCreateTicketModal so a one-project-heavy workflow doesn't require
 * re-selecting the project on every ticket.
 */
const RECENT_PROJECT_KEY = 'overlord.recentProjectId';

const persistOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

export function getRecentProjectId(): string | null {
  const value = SecureStore.getItem(RECENT_PROJECT_KEY);
  return value && value.trim().length > 0 ? value : null;
}

export function setRecentProjectId(projectId: string | null): void {
  if (!projectId) {
    void SecureStore.deleteItemAsync(RECENT_PROJECT_KEY);
    return;
  }
  void SecureStore.setItemAsync(RECENT_PROJECT_KEY, projectId, persistOptions);
}
