import assert from 'node:assert/strict';
import { hostname, platform } from 'node:os';
import test from 'node:test';

import { deviceIdentityFromParts } from '@overlord/core/service/device-identity';

import { clientDeviceIdentity } from '../src/device-identity.ts';

function withEnv(
  overrides: Record<string, string | undefined>,
  run: () => void
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('clientDeviceIdentity defaults to hostname-derived fingerprint', () => {
  withEnv(
    {
      OVERLORD_DEVICE_FINGERPRINT: undefined,
      OVERLORD_DEVICE_LABEL: undefined
    },
    () => {
      const expected = deviceIdentityFromParts({
        deviceLabel: hostname(),
        devicePlatform: platform()
      });
      assert.deepEqual(clientDeviceIdentity(), expected);
    }
  );
});

test('OVERLORD_DEVICE_LABEL overrides display label without changing fingerprint', () => {
  withEnv(
    {
      OVERLORD_DEVICE_FINGERPRINT: undefined,
      OVERLORD_DEVICE_LABEL: 'My Devbox'
    },
    () => {
      const identity = clientDeviceIdentity();
      const expectedFingerprint = deviceIdentityFromParts({
        deviceLabel: hostname(),
        devicePlatform: platform()
      }).deviceFingerprint;
      assert.equal(identity.deviceLabel, 'My Devbox');
      assert.equal(identity.deviceFingerprint, expectedFingerprint);
      assert.equal(identity.devicePlatform, platform());
    }
  );
});

test('OVERLORD_DEVICE_FINGERPRINT pins execution-target identity across containers', () => {
  withEnv(
    {
      OVERLORD_DEVICE_FINGERPRINT: 'cf857924-0eb4-447d-b999-307c1411f094',
      OVERLORD_DEVICE_LABEL: undefined
    },
    () => {
      const identity = clientDeviceIdentity();
      assert.equal(identity.deviceFingerprint, 'cf857924-0eb4-447d-b999-307c1411f094');
      assert.equal(identity.deviceLabel, hostname());
      assert.equal(identity.devicePlatform, platform());
    }
  );
});

test('OVERLORD_DEVICE_FINGERPRINT and OVERLORD_DEVICE_LABEL can be set together', () => {
  withEnv(
    {
      OVERLORD_DEVICE_FINGERPRINT: 'stable-agentpod-env',
      OVERLORD_DEVICE_LABEL: 'AgentPod'
    },
    () => {
      assert.deepEqual(clientDeviceIdentity(), {
        deviceFingerprint: 'stable-agentpod-env',
        deviceLabel: 'AgentPod',
        devicePlatform: platform()
      });
    }
  );
});

test('blank OVERLORD_DEVICE_FINGERPRINT falls back to hostname derivation', () => {
  withEnv(
    {
      OVERLORD_DEVICE_FINGERPRINT: '   ',
      OVERLORD_DEVICE_LABEL: undefined
    },
    () => {
      const expected = deviceIdentityFromParts({
        deviceLabel: hostname(),
        devicePlatform: platform()
      });
      assert.deepEqual(clientDeviceIdentity(), expected);
    }
  );
});
