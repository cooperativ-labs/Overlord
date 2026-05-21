'use client';

import { Check, Copy, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Input } from '@/components/ui/input';
import { type ButtonLoadingState, LoadingButton } from '@/components/ui/loading-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import {
  createUserAgentTokenAction,
  listUserAgentTokensAction,
  revokeUserAgentTokenAction,
  type UserAgentTokenInfo
} from '@/lib/actions/user-agent-tokens';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';

const createTokenWithRetry = withElectronActionRetry(createUserAgentTokenAction);
const listTokensWithRetry = withElectronActionRetry(listUserAgentTokensAction);
const revokeTokenWithRetry = withElectronActionRetry(revokeUserAgentTokenAction);
const getRunningAgentSessionsWithRetry = withElectronActionRetry(getRunningAgentSessionsAction);
const stopRunningAgentSessionWithRetry = withElectronActionRetry(stopRunningAgentSessionAction);

export function AgentsAndMcpPage({ open }: { open: boolean }) {
  const { isElectron } = useElectron();

  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);
  const [envBlockCopied, setEnvBlockCopied] = useState(false);
  const [newTokenCopied, setNewTokenCopied] = useState(false);
  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  const [tokens, setTokens] = useState<UserAgentTokenInfo[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [createState, setCreateState] = useState<ButtonLoadingState>('default');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [refreshSessionsState, setRefreshSessionsState] = useState<ButtonLoadingState>('default');
  const [runningSessions, setRunningSessions] = useState<RunningAgentSession[]>([]);
  const [stopSessionStates, setStopSessionStates] = useState<Record<string, ButtonLoadingState>>(
    {}
  );
  const [message, setMessage] = useState<string | null>(null);

  const mcpUrl = getOverlordMcpUrl();
  const resolvedPlatformUrl = getPlatformUrl(platformUrl);

  const resolvedPlatformDomain = (() => {
    try {
      if (process.env.NEXT_ENV === 'development') {
        return new URL(resolvedPlatformUrl).hostname;
      } else {
        return 'ovld.ai';
      }
    } catch {
      return 'ovld.ai';
    }
  })();

  const domainSnippet = Array.from(
    new Set(
      [resolvedPlatformDomain, `*.${resolvedPlatformDomain}`].filter((v): v is string => Boolean(v))
    )
  ).join('\n');

  const envBlock = newToken
    ? `OVERLORD_AGENT_TOKEN=${newToken}\nOVERLORD_MCP_URL=${mcpUrl}`
    : `OVERLORD_AGENT_TOKEN=<paste token>\nOVERLORD_MCP_URL=${mcpUrl}`;

  useEffect(() => {
    if (!open) return;
    if (isElectron && typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
    setNewToken(null);
    setMessage(null);
    void listTokensWithRetry().then(setTokens);
    void loadRunningSessions();
  }, [isElectron, open]);

  async function loadRunningSessions(): Promise<boolean> {
    try {
      const sessions = await getRunningAgentSessionsWithRetry();
      setRunningSessions(sessions);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load live sessions.');
      return false;
    }
  }

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

  async function handleRefreshSessions() {
    setRefreshSessionsState('loading');
    setMessage(null);
    const loaded = await loadRunningSessions();
    if (loaded) {
      setRefreshSessionsState('success');
    } else {
      setRefreshSessionsState('error');
    }
  }

  async function handleStopSession(sessionId: string) {
    setStopSessionStates(previous => ({ ...previous, [sessionId]: 'loading' }));
    setMessage(null);
    try {
      await stopRunningAgentSessionWithRetry(sessionId);
      setRunningSessions(previous => previous.filter(session => session.id !== sessionId));
      setStopSessionStates(previous => ({ ...previous, [sessionId]: 'success' }));
    } catch (error) {
      setStopSessionStates(previous => ({ ...previous, [sessionId]: 'error' }));
      setMessage(error instanceof Error ? error.message : 'Failed to clear the live session.');
    }
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">MCP &amp; cloud agents</p>
        <p className="text-xs text-muted-foreground">
          Agents running in cloud environments communicate with Overlord through MCP. Pick the
          authentication approach that fits your runtime. For local agents, use the Overlord CLI
          instead of configuring MCP directly.
        </p>
      </div>
      <div className="grid gap-4">
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">MCP URL</p>
            <button
              type="button"
              onClick={() => void handleCopy(mcpUrl, setMcpUrlCopied)}
              className="shrink-0 rounded p-1 hover:bg-muted"
              title="Copy MCP URL"
            >
              {mcpUrlCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
            {mcpUrl}
          </pre>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-1">
          <p className="text-sm font-medium">MCP configuration</p>
        </div>
        <Tabs defaultValue="oauth" className="w-full">
          <TabsList>
            <TabsTrigger value="oauth">OAuth Approach</TabsTrigger>
            <TabsTrigger value="agent-token">Agent Token Approach</TabsTrigger>
          </TabsList>

          <TabsContent value="oauth" className="grid gap-3 p-3 rounded-md border">
            <p className="text-xs text-muted-foreground mb-2">
              Best for runtimes that support OAuth (Claude custom connectors, Cursor cloud, etc.).
            </p>
            <ol className="list-decimal space-y-1 pl-4 text-xs">
              <li>Open your agent&apos;s MCP / connector settings and add a new server.</li>
              <li>Paste the MCP URL above as the server URL.</li>
              <li>Start the connector login flow and complete the OAuth consent screen.</li>
              <li>
                If your platform enforces outbound domain allowlists, add the snippet below to the
                allowed domains.
              </li>
            </ol>

            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">Allowed domain</p>
                <button
                  type="button"
                  onClick={() => void handleCopy(domainSnippet, setAgentDomainSnippetCopied)}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy domain snippet"
                >
                  {agentDomainSnippetCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {domainSnippet}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="agent-token" className="grid gap-4 p-3 rounded-md border">
            <p className="text-xs text-muted-foreground">
              Best if OAuth isn&apos;t reliable in your environment (Claude Code, Claude, etc.).
            </p>

            <p className="text-xs text-muted-foreground">
              <ol className="list-decimal space-y-1 pl-4 text-xs">
                <li>Create a new token below.</li>
                <li>
                  Add both <code className="rounded bg-muted px-1">OVERLORD_MCP_URL</code> and{' '}
                  <code className="rounded bg-muted px-1">OVERLORD_AGENT_TOKEN</code> to the agent
                  runtime environment.
                </li>
                <li>
                  Add <code className="rounded bg-muted px-1">{domainSnippet}</code> to allowed
                  domains if your platform needs an allowlist.
                </li>
              </ol>
            </p>
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">Allowed domain</p>
                <button
                  type="button"
                  onClick={() => void handleCopy(domainSnippet, setAgentDomainSnippetCopied)}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy domain snippet"
                >
                  {agentDomainSnippetCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {domainSnippet}
              </pre>
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
                <p className="text-xs font-medium text-foreground">Environment variables</p>
                <button
                  type="button"
                  onClick={() => void handleCopy(envBlock, setEnvBlockCopied)}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy env block"
                >
                  {envBlockCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {envBlock}
              </pre>
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
                    <li
                      key={token.id}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">
                          {token.label}
                        </p>
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
          </TabsContent>
        </Tabs>
      </div>

      <div className="grid gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Live sessions</p>
            <p className="text-xs text-muted-foreground">
              Use this to clear stale Overlord sessions that still appear live after an agent was
              interrupted. This updates Overlord session state only and does not terminate the
              external agent process.
            </p>
          </div>
          <LoadingButton
            buttonState={refreshSessionsState}
            setButtonState={setRefreshSessionsState}
            text="Refresh"
            loadingText="Refreshing..."
            successText="Refreshed"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            onClick={handleRefreshSessions}
          />
        </div>

        {runningSessions.length === 0 ? (
          <p className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
            No live sessions found.
          </p>
        ) : (
          <ul className="grid gap-2">
            {runningSessions.map(session => {
              const agentType = getAgentTypeByIdentifier(session.agentIdentifier);
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-foreground">
                      {session.ticketTitle?.trim() || 'Untitled ticket'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {agentType?.label ?? session.agentIdentifier} · Started{' '}
                      {new Date(session.attachedAt).toLocaleString()}
                    </p>
                    <p className="text-[11px] text-muted-foreground">Ticket {session.ticketId}</p>
                  </div>
                  <LoadingButton
                    buttonState={stopSessionStates[session.id] ?? 'default'}
                    setButtonState={state =>
                      setStopSessionStates(previous => ({
                        ...previous,
                        [session.id]: state
                      }))
                    }
                    text="Clear session"
                    loadingText="Clearing..."
                    successText="Cleared"
                    errorText="Retry"
                    reset
                    size="sm"
                    variant="outline"
                    onClick={() => handleStopSession(session.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
