'use client';

import { useCallback, useEffect, useState } from 'react';

import { SessionsList } from '@/components/features/account/sessions-list';
import { Button } from '@/components/ui/button';
import { getProfileDataAction, type OAuthIdentity } from '@/lib/actions/account';

type UserSessionsPageProps = {
  open: boolean;
};

export function UserSessionsPage({ open }: UserSessionsPageProps) {
  const [identities, setIdentities] = useState<OAuthIdentity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const profile = await getProfileDataAction();
      setIdentities(profile.identities);
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

    void loadSessions();
  }, [open, loadSessions]);

  if (isLoading && identities.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading linked accounts...</p>;
  }

  if (errorMessage && identities.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <Button variant="outline" onClick={() => void loadSessions()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Linked accounts</h2>
        <p className="text-muted-foreground text-sm">
          OAuth providers and login methods connected to your account. Disconnect linked OAuth
          accounts here, or add another login method first if this is your only sign-in option.
        </p>
      </div>
      <SessionsList identities={identities} onDisconnected={loadSessions} />
    </div>
  );
}
