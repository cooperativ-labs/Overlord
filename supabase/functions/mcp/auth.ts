// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export type TokenContext = {
  userId: string;
  organizationId: number;
  tokenId: string;
  tokenValue: string;
};

export async function resolveToken(
  req: Request,
  supabase: SupabaseClient
): Promise<TokenContext | null> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const { data } = await supabase
    .from('agent_tokens')
    .select('id, user_id, organization_id, token, revoked_at, expires_at')
    .eq('token', token)
    .single();

  if (!data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Fire-and-forget last_used_at
  supabase
    .from('agent_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    userId: data.user_id,
    organizationId: data.organization_id,
    tokenId: data.id,
    tokenValue: token
  };
}
