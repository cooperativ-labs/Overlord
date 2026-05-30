'use client';

import { Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import {
  createUserAgentTokenAction,
  listUserAgentTokensAction,
  revokeUserAgentTokenAction,
  type UserAgentTokenInfo
} from '@/lib/actions/user-agent-tokens';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const createTokenWithRetry = withElectronActionRetry(createUserAgentTokenAction);
const listTokensWithRetry = withElectronActionRetry(listUserAgentTokensAction);
const revokeTokenWithRetry = withElectronActionRetry(revokeUserAgentTokenAction);

export function AgentTokensPage({ open }: { open: boolean }) {
  const [newTokenCopied, setNewTokenCopied] = useState(false);
  const [cliSnippetCopied, setCliSnippetCopied] = useState(false);

  const [tokens, setTokens] = useState<UserAgentTokenInfo[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [createState, setCreateState] = useState<ButtonLoadingState>('default');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const cliSnippet = newToken
    ? `ovld auth login --token ${newToken}`
    : `ovld auth login --token <paste token>`;

  useEffect(() => {
    if (!open) return;
    setNewToken(null);
    setMessage(null);
    void listTokensWithRetry().then(setTokens);
  }, [open]);

  async function handleCopy(value: string, setCopied: (v: boolean) => void) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCreateToken() {
    if (!newLabel.trim()) {
      setMessage('Enter a label for the token (e.g. "Claude Cloud", "Production").');
      setCreateState('error');
      return;
    }
    setCreateState('loading');
    setMessage(null);
    try {
      const result = await createTokenWithRetry(newLabel);
      setTokens(prev => [result.info, ...prev]);
      setNewToken(result.token);
      setNewLabel('');
      setCreateState('success');
      setMessage('Token created. Copy it now — it will not be shown again.');
    } catch (error) {
      setCreateState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to create token.');
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id);
    setMessage(null);
    try {
      await revokeTokenWithRetry(id);
      setTokens(prev => prev.filter(t => t.id !== id));
      setMessage('Token revoked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to revoke token.');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Agent tokens</p>
        <p className="text-xs text-muted-foreground">
          Agent tokens authenticate agents and the Overlord CLI on your behalf. Use them to keep the
          CLI logged in when it runs separately from Overlord Desktop, or to connect cloud agents
          over MCP.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-foreground">Create a new token</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Claude Cloud, Production)"
            maxLength={80}
            className="text-xs"
          />
          <LoadingButton
            buttonState={createState}
            setButtonState={setCreateState}
            text="Create token"
            loadingText="Creating…"
            successText="Created"
            errorText="Retry"
            reset
            variant="outline"
            onClick={handleCreateToken}
          />
        </div>
      </div>

      {newToken ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Your new token</p>
            <button
              type="button"
              onClick={() => void handleCopy(newToken, setNewTokenCopied)}
              className="shrink-0 rounded p-1 hover:bg-muted"
              title="Copy token"
            >
              {newTokenCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
            {newToken}
          </pre>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Copy this token now. It will not be shown again.
          </p>
        </div>
      ) : null}

      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-foreground">Use for CLI</p>
          <button
            type="button"
            onClick={() => void handleCopy(cliSnippet, setCliSnippetCopied)}
            className="shrink-0 rounded p-1 hover:bg-muted"
            title="Copy CLI command"
          >
            {cliSnippetCopied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
          {cliSnippet}
        </pre>
        <p className="text-[11px] text-muted-foreground">
          Persists the token so the CLI stays authenticated without Overlord Desktop or env vars.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-xs font-medium text-foreground">Your tokens</p>
        {tokens.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            No tokens yet. Create one above.
          </p>
        ) : (
          <ul className="divide-y rounded-md border bg-muted/20">
            {tokens.map(token => (
              <li key={token.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{token.label}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {token.tokenPrefix}
                    <span className="opacity-50">•••••••••••••••••••</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Created {new Date(token.createdAt).toLocaleDateString()}
                    {token.lastUsedAt
                      ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                      : ' · Never used'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRevoke(token.id)}
                  disabled={revokingId === token.id}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                  title="Revoke token"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
