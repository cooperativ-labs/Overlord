import type { ClientDeviceIdentity } from '../../../packages/core/service/device-identity.ts';

import { isRemoteBackend } from './api-base.ts';
import { getDesktopBridge } from './desktop-chrome.ts';

const DEVICE_FINGERPRINT_HEADER = 'x-overlord-device-fingerprint';
const DEVICE_LABEL_HEADER = 'x-overlord-device-label';
const DEVICE_PLATFORM_HEADER = 'x-overlord-device-platform';

/**
 * Legacy key for the random pseudo-fingerprint an ordinary browser used to invent
 * so it had something to put in the device headers. Contract v38 removed it: a
 * browser profile is not a machine and can never be an execution target. The key
 * is cleared once so it does not linger in users' storage.
 */
const LEGACY_BROWSER_DEVICE_STORAGE_KEY = 'overlord.deviceFingerprint';

let cachedIdentity: ClientDeviceIdentity | null = null;
let loadPromise: Promise<ClientDeviceIdentity | null> | null = null;

function clearLegacyBrowserFingerprint(): void {
  try {
    localStorage.removeItem(LEGACY_BROWSER_DEVICE_STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode, blocked cookies) — nothing to clean.
  }
}

/**
 * Resolve the client **machine** identity for hosted-backend API calls, or `null`
 * when this client has none. Only the desktop shell bridge exposes a real machine
 * fingerprint; an ordinary browser tab sends no device headers at all, because the
 * headers are a machine-local lookup hint and a browser is not a machine.
 */
export async function resolveClientDeviceIdentity(): Promise<ClientDeviceIdentity | null> {
  if (cachedIdentity) return cachedIdentity;
  if (!loadPromise) {
    loadPromise = (async () => {
      const bridge = getDesktopBridge();
      if (bridge?.getDeviceIdentity) {
        cachedIdentity = await bridge.getDeviceIdentity();
        return cachedIdentity;
      }
      clearLegacyBrowserFingerprint();
      return null;
    })();
  }
  return loadPromise;
}

export function clientDeviceHeaders(identity: ClientDeviceIdentity): Record<string, string> {
  return {
    [DEVICE_FINGERPRINT_HEADER]: identity.deviceFingerprint,
    ...(identity.deviceLabel ? { [DEVICE_LABEL_HEADER]: identity.deviceLabel } : {}),
    ...(identity.devicePlatform ? { [DEVICE_PLATFORM_HEADER]: identity.devicePlatform } : {})
  };
}

export async function remoteBackendDeviceHeaders(): Promise<Record<string, string>> {
  if (!isRemoteBackend()) return {};
  const identity = await resolveClientDeviceIdentity();
  return identity ? clientDeviceHeaders(identity) : {};
}
