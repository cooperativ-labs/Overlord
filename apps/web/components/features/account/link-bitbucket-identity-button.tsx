'use client';

import * as React from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { linkBitbucketIdentityAction } from '@/lib/actions/account';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

import { BitbucketIcon } from '../../brand-icons/bitbucket-icon';

const linkBitbucketIdentityActionWithRetry = withElectronActionRetry(linkBitbucketIdentityAction);

type LinkBitbucketIdentityButtonProps = {
  className?: string;
};

export function LinkBitbucketIdentityButton({ className }: LinkBitbucketIdentityButtonProps) {
  const [buttonState, setButtonState] = React.useState<ButtonLoadingState>('default');
  const [error, setError] = React.useState<string | null>(null);

  const handleConnect = async () => {
    setButtonState('loading');
    setError(null);

    try {
      const result = await linkBitbucketIdentityActionWithRetry();

      if (result.error) {
        setButtonState('error');
        setError(result.error);
        return;
      }

      if (result.url) {
        setButtonState('success');
        globalThis.location.assign(result.url);
      }
    } catch {
      setButtonState('error');
      setError('Failed to start Bitbucket linking.');
    }
  };

  return (
    <div className={className}>
      <LoadingButton
        type="button"
        variant="outline"
        buttonState={buttonState}
        setButtonState={setButtonState}
        onClick={handleConnect}
        text={
          <span className="flex items-center justify-center gap-2">
            <BitbucketIcon className="size-4" />
            Connect Bitbucket
          </span>
        }
        loadingText="Connecting..."
        successText="Bitbucket connected"
        errorText="Connect Bitbucket failed"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        You need to be signed in to link Bitbucket to this account.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
