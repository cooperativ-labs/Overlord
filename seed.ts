import { createSeedClient } from '@snaplet/seed';

const PRECOMPUTED_BCRYPT: Record<string, string> = {
  'bqz2bme.edk5dtz8JBW': '$2a$10$Ak5xAbjO2ZkpsgwBqKwsxOWQcnc2XDyCVZ4WN9Dh0GukXjO5PmAm6'
};

const hash = async (password: string, _rounds: number): Promise<string> => {
  const hashed = PRECOMPUTED_BCRYPT[password];
  if (!hashed) {
    throw new Error(`Missing precomputed bcrypt hash for password: ${password}`);
  }

  return hashed;
};

async function main() {
  const seed = await createSeedClient({ dryRun: true });

  // Clear existing data
  await seed.$resetDatabase();

  const jakePassword = 'bqz2bme.edk5dtz8JBW';
  const jakeHashedPassword = await hash(jakePassword, 10);

  const jakeId = '11111111-1111-4111-8111-111111111111';

  // Register OAuth clients for CLI and Electron login
  // Explicitly null out deleted_at, client_secret_hash, client_uri, logo_uri
  // to prevent Snaplet from auto-generating random values that break things
  // (e.g. a non-null deleted_at soft-deletes the client).
  await seed.oauth_clients([
    {
      id: '577e4468-a806-489e-8b99-206471e7442c',
      client_name: 'Overlord CLI',
      client_type: 'public',
      registration_type: 'manual',
      redirect_uris: 'http://127.0.0.1:45619/callback',
      grant_types: 'authorization_code',
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
      client_uri: null,
      logo_uri: null,
      deleted_at: null
    },
    {
      id: 'f9a4c58c-68c7-4a20-88f9-2a2dc3eed88e',
      client_name: 'Overlord Electron',
      client_type: 'public',
      registration_type: 'manual',
      redirect_uris: 'http://127.0.0.1:45620/callback',
      grant_types: 'authorization_code',
      token_endpoint_auth_method: 'none',
      client_secret_hash: null,
      client_uri: null,
      logo_uri: null,
      deleted_at: null
    }
  ]);

  // Insert Jake; trigger creates org 1 for first user
  await seed.users([
    {
      instance_id: '00000000-0000-0000-0000-000000000000',
      id: jakeId,
      email: 'jake@c.com',
      encrypted_password: jakeHashedPassword,
      role: 'authenticated',
      aud: 'authenticated',
      is_super_admin: false,
      raw_app_meta_data: { provider: 'email', providers: ['email'] },
      raw_user_meta_data: {
        name: 'Jake',
        email: 'jake@c.com',
        username: 'jchaselubitz'
      }
    }
  ]);

  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
