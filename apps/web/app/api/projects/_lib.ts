import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

/**
 * Verify the authenticated user is a member of the given organization.
 * Defense-in-depth check alongside RLS policies.
 */
export async function assertOrgMembership(
  supabase: SupabaseClient<Database>,
  userId: string,
  organizationId: number
): Promise<boolean> {
  const { data } = await supabase
    .from('members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

/**
 * PostgREST builds long `not.in.(uuid,...)` filters on the query string. Thousands of
 * excluded ticket IDs can exceed URL limits and make `/file-changes` fail with 500.
 * Split into chunks; Supabase appends each `.not('ticket_id','in',...)` as its own
 * param and PostgREST ANDs them — equivalent to one large NOT IN across the union.
 */
const POSTGREST_NOT_IN_UUID_CHUNK_SIZE = 75;

export function chunkUuidListForPostgrestNotIn(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += POSTGREST_NOT_IN_UUID_CHUNK_SIZE) {
    out.push(ids.slice(i, i + POSTGREST_NOT_IN_UUID_CHUNK_SIZE));
  }
  return out;
}
