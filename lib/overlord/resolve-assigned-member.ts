import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database.types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveAssignedMemberResult =
  | { ok: true; memberId: string | null }
  | { ok: false; error: string };

/**
 * Resolve an `--assigned-to` input to a member `user_id`, scoped to the target
 * ticket's organization. Accepts any of:
 *   - `[orgid]:[username]` (the human-readable member ID) — the prefix is
 *     validated against `organizationId` and then stripped,
 *   - a raw `user_id` UUID,
 *   - an email (`profiles.email`),
 *   - a bare `username` (`profiles.username`, case-insensitive).
 *
 * Returns `{ ok: true, memberId: null }` when `assignedTo` is absent so the DB
 * trigger can default the assignee to the creator. On an unresolvable handle or
 * a resolved user who is not a member of the org, returns `{ ok: false }` with a
 * readable message. Must be called with a service-role client (it reads other
 * users' profiles, which RLS otherwise hides).
 */
export async function resolveAssignedMember(
  supabase: SupabaseClient<Database>,
  organizationId: number,
  assignedTo: string | null | undefined
): Promise<ResolveAssignedMemberResult> {
  const raw = typeof assignedTo === 'string' ? assignedTo.trim() : '';
  if (!raw) {
    return { ok: true, memberId: null };
  }

  let handle = raw;

  // [orgid]:[username] — validate the org prefix, then strip it.
  const prefixMatch = handle.match(/^(\d+):(.+)$/);
  if (prefixMatch) {
    const prefixOrgId = Number(prefixMatch[1]);
    if (prefixOrgId !== organizationId) {
      return {
        ok: false,
        error: `Cannot assign ticket: "${raw}" belongs to a different organization.`
      };
    }
    handle = prefixMatch[2].trim();
  }

  let resolvedUserId: string | null;

  if (UUID_RE.test(handle)) {
    resolvedUserId = handle;
  } else if (handle.includes('@')) {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .ilike('email', handle)
      .limit(1)
      .maybeSingle();
    resolvedUserId = data?.id ?? null;
  } else {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', handle)
      .limit(1)
      .maybeSingle();
    resolvedUserId = data?.id ?? null;
  }

  if (!resolvedUserId) {
    return { ok: false, error: `Cannot assign ticket: no user found for "${raw}".` };
  }

  // Verify the resolved user is a member of the target org and return the
  // canonical member identifier stored by tickets.assigned_member.
  const { data: member, error: memberError } = await supabase
    .from('members')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', resolvedUserId)
    .maybeSingle();

  if (memberError) {
    return { ok: false, error: memberError.message };
  }
  if (!member) {
    return {
      ok: false,
      error: `Cannot assign ticket: "${raw}" is not a member of this organization.`
    };
  }

  return { ok: true, memberId: member.id };
}
