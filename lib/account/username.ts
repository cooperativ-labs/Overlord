export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'me',
  'null',
  'overlord',
  'profile',
  'root',
  'settings',
  'support',
  'system',
  'undefined',
  'user',
  'users'
]);

export function validateUsername(input: string): { username?: string; error?: string } {
  const normalized = input.trim().toLowerCase();
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) {
    return {
      error: `Username must be between ${USERNAME_MIN_LENGTH} and ${USERNAME_MAX_LENGTH} characters.`
    };
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      error:
        'Username may only contain lowercase letters, numbers, dots, hyphens, and underscores, and must start and end with a letter or number.'
    };
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    return { error: 'That username is reserved. Please choose another.' };
  }
  return { username: normalized };
}
