import { deviceIdentityFromParts } from '@overlord/core/service/device-identity';
import { hostname, platform } from 'node:os';

/**
 * Stable device identity for the machine running the CLI (matches core `devices.ts`).
 *
 * By default the fingerprint is derived from the process hostname + platform so a
 * real workstation stays one execution target. Disposable AgentPod containers share
 * a host environment: set `OVERLORD_DEVICE_FINGERPRINT` (and optionally
 * `OVERLORD_DEVICE_LABEL`) so every container reuses that environment's target
 * instead of registering a new one per hostname.
 */
export function clientDeviceIdentity(): {
  deviceFingerprint: string;
  deviceLabel: string;
  devicePlatform: string;
} {
  const fingerprintOverride = process.env.OVERLORD_DEVICE_FINGERPRINT?.trim();
  const labelOverride = process.env.OVERLORD_DEVICE_LABEL?.trim();
  const hostLabel = hostname();

  if (fingerprintOverride) {
    return {
      deviceFingerprint: fingerprintOverride,
      deviceLabel: labelOverride || hostLabel,
      devicePlatform: platform()
    };
  }

  // Fingerprint stays derived from the real hostname so it remains stable across
  // process restarts; only the human-facing label is overridable when fingerprint
  // is not explicitly set.
  const identity = deviceIdentityFromParts({
    deviceLabel: hostLabel,
    devicePlatform: platform()
  });
  if (labelOverride) {
    identity.deviceLabel = labelOverride;
  }
  return identity;
}
