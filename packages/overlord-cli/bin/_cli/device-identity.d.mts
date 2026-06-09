export const CANONICAL_DEVICE_FILE: string;

export function getLegacyDesktopDeviceFilePath(userDataPath: string): string;

export function readOrCreateCanonicalDeviceFingerprintSync(input?: {
  explicitFingerprint?: string | null | undefined;
  legacyDesktopUserDataPath?: string | null | undefined;
}): string;

export function readOrCreateCanonicalDeviceFingerprint(input?: {
  legacyDesktopUserDataPath?: string | null | undefined;
}): Promise<string>;
