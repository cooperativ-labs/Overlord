'use client';

import { useState } from 'react';

import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { type AgentTokenListItem, revokeAgentTokenAction } from '@/lib/actions/agent-tokens';

type AgentTokenListProps = {
  initialTokens: AgentTokenListItem[];
};

function formatDateTime(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export function AgentTokenList({ initialTokens }: AgentTokenListProps) {
  const [tokens, setTokens] = useState(initialTokens);
  const [revokeStates, setRevokeStates] = useState<Record<string, ButtonLoadingState>>({});

  const setTokenState = (tokenId: string, state: ButtonLoadingState) => {
    setRevokeStates(prev => ({ ...prev, [tokenId]: state }));
  };

  const handleRevoke = async (tokenId: string) => {
    setTokenState(tokenId, 'loading');

    try {
      await revokeAgentTokenAction(tokenId);
      setTokenState(tokenId, 'success');
      setTokens(prev => prev.filter(token => token.id !== tokenId));
    } catch {
      setTokenState(tokenId, 'error');
    }
  };

  if (tokens.length === 0) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No active agent tokens found.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 font-medium">Token</th>
            <th className="px-4 py-3 font-medium">Created</th>
            <th className="px-4 py-3 font-medium">Last used</th>
            <th className="px-4 py-3 font-medium">Expires</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map(token => (
            <tr key={token.id} className="border-t">
              <td className="px-4 py-3">{token.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{formatDateTime(token.createdAt)}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatDateTime(token.lastUsedAt)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{formatDateTime(token.expiresAt)}</td>
              <td className="px-4 py-3 text-right">
                <LoadingButton
                  buttonState={revokeStates[token.id] ?? 'default'}
                  setButtonState={state => setTokenState(token.id, state)}
                  text="Revoke"
                  loadingText="Revoking..."
                  successText="Revoked"
                  errorText="Retry"
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRevoke(token.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
