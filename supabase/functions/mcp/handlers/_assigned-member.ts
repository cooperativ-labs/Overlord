// deno-lint-ignore-file no-explicit-any
import { type SupabaseClient } from '@supabase/supabase-js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResolveAssignedMemberResult =
  | { ok: true; memberId: string | null }
  | { ok: false; error: string };

/**
 * Resolve an `assignedTo` input to a member `user_id`, scoped to `organizationId`.
 * Mirrors lib/overlord/resolve-assigned-member.ts for the hosted MCP edge
 * function. Accepts `orgid:username`, a raw user-id UUID, an email, or a bare
 * username. Returns `{ ok: true, memberId: null }` when absent so the DB trigger
 * defaults the assignee to the creator. Must run with a service-role client.
 */
export async function resolveAssignedMember(
  supabase: SupabaseClient,
  organizationId: number,
  assignedTo: string | null | undefined
): Promise<ResolveAssignedMemberResult> {
  const raw = typeof assignedTo === 'string' ? assignedTo.trim() : '';
  if (!raw) {
    return { ok: true, memberId: null };
  }

  let handle = raw;

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
    resolvedUserId = (data as { id?: string } | null)?.id ?? null;
  } else {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', handle)
      .limit(1)
      .maybeSingle();
    resolvedUserId = (data as { id?: string } | null)?.id ?? null;
  }

  if (!resolvedUserId) {
    return { ok: false, error: `Cannot assign ticket: no user found for "${raw}".` };
  }

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

  return { ok: true, memberId: (member as { id: string }).id };
}
