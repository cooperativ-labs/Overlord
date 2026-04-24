import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type ServiceSupabaseClient = SupabaseClient<Database>;

type TicketCreatorContext = {
  tokenId?: string | null;
  tokenValue?: string | null;
  userId?: string | null;
};

/**
 * Resolve the ticket creator from protocol auth context.
 *
 * The happy path uses the resolved userId from protocol auth. The token lookup
 * fallback keeps ticket creation robust during the agent-token compatibility window.
 */
export async function resolveProtocolTicketCreatorUserId(
  supabase: ServiceSupabaseClient,
  context: TicketCreatorContext
): Promise<string> {
  const directUserId = context.userId?.trim();
  if (directUserId) return directUserId;

  if (context.tokenId?.trim()) {
    const { data, error } = await supabase
      .from('agent_tokens')
      .select('user_id')
      .eq('id', context.tokenId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data?.user_id) return data.user_id;
  }

  const tokenValue = context.tokenValue?.trim();
  if (tokenValue) {
    const { data, error } = await supabase
      .from('agent_tokens')
      .select('user_id')
      .eq('token', tokenValue)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    if (data?.user_id) return data.user_id;
  }

  throw new Error('Unable to resolve ticket creator from the current auth context.');
}
