type OAuthRuntimeConfig = {
  cliClientId: string | null;
  electronClientId: string | null;
  deviceClientId: string | null;
  cliRedirectUri: string | null;
  electronRedirectUri: string | null;
  allowedClientIds: string[];
};

function readFirstDefinedEnv(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function dedupe(values: readonly (string | null)[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    seen.add(value);
  }
  return [...seen];
}

/**
 * Resolves OAuth runtime settings with backward-compatible env keys.
 * Legacy single-client env vars are supported for hosted deployments that
 * haven't migrated to split CLI/Electron variables yet.
 */
export function getOAuthRuntimeConfig(): OAuthRuntimeConfig {
  const cliClientId = readFirstDefinedEnv([
    'SUPABASE_OAUTH_CLI_CLIENT_ID',
    'SUPABASE_OAUTH_CLIENT_ID',
    'NEXT_PUBLIC_SUPABASE_OAUTH_CLI_CLIENT_ID',
    'NEXT_PUBLIC_SUPABASE_OAUTH_CLIENT_ID'
  ]);
  const electronClientId = readFirstDefinedEnv([
    'SUPABASE_OAUTH_ELECTRON_CLIENT_ID',
    'SUPABASE_OAUTH_CLIENT_ID',
    'NEXT_PUBLIC_SUPABASE_OAUTH_ELECTRON_CLIENT_ID',
    'NEXT_PUBLIC_SUPABASE_OAUTH_CLIENT_ID'
  ]);
  const deviceClientId = readFirstDefinedEnv([
    'SUPABASE_OAUTH_DEVICE_CLIENT_ID',
    'NEXT_PUBLIC_SUPABASE_OAUTH_DEVICE_CLIENT_ID'
  ]);
  const cliRedirectUri = readFirstDefinedEnv([
    'SUPABASE_OAUTH_CLI_REDIRECT_URI',
    'SUPABASE_OAUTH_REDIRECT_URI',
    'NEXT_PUBLIC_SUPABASE_OAUTH_CLI_REDIRECT_URI',
    'NEXT_PUBLIC_SUPABASE_OAUTH_REDIRECT_URI'
  ]);
  const electronRedirectUri = readFirstDefinedEnv([
    'SUPABASE_OAUTH_ELECTRON_REDIRECT_URI',
    'SUPABASE_OAUTH_REDIRECT_URI',
    'NEXT_PUBLIC_SUPABASE_OAUTH_ELECTRON_REDIRECT_URI',
    'NEXT_PUBLIC_SUPABASE_OAUTH_REDIRECT_URI'
  ]);

  return {
    cliClientId,
    electronClientId,
    deviceClientId,
    cliRedirectUri,
    electronRedirectUri,
    allowedClientIds: dedupe([cliClientId, electronClientId, deviceClientId])
  };
}
