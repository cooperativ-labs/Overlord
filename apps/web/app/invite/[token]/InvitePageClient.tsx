'use client';

import { GalleryVerticalEnd } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { InvitationWithOrg } from '@/lib/actions/invitations';
import { declineInvitationAction } from '@/lib/actions/invitations';

type User = { email?: string } | null;

type InvitePageClientProps = {
  invitation: InvitationWithOrg | null;
  user: User;
  token: string;
  acceptError?: string;
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  VIEWER: 'Can view tickets, feed, and project activity.',
  AGENT: 'Can create and run agent sessions.',
  MANAGER: 'Can manage projects, members, and agent sessions.',
  ADMIN: 'Full access including org settings and member management.'
};

export function InvitePageClient({ invitation, user, token, acceptError }: InvitePageClientProps) {
  const [declineState, setDeclineState] = useState<ButtonLoadingState>('default');
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | undefined>(acceptError);

  if (!invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <GalleryVerticalEnd className="size-8" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Invitation not found</h1>
          <p className="text-muted-foreground text-sm mb-6">
            This invitation link is invalid or has been removed.
          </p>
          <Button asChild variant="outline">
            <Link href="/">Go to Overlord</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (invitation.status === 'accepted' || declined) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <GalleryVerticalEnd className="size-8" />
          </div>
          <h1 className="text-xl font-semibold mb-2">
            {declined ? 'Invitation declined' : "You're already a member"}
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            {declined
              ? `You've declined the invitation to join ${invitation.organizationName}.`
              : `This invitation to ${invitation.organizationName} has already been accepted.`}
          </p>
          {user ? (
            <Button asChild>
              <Link href="/u">Go to Overlord</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (invitation.status !== 'pending') {
    const statusMessages: Record<string, string> = {
      cancelled: 'This invitation has been cancelled.',
      declined: 'This invitation was declined.',
      expired: 'This invitation has expired. Contact the organization admin to request a new one.'
    };
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <GalleryVerticalEnd className="size-8" />
          </div>
          <h1 className="text-xl font-semibold mb-2">Invitation no longer valid</h1>
          <p className="text-muted-foreground text-sm mb-6">
            {statusMessages[invitation.status] ?? 'This invitation is no longer valid.'}
          </p>
          <Button asChild variant="outline">
            <Link href="/">Go to Overlord</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isExpired = new Date(invitation.expiresAt) < new Date();

  async function handleDecline() {
    setDeclineState('loading');
    setError(undefined);
    const result = await declineInvitationAction(token);
    if (result.error) {
      setError(result.error);
      setDeclineState('error');
    } else {
      setDeclineState('success');
      setDeclined(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" className="flex flex-col items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md">
              <GalleryVerticalEnd className="size-6" />
            </div>
            <span className="sr-only">Overlord</span>
          </Link>
        </div>

        <div className="rounded-lg border p-6 flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold">You've been invited</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {invitation.inviterName ? (
                <>
                  <strong>{invitation.inviterName}</strong> has invited you to join{' '}
                  <strong>{invitation.organizationName}</strong>
                </>
              ) : (
                <>
                  You've been invited to join <strong>{invitation.organizationName}</strong>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Your role:</span>
            <Badge variant="secondary">{invitation.role}</Badge>
          </div>

          <p className="text-xs text-muted-foreground">
            {ROLE_DESCRIPTIONS[invitation.role] ?? ''}
          </p>

          {isExpired ? (
            <Alert variant="destructive">
              <AlertDescription>
                This invitation has expired. Contact the organization admin to request a new one.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {!isExpired && user ? (
            // Branch A: user is logged in — the server already tried auto-accept
            // If we reach here, it means there was an email mismatch error shown above
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">
                You are signed in as <strong>{user.email}</strong>.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href="/u">Go to Overlord</Link>
              </Button>
            </div>
          ) : !isExpired ? (
            // Branch B: not logged in
            <div className="flex flex-col gap-3">
              <Button asChild>
                <Link href={`/login?next=/invite/${token}`}>Sign in and accept</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/signup?invite=${token}`}>Create account and accept</Link>
              </Button>
              <div className="flex justify-center">
                <LoadingButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonState={declineState}
                  setButtonState={setDeclineState}
                  onClick={handleDecline}
                  text="Decline invitation"
                  loadingText="Declining..."
                  errorText="Failed to decline"
                  successText="Declined"
                />
              </div>
            </div>
          ) : null}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Invitation expires {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
