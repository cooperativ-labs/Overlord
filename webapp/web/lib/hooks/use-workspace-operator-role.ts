import type { WorkspaceMemberDto } from '@overlord/contract';

import { useWorkspaceMembers } from '@/lib/queries';

/** Finds the signed-in operator's membership row and whether it holds workspace ADMIN. */
export function resolveWorkspaceOperatorRole(members: readonly WorkspaceMemberDto[] | undefined) {
  const operator = (members ?? []).find(member => member.isOperator);
  return { operator, isAdmin: operator?.isAdmin ?? false };
}

/**
 * Single owner of the "is the operator an admin of this workspace" rule used by
 * workspace settings pages. `members` is the underlying query for loading/error UI.
 */
export function useWorkspaceOperatorRole(workspaceId: string | null) {
  const members = useWorkspaceMembers(workspaceId);
  return { members, ...resolveWorkspaceOperatorRole(members.data) };
}
