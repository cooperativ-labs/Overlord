'use client';

import { Check, Copy, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getAllAgentConfigsAction, updateAgentFlagsAction } from '@/lib/actions/agent-config';
import {
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import { getAgentTokenAction, rotateAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';
import {
  DEFAULT_AGENT_TRIGGER_STORAGE_KEY,
  readDefaultAgentTriggerFromStorage
} from '@/lib/helpers/agent-trigger';
import {
  AGENT_SELECTOR_VALUES,
  type AgentSelectorValue,
  getAgentTypeByValue
} from '@/lib/helpers/agent-types';
import { buildTicketPath } from '@/lib/helpers/ticket-path';

type McpAgentConfig = {
  label: string;
  location: string;
  description: string;
  getConfig: (mcpUrl: string, token: string) => string;
};

const AGENTS = ['claude', 'cursor', 'codex'] as const;

const MCP_AGENT_CONFIGS: Record<string, McpAgentConfig> = {
  claude: {
    label: 'Claude (Custom Connector)',
    location: 'https://claude.ai/customize/connectors',
    description:
      'Create a custom connector in Claude at https://claude.ai/customize/connectors. Use the MCP address below and authenticate with your agent token via OAuth 2.1.',
    getConfig: (mcpUrl, _token) => mcpUrl
  },
  cursor: {
    label: 'Cursor',
    location: 'mcp.json (global or project-level)',
    description:
      'Add this object to mcp.json in ~/.cursor/ (global) or .cursor/ (project-level). Cursor will use OAuth 2.1 to authenticate with Overlord using your saved credentials.',
    getConfig: (mcpUrl, _token) =>
      JSON.stringify(
        {
          mcpServers: {
            overlord: {
              url: mcpUrl
            }
          }
        },
        null,
        2
      )
  },
  codex: {
    label: 'Codex CLI',
    location: '~/.codex/config.toml',
    description:
      'Add this block to ~/.codex/config.toml using `OVERLORD_MCP_URL`. Then set `AGENT_TOKEN` in your shell environment (for example in ~/.zshrc or inline as `AGENT_TOKEN=... codex`) before launching Codex.',
    getConfig: (mcpUrl, _token) =>
      `[mcp_servers.overlord]\nurl = "${mcpUrl}"\nbearer_token_env_var = "AGENT_TOKEN"`
  }
};

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex'
};

function getAgentSelectorLabel(agentValue: AgentSelectorValue): string {
  if (agentValue === 'copy-local') return 'Copy Local';
  if (agentValue === 'copy-cloud') return 'Copy Cloud';
  return getAgentTypeByValue(agentValue).label;
}

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

  const [selectedMcpAgent, setSelectedMcpAgent] = useState('claude-cloud');
  const [selectedDefaultAgentTrigger, setSelectedDefaultAgentTrigger] =
    useState<AgentSelectorValue>('claude');
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false);
  const [agentTokenCopied, setAgentTokenCopied] = useState(false);
  const [agentEnvSnippetCopied, setAgentEnvSnippetCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);

  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  const [selectedLocalAgent, setSelectedLocalAgent] = useState<string>('claude');
  const [agentFlags, setAgentFlags] = useState<Record<string, string[]>>({});
  const [flagInput, setFlagInput] = useState('');
  const [commandCopied, setCommandCopied] = useState(false);

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
    new Set([resolvedPlatformDomain, supabaseDomain].filter((v): v is string => Boolean(v)))
  ).join('\n');
  const isLocationUrl = (value: string) => /^https?:\/\//i.test(value);

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

  useEffect(() => {
    if (!open) return;
    setSelectedDefaultAgentTrigger(readDefaultAgentTriggerFromStorage());
  }, [open]);

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
      let token = await getAgentTokenAction();
      if (!token) {
        token = await rotateAgentTokenAction();
      }
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

    // Load agent configs from database
    void (async () => {
      try {
        const configs = await getAllAgentConfigsAction();
        const flags: Record<string, string[]> = {};
        Object.entries(configs).forEach(([agentType, config]) => {
          flags[agentType] = config.flags ?? [];
        });
        setAgentFlags(flags);
      } catch (error) {
        console.error('Failed to load agent configs:', error);
      }
    })();
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
    const snippet = `OVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${snippetToken}`;
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

  async function handleCopyAgentTokenSnippet() {
    const snippet = `AGENT_TOKEN=${agentToken ?? '<AGENT_TOKEN>'}`;
    await navigator.clipboard.writeText(snippet);
    setAgentTokenCopied(true);
    setTimeout(() => setAgentTokenCopied(false), 2000);
  }

  async function handleAddFlag() {
    if (!flagInput.trim()) return;

    const newFlags = { ...agentFlags };
    if (!newFlags[selectedLocalAgent]) {
      newFlags[selectedLocalAgent] = [];
    }

    const flag = flagInput.trim();
    if (!newFlags[selectedLocalAgent].includes(flag)) {
      newFlags[selectedLocalAgent].push(flag);
      setAgentFlags(newFlags);
      try {
        await updateAgentFlagsAction(selectedLocalAgent, newFlags[selectedLocalAgent]);
      } catch (error) {
        console.error('Failed to save agent flags:', error);
      }
    }
    setFlagInput('');
  }

  async function handleRemoveFlag(agent: string, index: number) {
    const newFlags = { ...agentFlags };
    newFlags[agent] = (newFlags[agent] ?? []).filter((_, i) => i !== index);
    setAgentFlags(newFlags);
    try {
      await updateAgentFlagsAction(agent, newFlags[agent]);
    } catch (error) {
      console.error('Failed to save agent flags:', error);
    }
  }

  async function handleCopyCommand() {
    const flags = (agentFlags[selectedLocalAgent] ?? []).join(' ');
    const command = `npx overlord resume ${selectedLocalAgent}${flags ? ` ${flags}` : ''}`;
    await navigator.clipboard.writeText(command);
    setCommandCopied(true);
    setTimeout(() => setCommandCopied(false), 2000);
  }

  function handleDefaultAgentTriggerChange(value: string) {
    const nextValue = value as AgentSelectorValue;
    if (!AGENT_SELECTOR_VALUES.includes(nextValue)) return;
    setSelectedDefaultAgentTrigger(nextValue);
    window.localStorage.setItem(DEFAULT_AGENT_TRIGGER_STORAGE_KEY, nextValue);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Agent trigger</p>
          <p className="text-xs text-muted-foreground">
            Choose which action appears as the default option in the agent split button.
          </p>
        </div>
        <Select value={selectedDefaultAgentTrigger} onValueChange={handleDefaultAgentTriggerChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select default option" />
          </SelectTrigger>
          <SelectContent>
            {AGENT_SELECTOR_VALUES.map(agentValue => (
              <SelectItem key={agentValue} value={agentValue}>
                {getAgentSelectorLabel(agentValue)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Local agent configuration</p>
          <p className="text-xs text-muted-foreground">
            Add custom flags to the agent command when running locally. Claude has
            --enable-auto-mode enabled by default.
          </p>
        </div>
        <Select value={selectedLocalAgent} onValueChange={setSelectedLocalAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {AGENTS.map(agent => (
              <SelectItem key={agent} value={agent}>
                {AGENT_LABELS[agent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-xs font-medium text-foreground">Command flags</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g., --enable-auto-mode"
                value={flagInput}
                onChange={e => setFlagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddFlag();
                  }
                }}
                className="flex-1 rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => void handleAddFlag()}
                className="rounded border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80"
              >
                Add
              </button>
            </div>
          </div>
          {(agentFlags[selectedLocalAgent] ?? []).length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {(agentFlags[selectedLocalAgent] ?? []).map((flag, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1"
                  >
                    <code className="text-xs font-medium">{flag}</code>
                    <button
                      type="button"
                      onClick={() => void handleRemoveFlag(selectedLocalAgent, index)}
                      className="rounded p-0.5 hover:bg-muted-foreground/20"
                      title="Remove flag"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-foreground">Command</p>
              <button
                type="button"
                onClick={() => void handleCopyCommand()}
                className="shrink-0 rounded p-1 hover:bg-muted"
                title="Copy command"
              >
                {commandCopied ? (
                  <Check className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
              {`npx overlord resume ${selectedLocalAgent}${(agentFlags[selectedLocalAgent] ?? []).length > 0
                  ? ` ${(agentFlags[selectedLocalAgent] ?? []).join(' ')}`
                  : ''
                }`}
            </pre>
          </div>
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
            <SelectItem value="claude-cloud">Agent Environment Variables</SelectItem>
            {Object.entries(MCP_AGENT_CONFIGS).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedMcpAgent === 'claude-cloud' ? (
          <div className="grid gap-3">
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Use the snippets below to configure your Claude or Codex environments so your AI
                agent can call Overlord from the cloud runner.
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Open Claude or Codex settings and create or update a cloud environment.</li>
                <li>Paste the environment variables snippet into that environment.</li>
                <li>
                  Add the domains snippet to allowed domains, and keep the default domain list
                  enabled if available.
                </li>
              </ol>
            </div>
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
                {`OVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${agentToken ?? '<AGENT_TOKEN>'}`}
              </pre>
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
            </div>
          </div>
        ) : (
          (() => {
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
                  Location:{' '}
                  {isLocationUrl(cfg.location) ? (
                    <a
                      className="underline hover:no-underline"
                      href={cfg.location}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {cfg.location}
                    </a>
                  ) : (
                    <code className="rounded bg-muted px-1">{cfg.location}</code>
                  )}
                </p>
              </div>
            );
          })()
        )}
      </div>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Agent token</p>
          <p className="text-xs text-muted-foreground">
            Each user has a personal agent token used when Overlord talks to your cloud IDE agents.
            Rotate it if it is ever exposed.
          </p>
        </div>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">AGENT_TOKEN</p>
            <button
              type="button"
              onClick={() => void handleCopyAgentTokenSnippet()}
              className="shrink-0 rounded p-1 hover:bg-muted"
              title="Copy AGENT_TOKEN snippet"
            >
              {agentTokenCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
            {`${agentToken ?? '<AGENT_TOKEN>'}`}
          </pre>
          {agentTokenError ? <p className="text-xs text-destructive">{agentTokenError}</p> : null}
          {agentTokenLoading ? (
            <p className="text-xs text-muted-foreground">Loading agent token…</p>
          ) : null}
          {!agentToken && !agentTokenLoading && !agentTokenError ? (
            <p className="text-xs text-muted-foreground">No agent token found.</p>
          ) : null}
          <div>
            <LoadingButton
              buttonState={rotateTokenButtonState}
              setButtonState={setRotateTokenButtonState}
              text="Rotate token"
              loadingText="Rotating..."
              successText="Rotated"
              errorText="Retry"
              reset
              size="sm"
              variant="outline"
              onClick={handleRotateAgentToken}
            />
          </div>
        </div>
      </div>
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
        {agentsError ? <p className="text-sm text-destructive">{agentsError}</p> : null}
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
    </div>
  );
}
