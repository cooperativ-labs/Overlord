import type { DatabaseClient } from '@overlord/database';

import { EVERHOUR_ENV_KEY_ID } from '../../connections/keyring.ts';
import {
  type ExternalAccount,
  type LegacyCredential,
  registerProfileConnectionProvider
} from '../../connections/profile.ts';

/**
 * The Everhour account-connection provider adapter (contract v153). The shared
 * connections module stores, encrypts, and re-seals the personal API key; this
 * adapter supplies only Everhour-specific behaviour: upstream validation and the
 * pre-v153 `ext_everhour_user_connections` store, which stays a read-only
 * migration source for one release.
 */
export const EVERHOUR_SERVER_URL = 'https://api.everhour.com';

interface LegacyUserConnectionRow {
  id: string;
  api_key_ciphertext: string;
  account_id: string | null;
  account_name: string | null;
  last_validated_at: string;
  created_at: string;
  updated_at: string;
}

export function registerEverhourConnectionProvider(
  validateApiKey: (apiKey: string) => Promise<ExternalAccount>
): void {
  registerProfileConnectionProvider({
    provider: 'everhour',
    serverUrl: EVERHOUR_SERVER_URL,
    credentialKind: 'api_key',
    validateApiKey,
    legacy: {
      async find(db: DatabaseClient, profileId: string): Promise<LegacyCredential | null> {
        const row = await db.get<LegacyUserConnectionRow>(
          `SELECT id, api_key_ciphertext, account_id, account_name, last_validated_at, created_at, updated_at
             FROM ext_everhour_user_connections
            WHERE profile_id = ? AND deleted_at IS NULL`,
          [profileId]
        );
        if (!row) return null;
        return {
          id: row.id,
          ciphertext: row.api_key_ciphertext,
          format: 'everhour-user-key-v1',
          keyId: EVERHOUR_ENV_KEY_ID,
          account: { id: row.account_id, label: row.account_name },
          lastValidatedAt: row.last_validated_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      },
      async isLive(db: DatabaseClient, legacyId: string): Promise<boolean> {
        return Boolean(
          await db.get(
            'SELECT 1 AS present FROM ext_everhour_user_connections WHERE id = ? AND deleted_at IS NULL',
            [legacyId]
          )
        );
      },
      async tombstone(db: DatabaseClient, profileId: string, at: string): Promise<void> {
        await db.run(
          `UPDATE ext_everhour_user_connections
              SET deleted_at = ?, updated_at = ?, api_key_ciphertext = 'revoked:v1', revision = revision + 1
            WHERE profile_id = ? AND deleted_at IS NULL`,
          [at, at, profileId]
        );
      }
    }
  });
}
