import { safeStorage } from 'electron';

import { store } from './settings-store.js';

function sessionStorageKey(profileId: string): string {
  return `backendSessionToken:${profileId}`;
}

function readEncryptedToken(key: string): string | null {
  const encrypted = store.get(key);
  if (typeof encrypted !== 'string' || encrypted.length === 0) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function writeEncryptedToken({ key, token }: { key: string; token: string }): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system.');
  }
  store.set(key, safeStorage.encryptString(token).toString('base64'));
}

export function getSessionToken(profileId: string): string | null {
  // USER_TOKEN is a CLI/headless credential. Remove the legacy desktop slot
  // without decrypting or exposing it before loading the in-app session token.
  store.delete(`backendBearerToken:${profileId}`);
  return readEncryptedToken(sessionStorageKey(profileId));
}

export function setSessionToken({ profileId, token }: { profileId: string; token: string }): void {
  const trimmed = token.trim();
  if (!trimmed) {
    clearSessionToken(profileId);
    return;
  }
  writeEncryptedToken({ key: sessionStorageKey(profileId), token: trimmed });
}

export function clearSessionToken(profileId: string): void {
  store.delete(sessionStorageKey(profileId));
}

const LOCAL_OPENROUTER_KEY = 'localOpenRouterKey';

export function getLocalOpenRouterKey(): string | null {
  return readEncryptedToken(LOCAL_OPENROUTER_KEY);
}

export function setLocalOpenRouterKey(value: string): void {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Enter an OpenRouter API key.');
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('Secure storage is unavailable on this system.');
  }
  writeEncryptedToken({ key: LOCAL_OPENROUTER_KEY, token: trimmed });
}

export function clearLocalOpenRouterKey(): void {
  store.delete(LOCAL_OPENROUTER_KEY);
}
