'use client';

import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { getOrganizationMembersAction, type OrganizationMember } from '@/lib/actions/organizations';

type MembersPageProps = {
  open: boolean;
  organizationId: number;
};

export function MembersPage({ open, organizationId }: MembersPageProps) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getOrganizationMembersAction(organizationId)
      .then(setMembers)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load members.'))
      .finally(() => setLoading(false));
  }, [open, organizationId]);

  return (
    <div className="grid gap-4">
      <div>
        <h3 className="text-sm font-medium">Members</h3>
        <p className="text-xs text-muted-foreground">
          People with access to this organization. Invitations and role management are coming soon.
        </p>
      </div>

      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {!loading && !error && members.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members found.</p>
      ) : null}

      {members.length > 0 ? (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Member</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map(member => (
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
                    <Badge variant="secondary" className="text-xs">
                      {member.role}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
