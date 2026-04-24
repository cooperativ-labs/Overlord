import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

type ServiceSupabaseClient = SupabaseClient<Database>;

type TicketCreatorContext = {
  userId?: string | null;
};

/**
 * Resolve the ticket creator from protocol auth context.
 *
 * The happy path uses the resolved userId from protocol auth.
 */
export async function resolveProtocolTicketCreatorUserId(
  _supabase: ServiceSupabaseClient,
  context: TicketCreatorContext
): Promise<string> {
  const directUserId = context.userId?.trim();
  if (directUserId) return directUserId;

  throw new Error('Unable to resolve ticket creator from the current auth context.');
}
