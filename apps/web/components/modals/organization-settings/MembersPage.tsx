'use client';

import { Loader2, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { InviteUserModal } from '@/components/modals/InviteUserModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { OrganizationInvitation } from '@/lib/actions/invitations';
import {
  cancelInvitationAction,
  getOrganizationInvitationsAction,
  resendInvitationAction
} from '@/lib/actions/invitations';
import type { OrganizationMember } from '@/lib/actions/organizations';
import {
  getOrganizationMembersAction,
  removeMemberAction,
  updateMemberRoleAction
} from '@/lib/actions/organizations';
import type { OrganizationRole } from '@/lib/organization-roles';
import { ORGANIZATION_ROLE_ORDER } from '@/lib/organization-roles';

const ROLE_LABELS: Record<OrganizationRole, string> = {
  VIEWER: 'Viewer',
  AGENT: 'Agent',
  MANAGER: 'Manager',
  ADMIN: 'Admin'
};

type MembersPageProps = {
  open: boolean;
  organizationId: number;
};

export function MembersPage({ open, organizationId }: MembersPageProps) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [updatingRoleFor, setUpdatingRoleFor] = useState<string | null>(null);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [cancellingInvite, setCancellingInvite] = useState<string | null>(null);
  const [resendingInvite, setResendingInvite] = useState<string | null>(null);

  const currentUser = members.find(m => m.isCurrentUser);
  const currentUserRole = currentUser?.role ?? null;
  const canManage = currentUserRole === 'ADMIN' || currentUserRole === 'MANAGER';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [membersData, invitationsData] = await Promise.all([
        getOrganizationMembersAction(organizationId),
        getOrganizationInvitationsAction(organizationId)
      ]);
      setMembers(membersData);
      setInvitations(invitationsData.filter(i => i.status === 'pending'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open, organizationId, loadData]);

  async function handleRoleChange(userId: string, newRole: OrganizationRole) {
    setUpdatingRoleFor(userId);
    const result = await updateMemberRoleAction(organizationId, userId, newRole);
    setUpdatingRoleFor(null);
    if (result.error) {
      setError(result.error);
    } else {
      setMembers(prev => prev.map(m => (m.userId === userId ? { ...m, role: newRole } : m)));
    }
  }

  async function handleRemoveMember(userId: string) {
    setRemovingMember(userId);
    const result = await removeMemberAction(organizationId, userId);
    setRemovingMember(null);
    if (result.error) {
      setError(result.error);
    } else {
      setMembers(prev => prev.filter(m => m.userId !== userId));
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    setCancellingInvite(invitationId);
    const result = await cancelInvitationAction(invitationId);
    setCancellingInvite(null);
    if (result.error) {
      setError(result.error);
    } else {
      setInvitations(prev => prev.filter(i => i.id !== invitationId));
    }
  }

  async function handleResendInvitation(invitationId: string) {
    setResendingInvite(invitationId);
    const result = await resendInvitationAction(invitationId);
    setResendingInvite(null);
    if (result.error) setError(result.error);
  }

  const adminCount = members.filter(m => m.role === 'ADMIN').length;

  return (
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Members</h3>
          <p className="text-xs text-muted-foreground">People with access to this organization.</p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => setInviteModalOpen(true)}>
            Invite member
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Loading…
        </div>
      ) : null}

      {/* Pending invitations */}
      {!loading && invitations.length > 0 ? (
        <div className="grid gap-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Pending invitations
          </h4>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-left font-medium">Sent</th>
                  {canManage ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {invitations.map(inv => (
                  <tr key={inv.id} className="border-t">
                    <td className="px-3 py-2 text-sm">{inv.email}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">
                        {inv.role}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(inv.createdAt).toLocaleDateString()}
                    </td>
                    {canManage ? (
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Resend invitation"
                            disabled={resendingInvite === inv.id}
                            onClick={() => handleResendInvitation(inv.id)}
                          >
                            {resendingInvite === inv.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Cancel invitation"
                            disabled={cancellingInvite === inv.id}
                            onClick={() => handleCancelInvitation(inv.id)}
                          >
                            {cancellingInvite === inv.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <X className="size-3" />
                            )}
                          </Button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Active members */}
      {!loading && members.length > 0 ? (
        <div className="grid gap-2">
          {invitations.length > 0 ? (
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Active members
            </h4>
          ) : null}
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Member</th>
                  <th className="px-3 py-2 text-left font-medium">Role</th>
                  <th className="px-3 py-2 text-left font-medium">Joined</th>
                  {canManage ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {members.map(member => {
                  const memberLevel = ORGANIZATION_ROLE_ORDER.indexOf(member.role);
                  const callerLevel = ORGANIZATION_ROLE_ORDER.indexOf(currentUserRole ?? 'VIEWER');
                  const canEditThisMember =
                    canManage && !member.isCurrentUser && memberLevel <= callerLevel;
                  const isLastAdmin = member.role === 'ADMIN' && adminCount <= 1;

                  return (
                    <tr key={member.userId} className="border-t">
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="text-sm">
                            {member.displayName || member.email || member.userId.slice(0, 8)}
                            {member.isCurrentUser ? (
                              <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                            ) : null}
                          </span>
                          {member.email && member.displayName ? (
                            <span className="text-xs text-muted-foreground">{member.email}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {canEditThisMember ? (
                          <div className="relative flex items-center gap-1">
                            <Select
                              value={member.role}
                              onValueChange={v =>
                                handleRoleChange(member.userId, v as OrganizationRole)
                              }
                              disabled={updatingRoleFor === member.userId}
                            >
                              <SelectTrigger className="h-7 w-28 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ORGANIZATION_ROLE_ORDER.filter(
                                  r => ORGANIZATION_ROLE_ORDER.indexOf(r) <= callerLevel
                                ).map(r => (
                                  <SelectItem key={r} value={r} className="text-xs">
                                    {ROLE_LABELS[r]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {updatingRoleFor === member.userId ? (
                              <Loader2 className="size-3 animate-spin text-muted-foreground" />
                            ) : null}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {member.role}
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(member.joinedAt).toLocaleDateString()}
                      </td>
                      {canManage ? (
                        <td className="px-3 py-2 text-right">
                          {canEditThisMember && !isLastAdmin ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="size-7">
                                  {removingMember === member.userId ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <MoreHorizontal className="size-3" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  disabled={removingMember === member.userId}
                                  onClick={() => handleRemoveMember(member.userId)}
                                >
                                  Remove from organization
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <div className="size-7" />
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!loading && !error && members.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members found.</p>
      ) : null}

      {canManage && currentUserRole ? (
        <InviteUserModal
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          organizationId={organizationId}
          callerRole={currentUserRole}
          onInvited={loadData}
        />
      ) : null}
    </div>
  );
}
