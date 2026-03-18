'use client';

import { useCallback, useEffect, useState } from 'react';

import { AgentTokenList } from '@/components/features/account/agent-token-list';
import { Button } from '@/components/ui/button';
import { type AgentTokenListItem, getActiveAgentTokensAction } from '@/lib/actions/agent-tokens';

type UserTokensPageProps = {
  open: boolean;
};

export function UserTokensPage({ open }: UserTokensPageProps) {
  const [tokens, setTokens] = useState<AgentTokenListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const loaded = await getActiveAgentTokensAction();
      setTokens(loaded);
    } catch (error) {
      console.error('Failed to load agent tokens:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load agent tokens.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setErrorMessage(null);
      return;
    }

    void loadTokens();
  }, [open, loadTokens]);

  if (isLoading && tokens.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading agent tokens...</p>;
  }

  if (errorMessage && tokens.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <Button variant="outline" onClick={() => void loadTokens()} disabled={isLoading}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Agent tokens</h2>
        <p className="text-muted-foreground text-sm">
          Active CLI and desktop tokens for this account. Revoked tokens lose API access
          immediately.
        </p>
      </div>
      <AgentTokenList initialTokens={tokens} />
    </div>
  );
}
