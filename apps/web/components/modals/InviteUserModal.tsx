'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { inviteUserToOrganizationAction } from '@/lib/actions/invitations';
import { ORGANIZATION_ROLE_ORDER, type OrganizationRole } from '@/lib/organization-roles';

const ROLES: { value: OrganizationRole; label: string; description: string }[] = [
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Can view tickets, feed, and project activity.'
  },
  { value: 'AGENT', label: 'Agent', description: 'Can create and run agent sessions.' },
  {
    value: 'MANAGER',
    label: 'Manager',
    description: 'Can manage projects, members, and agent sessions.'
  },
  {
    value: 'ADMIN',
    label: 'Admin',
    description: 'Full access including org settings and member management.'
  }
];

type InviteUserModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: number;
  callerRole: OrganizationRole;
  onInvited?: () => void;
};

export function InviteUserModal({
  open,
  onOpenChange,
  organizationId,
  callerRole,
  onInvited
}: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('VIEWER');
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Restrict role options to caller's role ceiling
  const callerLevel = ORGANIZATION_ROLE_ORDER.indexOf(callerRole);
  const availableRoles = ROLES.filter(r => ORGANIZATION_ROLE_ORDER.indexOf(r.value) <= callerLevel);

  function handleClose() {
    setEmail('');
    setRole('VIEWER');
    setButtonState('default');
    setError(null);
    setSuccess(false);
    onOpenChange(false);
  }

  async function handleInvite() {
    setError(null);
    setButtonState('loading');

    const result = await inviteUserToOrganizationAction(organizationId, email.trim(), role);

    if (result.error) {
      setError(result.error);
      setButtonState('error');
      return;
    }

    setButtonState('success');
    setSuccess(true);
    onInvited?.();
    setTimeout(() => handleClose(), 1200);
  }

  const selectedRoleInfo = ROLES.find(r => r.value === role);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            Send an email invitation to add someone to this organization.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="py-4 text-center">
            <p className="text-sm text-muted-foreground">Invitation sent to {email}.</p>
          </div>
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={email}
                onChange={e => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                autoFocus
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <Select value={role} onValueChange={v => setRole(v as OrganizationRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedRoleInfo ? (
                <p className="text-xs text-muted-foreground mt-1">{selectedRoleInfo.description}</p>
              ) : null}
            </Field>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <LoadingButton
                type="button"
                buttonState={buttonState}
                setButtonState={setButtonState}
                onClick={handleInvite}
                text="Send invitation"
                loadingText="Sending..."
                successText="Sent"
                errorText="Try again"
                disabled={!email.trim()}
              />
            </div>
          </FieldGroup>
        )}
      </DialogContent>
    </Dialog>
  );
}
