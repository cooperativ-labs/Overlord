'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import { getAgentTokenAction, rotateAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

type McpAgentConfig = {
  label: string;
  filePath: string;
  description: string;
  getConfig: (mcpUrl: string, token: string) => string;
};

const MCP_AGENT_CONFIGS: Record<string, McpAgentConfig> = {
  claude: {
    label: 'Claude Code',
    filePath: '~/.claude/settings.json',
    description:
      'Merge into ~/.claude/settings.json (user-wide) or .claude/settings.json (project-level). Learn more: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    getConfig: (mcpUrl, token) =>
      JSON.stringify(
        {
          mcpServers: {
            overlord: {
              type: 'http',
              url: mcpUrl,
              headers: { Authorization: `Bearer ${token}` }
            }
          }
        },
        null,
        2
      )
  },
  cursor: {
    label: 'Cursor',
    filePath: '~/.cursor/mcp.json',
    description: 'Merge into ~/.cursor/mcp.json (global) or .cursor/mcp.json (project-level).',
    getConfig: (mcpUrl, token) =>
      JSON.stringify(
        {
          mcpServers: {
            overlord: {
              url: mcpUrl,
              headers: { Authorization: `Bearer ${token}` }
            }
          }
        },
        null,
        2
      )
  },
  codex: {
    label: 'Codex CLI',
    filePath: '~/.codex/config.toml',
    description: 'Add this block to ~/.codex/config.toml. Learn more: https://developers.openai.com/codex/mcp/',
    getConfig: (mcpUrl, token) =>
      `[[mcp_servers]]\nname = "overlord"\ntype = "http"\nurl = "${mcpUrl}"\n\n[mcp_servers.headers]\nAuthorization = "Bearer ${token}"`
  }
};

