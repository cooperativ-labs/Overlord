// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';

/**
 * Resolve the ticket creator from MCP auth context.
 *
 * This keeps ticket creation tied to the authenticated caller rather than any
 * tool-provided field. Legacy agent tokens resolve via the token row; OAuth JWT
 * sessions can fall back to Supabase auth user lookup.
 */
export async function resolveTicketCreatorUserId(
  supabase: SupabaseClient,
  ctx: TokenContext
): Promise<string> {
  const directUserId = ctx.userId?.trim();
  if (directUserId) return directUserId;

  if (ctx.authMethod === 'agent_token') {
    const { data, error } = await supabase
      .from('agent_tokens')
      .select('user_id')
      .eq('token', ctx.tokenValue)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data?.user_id) return data.user_id;
  }

  if (ctx.authMethod === 'oauth_jwt') {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser(ctx.tokenValue);

    if (error) {
      throw new Error(error.message);
    }

    if (user?.id) return user.id;
  }

  throw new Error('Unable to resolve ticket creator from the current bearer token.');
}
