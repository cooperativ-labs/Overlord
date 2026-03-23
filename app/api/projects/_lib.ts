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
