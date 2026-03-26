'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { disconnectIdentityAction } from '@/lib/actions/account';

const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email / Password',
  github: 'GitHub',
  google: 'Google',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  slack: 'Slack',
  discord: 'Discord',
  twitter: 'Twitter / X',
  azure: 'Microsoft Azure',
  facebook: 'Facebook'
};

type DisconnectIdentityButtonProps = {
  identityId: string;
  provider: string;
  onDisconnected?: () => void | Promise<void>;
};

export function DisconnectIdentityButton({
  identityId,
  provider,
  onDisconnected
}: DisconnectIdentityButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleDisconnect = async () => {
    setIsPending(true);
    setErrorMessage(null);

    try {
      const result = await disconnectIdentityAction(identityId);

      if (result.error) {
        setErrorMessage(result.error);
        return;
      }

      await onDisconnected?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to disconnect account.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void handleDisconnect()}
        disabled={isPending}
      >
        {isPending ? 'Disconnecting...' : `Disconnect ${PROVIDER_LABELS[provider] ?? provider}`}
      </Button>
      {errorMessage ? (
        <p className="max-w-48 text-right text-xs text-destructive">{errorMessage}</p>
      ) : null}
    </div>
  );
}
