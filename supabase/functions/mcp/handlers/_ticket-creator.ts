// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

import { type TokenContext } from '../auth.ts';

/**
 * Resolve the ticket creator from MCP auth context.
 *
 * This keeps ticket creation tied to the authenticated caller rather than any
 * tool-provided field.
 */
export async function resolveTicketCreatorUserId(
  supabase: SupabaseClient,
  ctx: TokenContext
): Promise<string> {
  const directUserId = ctx.userId?.trim();
  if (directUserId) return directUserId;

  const {
    data: { user },
    error
  } = await supabase.auth.getUser(ctx.tokenValue);

  if (error) {
    throw new Error(error.message);
  }

  if (user?.id) return user.id;

  throw new Error('Unable to resolve ticket creator from the current bearer token.');
}
