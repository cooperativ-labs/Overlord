import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { it } from 'node:test';

import {
  keyById,
  type KeyRing,
  knowledgebaseKeyById,
  missingKeyIsConfiguration
} from './keyring.ts';

it('organization key lookup excludes the personal provider fallback keys', () => {
  const ring: KeyRing = {
    current: { id: 'k1', key: randomBytes(32) },
    platform: { id: 'platform-current', key: randomBytes(32) },
    fallback: { github: { id: 'github-user-env', key: randomBytes(32) } }
  };
  assert.equal(knowledgebaseKeyById(ring, 'k1'), ring.current);
  assert.equal(knowledgebaseKeyById(ring, 'platform-current'), ring.platform);
  assert.equal(knowledgebaseKeyById(ring, 'github-user-env'), null);
  assert.equal(keyById(ring, 'github-user-env'), ring.fallback.github);
});

it('keeps the distinct organization and profile missing-key policies', () => {
  for (const current of [null, { id: 'current', key: randomBytes(32) }]) {
    for (const platform of [null, { id: 'platform-current', key: randomBytes(32) }]) {
      const ring: KeyRing = { current, platform, fallback: {} };
      for (const keyId of ['old-explicit', 'platform-old', 'github-user-env', 'everhour-env']) {
        for (const format of [
          'connection-v1',
          'github-user-oauth-v1',
          'everhour-user-key-v1'
        ] as const) {
          assert.equal(
            missingKeyIsConfiguration(ring, keyId, format, 'organization'),
            keyId.startsWith('platform-') ? platform === null : current === null
          );
          assert.equal(
            missingKeyIsConfiguration(ring, keyId, format),
            keyId.startsWith('platform-')
              ? platform === null
              : keyId.endsWith('-env') || format !== 'connection-v1' || current === null
          );
        }
      }
    }
  }
});
