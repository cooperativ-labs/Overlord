'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { leaveOrganizationAction, setSelectedOrgAction } from '@/lib/actions/organizations';

type DangerZonePageProps = {
  organizationId: number;
  organizationName: string;
  onOpenChange: (open: boolean) => void;
};

export function DangerZonePage({
  organizationId,
  organizationName,
  onOpenChange
}: DangerZonePageProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [leaveState, setLeaveState] = useState<ButtonLoadingState>('default');
  const [error, setError] = useState<string | null>(null);

  async function handleLeave() {
    setLeaveState('loading');
    setError(null);
    try {
      await leaveOrganizationAction(organizationId);
      await setSelectedOrgAction(null);
      setLeaveState('success');
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setLeaveState('error');
      setError(err instanceof Error ? err.message : 'Failed to leave organization.');
    }
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Leave organization</h3>
          <p className="text-sm text-muted-foreground">
            You will lose access to all projects and tickets in <strong>{organizationName}</strong>.
            An admin can re-invite you later.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit gap-1.5 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => setConfirmOpen(true)}
          >
            <LogOut className="h-3.5 w-3.5" />
            Leave organization
          </Button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Delete organization</h3>
          <p className="text-xs text-muted-foreground">
            Deleting an organization is not yet supported from the UI. Reach out to support if you
            need to remove an organization.
          </p>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave organization?</AlertDialogTitle>
            <AlertDialogDescription>
              You will be removed from <strong>{organizationName}</strong> and lose access to all
              its projects and tickets. This action cannot be undone by you alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveState === 'loading'}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={leaveState === 'loading'}
              onClick={handleLeave}
            >
              {leaveState === 'loading' ? 'Leaving…' : 'Leave organization'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
