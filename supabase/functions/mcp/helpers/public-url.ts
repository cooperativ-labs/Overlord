export function getPublicMcpUrl(env: {
  NEXT_PUBLIC_SITE_URL?: string | null;
  OVERLORD_URL?: string | null;
  SUPABASE_URL?: string | null;
}): string {
  const platformUrl = env.OVERLORD_URL?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim();
  if (platformUrl) {
    return new URL('/api/mcp', platformUrl).toString();
  }

  const supabaseUrl = env.SUPABASE_URL?.trim();
  if (supabaseUrl) {
    return new URL('/functions/v1/mcp', supabaseUrl).toString();
  }

  return '/api/mcp';
}
