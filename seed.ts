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
