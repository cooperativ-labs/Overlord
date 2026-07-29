import type { Request } from 'express';

import type { ClientDeviceIdentity } from '../../packages/core/service/device-identity.ts';
import {
  isRunnerRelation,
  type RunnerRegistrationInput
} from '../../packages/core/service/execution-target-runners.ts';

export const DEVICE_FINGERPRINT_HEADER = 'x-overlord-device-fingerprint';
export const DEVICE_LABEL_HEADER = 'x-overlord-device-label';
export const DEVICE_PLATFORM_HEADER = 'x-overlord-device-platform';

export function clientDeviceFromRequest(req: Request): ClientDeviceIdentity | null {
  const deviceFingerprint = req.get(DEVICE_FINGERPRINT_HEADER)?.trim();
  if (!deviceFingerprint) return null;
  return {
    deviceFingerprint,
    deviceLabel: req.get(DEVICE_LABEL_HEADER)?.trim() || null,
    devicePlatform: req.get(DEVICE_PLATFORM_HEADER)?.trim() || null
  };
}

export function clientDeviceFromBody(value: unknown): ClientDeviceIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const deviceFingerprint =
    typeof body.deviceFingerprint === 'string' ? body.deviceFingerprint.trim() : '';
  if (!deviceFingerprint) return null;
  return {
    deviceFingerprint,
    deviceLabel: typeof body.deviceLabel === 'string' ? body.deviceLabel : null,
    devicePlatform: typeof body.devicePlatform === 'string' ? body.devicePlatform : null
  };
}

/**
 * The additive runner-instance identity a claim body may carry (contract v40):
 * which existing execution target this runner serves, its stable instance id,
 * and its `native`/`adopted` relation to that target. Every field is optional —
 * a pre-v40 runner sends none of them and claims exactly as before.
 *
 * Parsing only; the target named here is authorized (and never created) by the
 * service layer.
 */
export function runnerRegistrationFromBody(value: unknown): RunnerRegistrationInput | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  const text = (key: string): string | null => {
    const raw = body[key];
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  const relation = text('runnerRelation');
  const capabilities =
    body.capabilities && typeof body.capabilities === 'object' && !Array.isArray(body.capabilities)
      ? (body.capabilities as Record<string, unknown>)
      : null;
  const supportedAgents = Array.isArray(body.supportedAgents)
    ? body.supportedAgents.filter((agent): agent is string => typeof agent === 'string')
    : null;

  const input: RunnerRegistrationInput = {
    executionTargetId: text('executionTargetId'),
    runnerInstanceId: text('runnerInstanceId'),
    relation: isRunnerRelation(relation) ? relation : null,
    label: text('runnerLabel'),
    runnerVersion: text('runnerVersion'),
    capabilities,
    supportedAgents
  };
  const hasAny = Object.values(input).some(field => field !== null);
  return hasAny ? input : null;
}
