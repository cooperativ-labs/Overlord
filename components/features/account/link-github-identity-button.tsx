'use client';

import { Github } from 'lucide-react';
import * as React from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { linkGithubIdentityAction } from '@/lib/actions/account';

type LinkGithubIdentityButtonProps = {
  className?: string;
};

export function LinkGithubIdentityButton({ className }: LinkGithubIdentityButtonProps) {
  const [buttonState, setButtonState] = React.useState<ButtonLoadingState>('default');
  const [error, setError] = React.useState<string | null>(null);

  const handleConnect = async () => {
    setButtonState('loading');
    setError(null);

    try {
      const result = await linkGithubIdentityAction();

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
      setError('Failed to start GitHub linking.');
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
            <Github className="size-4" />
            Connect GitHub
          </span>
        }
        loadingText="Connecting..."
        successText="GitHub connected"
        errorText="Connect GitHub failed"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        You need to be signed in to link GitHub to this account.
      </p>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