export function AgentsAndMcpPage({ open }: { open: boolean }) {
  const { isElectron } = useElectron();

  const [runningAgents, setRunningAgents] = useState<RunningAgentSession[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [refreshAgentsButtonState, setRefreshAgentsButtonState] =
    useState<ButtonLoadingState>('default');
  const [stopAgentButtonStates, setStopAgentButtonStates] = useState<
    Record<string, ButtonLoadingState>
  >({});

  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [agentTokenLoading, setAgentTokenLoading] = useState(false);
  const [agentTokenError, setAgentTokenError] = useState<string | null>(null);
  const [rotateTokenButtonState, setRotateTokenButtonState] =
    useState<ButtonLoadingState>('default');

  const [selectedMcpAgent, setSelectedMcpAgent] = useState('claude');
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false);
  const [agentEnvSnippetCopied, setAgentEnvSnippetCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);

  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  const mcpUrl = getOverlordMcpUrl();
  const resolvedPlatformUrl = getPlatformUrl(platformUrl);

  const resolvedPlatformDomain = (() => {
    try {
      return new URL(resolvedPlatformUrl).hostname;
    } catch {
      return 'overlord.cooperativ.io';
    }
  })();
  const supabaseDomain = (() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return null;
    try {
      return new URL(supabaseUrl).hostname;
    } catch {
      return null;
    }
  })();
  const domainSnippet = Array.from(
    new Set(
      [resolvedPlatformDomain, supabaseDomain].filter((v): v is string => Boolean(v))
    )
  ).join('\n');

  const sessionCountLabel =
    runningAgents.length === 1
      ? '1 running agent session'
      : `${runningAgents.length} running agent sessions`;

  useEffect(() => {
    if (!open || !isElectron) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
  }, [isElectron, open]);

  async function loadRunningAgents(): Promise<boolean> {
    setAgentsError(null);
    try {
      const sessions = await getRunningAgentSessionsAction();
      setRunningAgents(sessions);
      return true;
    } catch (error) {
      console.error('Failed to load running agents:', error);
      setAgentsError('Failed to load running agents.');
      return false;
    } finally {
      setAgentsLoaded(true);
    }
  }

  const loadAgentToken = useCallback(async () => {
    setAgentTokenLoading(true);
    setAgentTokenError(null);
    try {
      const token = await getAgentTokenAction();
      setAgentToken(token);
    } catch (error) {
      console.error('Failed to load agent token:', error);
      setAgentTokenError(error instanceof Error ? error.message : 'Failed to load agent token.');
    } finally {
      setAgentTokenLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setAgentsLoaded(false);
    void loadRunningAgents();
    void loadAgentToken();
  }, [open, loadAgentToken]);

  async function handleRefreshAgents() {
    setRefreshAgentsButtonState('loading');
    const refreshed = await loadRunningAgents();
    setRefreshAgentsButtonState(refreshed ? 'success' : 'error');
  }

  async function handleStopAgent(sessionId: string) {
    setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'loading' }));
    try {
      await stopRunningAgentSessionAction(sessionId);
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'success' }));
      await loadRunningAgents();
    } catch (error) {
      console.error('Failed to stop running agent:', error);
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'error' }));
    }
  }

  async function handleRotateAgentToken() {
    setRotateTokenButtonState('loading');
    setAgentTokenError(null);
    try {
      const token = await rotateAgentTokenAction();
      setAgentToken(token);
      setRotateTokenButtonState('success');
    } catch (error) {
      console.error('Failed to rotate agent token:', error);
      setRotateTokenButtonState('error');
      setAgentTokenError(error instanceof Error ? error.message : 'Failed to rotate agent token.');
    }
  }

  async function handleCopyAgentEnvSnippet() {
    const snippetToken = agentToken ?? '<AGENT_TOKEN>';
    const snippet = `OVERLORD_URL=${resolvedPlatformUrl}\nOVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${snippetToken}`;
    await navigator.clipboard.writeText(snippet);
    setAgentEnvSnippetCopied(true);
    setTimeout(() => setAgentEnvSnippetCopied(false), 2000);
  }

  async function handleCopyAgentDomainSnippet() {
    await navigator.clipboard.writeText(domainSnippet);
    setAgentDomainSnippetCopied(true);
    setTimeout(() => setAgentDomainSnippetCopied(false), 2000);
  }

  async function handleCopyMcpConfig() {
    const cfg = MCP_AGENT_CONFIGS[selectedMcpAgent];
    if (!cfg) return;
    const token = agentToken ?? '<AGENT_TOKEN>';
    await navigator.clipboard.writeText(cfg.getConfig(mcpUrl, token));
    setMcpConfigCopied(true);
    setTimeout(() => setMcpConfigCopied(false), 2000);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Running agents</p>
            <p className="text-xs text-muted-foreground">{sessionCountLabel}</p>
          </div>
          <LoadingButton
            buttonState={refreshAgentsButtonState}
            setButtonState={setRefreshAgentsButtonState}
            text="Refresh"
            loadingText="Refreshing..."
            successText="Refreshed"
            errorText="Try again"
            reset
            variant="outline"
            onClick={handleRefreshAgents}
          />
        </div>
        {!agentsLoaded ? (
          <p className="text-sm text-muted-foreground">Loading running agents…</p>
        ) : null}
        {agentsError ? (
          <p className="text-sm text-destructive">{agentsError}</p>
        ) : null}
        {agentsLoaded && !agentsError && runningAgents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents are currently running.</p>
        ) : null}
        {runningAgents.map(session => (
          <div
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="min-w-0 space-y-1">
              <Link
                className="block truncate text-sm font-medium hover:underline"
                href={buildTicketPath({
                  organizationId: session.organizationId,
                  projectId: session.projectId,
                  ticketId: session.ticketId
                })}
              >
                {session.ticketTitle ?? 'Untitled ticket'}
              </Link>
              <p className="text-xs text-muted-foreground">Agent: {session.agentIdentifier}</p>
              <p className="text-xs text-muted-foreground">
                Attached {new Date(session.attachedAt).toLocaleString()}
              </p>
            </div>
            <LoadingButton
              buttonState={stopAgentButtonStates[session.id] ?? 'default'}
              setButtonState={state =>
                setStopAgentButtonStates(previous => ({ ...previous, [session.id]: state }))
              }
              text="Stop agent"
              loadingText="Stopping..."
              successText="Stopped"
              errorText="Retry"
              reset
              size="sm"
              variant="destructive"
              onClick={() => handleStopAgent(session.id)}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Cloud agents &amp; MCP</p>
          <p className="text-xs text-muted-foreground">
            Configure hosted agents like Claude Code and Codex so they can talk to Overlord via MCP
            and HTTP.
          </p>
        </div>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Cloud agents run in a secure cloud environment and connect back to Overlord using your
            agent token and allowed domains configuration.
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
            <li>
              Open your cloud environment settings in Claude Code, Codex, or another MCP-based
              agent.
            </li>
            <li>Paste the environment variables snippet below into your env config.</li>
            <li>
              Add the domain snippet below to the allowed domains list, and keep the default domain
              list enabled if your tool provides that option.
            </li>
          </ol>
        </div>
        <div className="grid gap-3">
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">Environment variables snippet</p>
              <button
                type="button"
                onClick={() => void handleCopyAgentEnvSnippet()}
                className="shrink-0 rounded p-1 hover:bg-muted"
                title="Copy environment snippet"
              >
                {agentEnvSnippetCopied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
              {`OVERLORD_URL=${resolvedPlatformUrl}\nOVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${
                agentToken ?? '<AGENT_TOKEN>'
              }`}
            </pre>
            <p className="text-xs text-muted-foreground">
              Paste this into your custom cloud environment so the agent can call Overlord with your
              personal token.
            </p>
          </div>
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">Domain snippet</p>
              <button
                type="button"
                onClick={() => void handleCopyAgentDomainSnippet()}
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
            <p className="text-xs text-muted-foreground">
              Add these domains to the allowed domains list for your cloud environment. Include your
              Overlord domain and your Supabase MCP host. We recommend also keeping the option
              checked to include the default domain list.
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="grid gap-1">
              <p className="text-sm font-medium">Agent token</p>
              <p className="text-xs text-muted-foreground">
                Each user has a personal agent token used when Overlord talks to your cloud IDE
                agents. Rotate it if it is ever exposed.
              </p>
            </div>
            <LoadingButton
              buttonState={rotateTokenButtonState}
              setButtonState={setRotateTokenButtonState}
              text={agentToken ? 'Rotate token' : 'Create token'}
              loadingText={agentToken ? 'Rotating...' : 'Creating...'}
              successText={agentToken ? 'Rotated' : 'Created'}
              errorText="Retry"
              reset
              size="sm"
              variant="outline"
              onClick={handleRotateAgentToken}
            />
          </div>
          {agentTokenError ? (
            <p className="text-xs text-destructive">{agentTokenError}</p>
          ) : null}
          {agentTokenLoading ? (
            <p className="text-xs text-muted-foreground">Loading agent token…</p>
          ) : null}
          {!agentToken && !agentTokenLoading && !agentTokenError ? (
            <p className="text-xs text-muted-foreground">
              No agent token found yet. Use &quot;Create token&quot; to generate one.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">MCP configuration</p>
          <p className="text-xs text-muted-foreground">
            Copy the MCP server config snippet to connect your AI coding agent to Overlord. Select
            your agent to see the right format.
          </p>
        </div>
        <Select value={selectedMcpAgent} onValueChange={setSelectedMcpAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(MCP_AGENT_CONFIGS).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const cfg = MCP_AGENT_CONFIGS[selectedMcpAgent];
          if (!cfg) return null;
          const token = agentToken ?? '<AGENT_TOKEN>';
          return (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">{cfg.label} MCP config</p>
                <button
                  type="button"
                  onClick={() => void handleCopyMcpConfig()}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy MCP config"
                >
                  {mcpConfigCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {cfg.getConfig(mcpUrl, token)}
              </pre>
              <p className="text-xs text-muted-foreground">{cfg.description}</p>
              <p className="break-all text-xs text-muted-foreground">
                File: <code className="rounded bg-muted px-1">{cfg.filePath}</code>
              </p>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
