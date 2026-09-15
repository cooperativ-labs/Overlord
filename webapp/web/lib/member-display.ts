import type { WorkspaceMemberDto } from '../../shared/contract.ts';

/**
 * Returns the consistent display label for a workspace member across webapp
 * surfaces. Handles are useful identity when a display name has not been set.
 */
export function memberLabel(member: WorkspaceMemberDto): string {
  return member.displayName?.trim() || member.handle || member.email || 'Member';
}

export function memberInitials(member: WorkspaceMemberDto): string {
  return memberLabel(member).slice(0, 2).toUpperCase();
}
