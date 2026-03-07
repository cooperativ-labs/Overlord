/**
 * Single source of truth for the Electron runtime env allowlist.
 * Used by electron-build.mjs, embed-prod-env.mjs, and check-electron-runtime-env.mjs.
 */
export const RUNTIME_ENV_ALLOWLIST = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
  'NEXT_PUBLIC_OVERLORD_MCP_URL',
  'SUPABASE_OAUTH_CLI_REDIRECT_URI',
  'SUPABASE_OAUTH_ELECTRON_REDIRECT_URI',
  'SUPABASE_OAUTH_CLI_CLIENT_ID',
  'SUPABASE_OAUTH_ELECTRON_CLIENT_ID',
  'OVERLORD_TIMEOUT'
];

export function pickRuntimeEnv(envVars) {
  return Object.fromEntries(
    Object.entries(envVars).filter(([key, value]) => RUNTIME_ENV_ALLOWLIST.includes(key) && value)
  );
}
