'use client';

import { useCallback, useEffect, useState } from 'react';

import { LinkBitbucketIdentityButton } from '@/components/features/account/link-bitbucket-identity-button';
import { LinkGithubIdentityButton } from '@/components/features/account/link-github-identity-button';
import { SessionsList } from '@/components/features/account/sessions-list';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getProfileDataAction, type ProfileData } from '@/lib/actions/account';

type LinkedAccountsPageProps = {
  open: boolean;
};

export function LinkedAccountsPage({ open }: LinkedAccountsPageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadLinkedAccounts = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loaded = await getProfileDataAction();
      setProfile(loaded);
    } catch (error) {
      console.error('Failed to load linked accounts:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load linked accounts.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setErrorMessage(null);
      return;
    }

    void loadLinkedAccounts();
  }, [open, loadLinkedAccounts]);

  if (isLoading && !profile) {
    return <p className="text-sm text-muted-foreground">Loading linked accounts...</p>;
  }

  if (!profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">
          {errorMessage ?? 'Linked accounts are unavailable right now.'}
        </p>
        <Button variant="outline" onClick={() => void loadLinkedAccounts()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  const hasGithubIdentity = profile.identities.some(identity => identity.provider === 'github');
  const hasBitbucketIdentity = profile.identities.some(
    identity => identity.provider === 'bitbucket'
  );

  return (
    <div className="space-y-6">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Linked accounts</h2>
          <p className="text-muted-foreground text-sm">
            OAuth providers and login methods connected to your account.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          <div>
            <p className="text-sm font-medium">Connect another login method</p>
            <p className="text-sm text-muted-foreground">
              Link GitHub or Bitbucket so you can use multiple sign-in methods with this account.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {hasGithubIdentity ? (
              <p className="text-sm text-muted-foreground">GitHub is already connected.</p>
            ) : (
              <LinkGithubIdentityButton />
            )}

            {hasBitbucketIdentity ? (
              <p className="text-sm text-muted-foreground">Bitbucket is already connected.</p>
            ) : (
              <LinkBitbucketIdentityButton />
            )}
          </div>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Connected identities</h3>
          <p className="text-muted-foreground text-sm">
            Disconnect linked OAuth accounts here, or add another login method first if this is your
            only sign-in option.
          </p>
        </div>
        <SessionsList identities={profile.identities} onDisconnected={loadLinkedAccounts} />
      </div>
    </div>
  );
}
