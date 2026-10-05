import { type DatabaseClient } from '@overlord/database';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { generateUserTokenSecret, getActorForToken, verifyUserToken } from '../auth/src/index.ts';

import {
  type ConformanceAdapter,
  conformanceAdapters,
  createConformanceDatabase,
  seedAuthenticatedOperatorClient
} from './test-helpers.ts';

const adapters = conformanceAdapters();
const open = (adapter: ConformanceAdapter) =>
  createConformanceDatabase(adapter, 'ovld_token_consent');

async function insertToken(
  client: DatabaseClient,
  {
    id,
    profileId = 'owner',
    organizationId,
    allWorkspaces = false,
    workspaceId = 'ws-a'
  }: {
    id: string;
    profileId?: string;
    organizationId: string | null;
    allWorkspaces?: boolean;
    workspaceId?: string | null;
  }
): Promise<string> {
  const minted = generateUserTokenSecret();
  const now = new Date().toISOString();
  await client.run(
    `INSERT INTO user_tokens (
       id, workspace_id, organization_id, all_workspaces, profile_id, label,
       token_prefix, token_hash, hash_algorithm, status, last_used_context_json,
       metadata_json, created_at, updated_at, revision
     ) VALUES (?, ?, ?, ${allWorkspaces ? 'TRUE' : 'FALSE'}, ?, ?, ?, ?, 'sha256', 'active', '{}', '{}', ?, ?, 1)`,
    [id, workspaceId, organizationId, profileId, id, minted.prefix, minted.hash, now, now]
  );
  return minted.secret;
}

async function grantConsent(
  client: DatabaseClient,
  tokenId: string,
  workspaceId: string
): Promise<void> {
  await client.run(
    `INSERT INTO user_token_workspaces (token_id, workspace_id, created_at) VALUES (?, ?, ?)`,
    [tokenId, workspaceId, new Date().toISOString()]
  );
}

for (const adapter of adapters) {
  describe(`organization-bound USER_TOKEN consent [${adapter}]`, () => {
    it('allows only explicit consent intersected with a live membership', async () => {
      const { db: client, cleanup } = await open(adapter);
      try {
        await seedAuthenticatedOperatorClient({
          client,
          organizationId: 'org-a',
          workspaceId: 'ws-a',
          profileId: 'owner',
          workspaceUserId: 'member-a'
        });
        await seedAuthenticatedOperatorClient({
          client,
          organizationId: 'org-a',
          workspaceId: 'ws-b',
          profileId: 'owner',
          workspaceUserId: 'member-b'
        });
        const secret = await insertToken(client, { id: 'explicit', organizationId: 'org-a' });
        await grantConsent(client, 'explicit', 'ws-a');

        assert.ok(await getActorForToken(client, secret, 'ws-a'));
        assert.equal(await getActorForToken(client, secret, 'ws-b'), null);

        await client.run(`UPDATE workspace_users SET status = 'disabled' WHERE id = ?`, [
          'member-a'
        ]);
        assert.equal(await getActorForToken(client, secret, 'ws-a'), null);
      } finally {
        await cleanup();
      }
    });

    it('all-workspaces consent is organization-bounded and explicit empty consent fails closed', async () => {
      const { db: client, cleanup } = await open(adapter);
      try {
        for (const [organizationId, workspaceId, workspaceUserId] of [
          ['org-a', 'ws-a', 'member-a'],
          ['org-a', 'ws-b', 'member-b'],
          ['org-b', 'ws-other', 'member-other']
        ]) {
          await seedAuthenticatedOperatorClient({
            client,
            organizationId,
            workspaceId,
            profileId: 'owner',
            workspaceUserId
          });
        }
        const allSecret = await insertToken(client, {
          id: 'all',
          organizationId: 'org-a',
          allWorkspaces: true
        });
        const emptySecret = await insertToken(client, {
          id: 'empty',
          organizationId: 'org-a',
          allWorkspaces: false
        });

        assert.ok(await getActorForToken(client, allSecret, 'ws-a'));
        assert.ok(await getActorForToken(client, allSecret, 'ws-b'));
        assert.equal(await getActorForToken(client, allSecret, 'ws-other'), null);
        assert.equal(await getActorForToken(client, emptySecret, 'ws-a'), null);
      } finally {
        await cleanup();
      }
    });

    it('rejects cross-organization consent and revoked credentials', async () => {
      const { db: client, cleanup } = await open(adapter);
      try {
        await seedAuthenticatedOperatorClient({
          client,
          organizationId: 'org-a',
          workspaceId: 'ws-a',
          profileId: 'owner',
          workspaceUserId: 'member-a'
        });
        await seedAuthenticatedOperatorClient({
          client,
          organizationId: 'org-b',
          workspaceId: 'ws-b',
          profileId: 'owner',
          workspaceUserId: 'member-b'
        });
        const secret = await insertToken(client, { id: 'revocable', organizationId: 'org-a' });
        await assert.rejects(() => grantConsent(client, 'revocable', 'ws-b'));
        await grantConsent(client, 'revocable', 'ws-a');
        assert.ok(await verifyUserToken(client, secret));
        await client.run(`UPDATE user_tokens SET status = 'revoked' WHERE id = ?`, ['revocable']);
        assert.equal(await verifyUserToken(client, secret), null);
        assert.equal(await getActorForToken(client, secret, 'ws-a'), null);
      } finally {
        await cleanup();
      }
    });
  });
}
