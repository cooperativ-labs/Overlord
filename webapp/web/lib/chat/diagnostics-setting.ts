import { useSyncExternalStore } from 'react';

export const CHAT_DIAGNOSTICS_KEY = 'overlord.chatDiagnostics';
const changed = 'overlord-chat-diagnostics-changed';
export function chatDiagnosticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(CHAT_DIAGNOSTICS_KEY) === 'true';
  } catch {
    return false;
  }
}
export function setChatDiagnosticsEnabled(enabled: boolean): void {
  window.localStorage.setItem(CHAT_DIAGNOSTICS_KEY, String(enabled));
  window.dispatchEvent(new Event(changed));
}
function subscribe(listener: () => void) {
  window.addEventListener(changed, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', listener);
  };
}
export function useChatDiagnosticsEnabled(): boolean {
  return useSyncExternalStore(subscribe, chatDiagnosticsEnabled, () => false);
}
