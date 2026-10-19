import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { it } from 'node:test';

import { verifierAad } from './authorizations.ts';
import { openSecret, sealSecret } from './crypto.ts';

it('opens historical organization and profile PKCE envelopes with the shared binding', () => {
  const key = randomBytes(32);
  const verifier = 'historical-pkce-verifier';
  for (const organizationId of ['org-id', null]) {
    const row = { owner_profile_id: 'owner', organization_id: organizationId, id: 'connection' };
    const oldAad =
      organizationId === null
        ? 'overlord:account-connection-authorization:v1:owner:-:connection:authorization'
        : 'overlord:account-connection-authorization:v1:owner:org-id:connection:authorization';
    assert.equal(verifierAad(row, 'authorization'), oldAad);
    const envelope = sealSecret({ plaintext: verifier, key, aad: oldAad });
    assert.equal(openSecret({ envelope, key, aad: verifierAad(row, 'authorization') }), verifier);
    for (const changed of [
      { ...row, owner_profile_id: 'other' },
      { ...row, organization_id: 'other-org' },
      { ...row, id: 'other-connection' }
    ])
      assert.throws(() =>
        openSecret({ envelope, key, aad: verifierAad(changed, 'authorization') })
      );
    assert.throws(() =>
      openSecret({ envelope, key, aad: verifierAad(row, 'other-authorization') })
    );
  }
});
