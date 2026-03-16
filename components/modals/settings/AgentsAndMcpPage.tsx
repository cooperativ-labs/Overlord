'use client';

import { Check, Copy, Download, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Badge } from '@/components/ui/badge';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ensureAgentTokenAction, rotateAgentTokenAction } from '@/lib/actions/agent-tokens';
import type { UserOrganization } from '@/lib/actions/organizations';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';

type McpAgentConfig = {
  label: string;
  location: string;
  description: string;
  getConfig: (mcpUrl: string, token: string) => string;
};

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

export function AgentsAndMcpPage({
  open,
  organizations,
  selectedOrgId
}: {
  open: boolean;
  organizations: UserOrganization[];
  selectedOrgId: number | null;
}) {
  const { isElectron } = useElectron();

  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [agentTokenLoading, setAgentTokenLoading] = useState(false);
  const [agentTokenError, setAgentTokenError] = useState<string | null>(null);
  const [rotateTokenButtonState, setRotateTokenButtonState] =
    useState<ButtonLoadingState>('default');
  const [selectedTokenOrgId, setSelectedTokenOrgId] = useState<string>('');

  const [selectedMcpAgent, setSelectedMcpAgent] = useState('claude-cloud');
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false);
  const [agentTokenCopied, setAgentTokenCopied] = useState(false);
  const [agentEnvSnippetCopied, setAgentEnvSnippetCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);

  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  // Agent bundle status
  type BundleStatusEntry = {
    agent: 'claude' | 'codex';
    status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
    version: string | null;
    installedVersion: string | null;
    details: string;
  };
  const [bundleStatuses, setBundleStatuses] = useState<BundleStatusEntry[]>([]);
  const [bundleActionLoading, setBundleActionLoading] = useState<string | null>(null);

  const loadBundleStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.agentBundle) return;
    try {
      const statuses = await window.electronAPI.agentBundle.getAllStatuses();
      setBundleStatuses(statuses);
    } catch {
      // Agent bundle API not available
    }
  }, [isElectron]);

  useEffect(() => {
    if (!open) return;
    void loadBundleStatuses();
  }, [open, loadBundleStatuses]);

  async function handleInstallBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(agent);
    try {
      await window.electronAPI.agentBundle.install(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleInstallAllBundles() {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading('all');
    try {
      await window.electronAPI.agentBundle.installAll();
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleRepairBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(`repair-${agent}`);
    try {
      await window.electronAPI.agentBundle.repair(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

  async function handleUninstallBundle(agent: 'claude' | 'codex') {
    if (!window.electronAPI?.agentBundle) return;
    setBundleActionLoading(`uninstall-${agent}`);
    try {
      await window.electronAPI.agentBundle.uninstall(agent);
      await loadBundleStatuses();
    } catch {
      // Handled by status refresh
    } finally {
      setBundleActionLoading(null);
    }
  }

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
  const resolvedTokenOrgId =
    selectedTokenOrgId !== ''
      ? Number(selectedTokenOrgId)
      : (selectedOrgId ?? organizations[0]?.id ?? null);
  const selectedTokenOrg =
    resolvedTokenOrgId !== null
      ? (organizations.find(org => org.id === resolvedTokenOrgId) ?? null)
      : null;

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
    const nextOrgId = selectedOrgId ?? organizations[0]?.id ?? null;
    setSelectedTokenOrgId(nextOrgId !== null ? String(nextOrgId) : '');
  }, [open, organizations, selectedOrgId]);

  const loadAgentToken = useCallback(async () => {
    setAgentTokenLoading(true);
    setAgentTokenError(null);
    try {
      if (resolvedTokenOrgId === null) {
        setAgentToken(null);
        return;
      }
      const token = await ensureAgentTokenAction(resolvedTokenOrgId);
      setAgentToken(token);
    } catch (error) {
      console.error('Failed to load agent token:', error);
      setAgentTokenError(error instanceof Error ? error.message : 'Failed to load agent token.');
    } finally {
      setAgentTokenLoading(false);
    }
  }, [resolvedTokenOrgId]);

  useEffect(() => {
    if (!open) return;
    void loadAgentToken();
  }, [open, loadAgentToken]);

  async function handleRotateAgentToken() {
    setRotateTokenButtonState('loading');
    setAgentTokenError(null);
    try {
      if (resolvedTokenOrgId === null) {
        throw new Error('No organization available for token rotation.');
      }
      const token = await rotateAgentTokenAction(resolvedTokenOrgId);
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

  async function handleCopyMcpUrl() {
    await navigator.clipboard.writeText(mcpUrl);
    setMcpUrlCopied(true);
    setTimeout(() => setMcpUrlCopied(false), 2000);
  }

  const bundleStatusBadge = (status: BundleStatusEntry['status']) => {
    switch (status) {
      case 'installed':
        return (
          <Badge variant="default" className="bg-green-600 text-xs">
            Installed
          </Badge>
        );
      case 'stale':
        return (
          <Badge variant="secondary" className="text-xs">
            Update available
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="secondary" className="text-xs">
            Partial
          </Badge>
        );
      case 'not_installed':
        return (
          <Badge variant="outline" className="text-xs">
            Not installed
          </Badge>
        );
      default:
        return (
          <Badge variant="destructive" className="text-xs">
            Error
          </Badge>
        );
    }
  };

  return (
    <div className="grid gap-6">
      {isElectron && bundleStatuses.length > 0 && (
        <div className="grid gap-4">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Agent plugins</p>
            <p className="text-xs text-muted-foreground">
              Install Overlord workflow instructions directly into your local agent config. This
              enables shorter prompts and a durable permission notification hook.
            </p>
          </div>
          <div className="space-y-2">
            {bundleStatuses.map(entry => (
              <div
                key={entry.agent}
                className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3"
              >
                <div className="grid gap-0.5">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium capitalize">{entry.agent}</p>
                    {bundleStatusBadge(entry.status)}
                  </div>
                  <p className="text-xs text-muted-foreground">{entry.details}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {(entry.status === 'not_installed' || entry.status === 'stale') && (
                    <button
                      type="button"
                      disabled={bundleActionLoading !== null}
                      onClick={() => void handleInstallBundle(entry.agent)}
                      className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                      title={entry.status === 'stale' ? 'Update' : 'Install'}
                    >
                      <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                  {(entry.status === 'partial' || entry.status === 'error') && (
                    <button
                      type="button"
                      disabled={bundleActionLoading !== null}
                      onClick={() => void handleRepairBundle(entry.agent)}
                      className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                      title="Repair"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                  {entry.status === 'installed' && (
                    <button
                      type="button"
                      disabled={bundleActionLoading !== null}
                      onClick={() => void handleUninstallBundle(entry.agent)}
                      className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                      title="Uninstall"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <LoadingButton
            buttonState={bundleActionLoading === 'all' ? 'loading' : 'default'}
            setButtonState={() => {}}
            text="Install all"
            loadingText="Installing..."
            successText="Installed"
            errorText="Retry"
            size="sm"
            variant="outline"
            onClick={() => void handleInstallAllBundles()}
            disabled={
              bundleActionLoading !== null || bundleStatuses.every(s => s.status === 'installed')
            }
          />
        </div>
      )}

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">MCP & cloud agents</p>
          <p className="text-xs text-muted-foreground">
            Agents running in cloud environments communicate with Overlord through MCP. Configure
            your MCP endpoint and token here, then use the snippets below in your agent platform.
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">MCP URL</p>
          <p className="text-xs text-muted-foreground">Use this URL in your MCP client settings.</p>
        </div>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">OVERLORD_MCP_URL</p>
            <button
              type="button"
              onClick={() => void handleCopyMcpUrl()}
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
            Agent tokens are scoped per user and per workspace. Select a workspace to view and copy
            the token to use in cloud environments.
          </p>
        </div>
        <div className="grid gap-2">
          <p className="text-xs font-medium text-foreground">Workspace</p>
          <Select value={selectedTokenOrgId} onValueChange={setSelectedTokenOrgId}>
            <SelectTrigger className="max-w-sm">
              <SelectValue placeholder="Select workspace" />
            </SelectTrigger>
            <SelectContent>
              {organizations.map(org => (
                <SelectItem key={org.id} value={String(org.id)}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">
              {selectedTokenOrg ? `${selectedTokenOrg.name} AGENT_TOKEN` : 'AGENT_TOKEN'}
            </p>
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
          {!selectedTokenOrgId ? (
            <p className="text-xs text-muted-foreground">No workspace selected.</p>
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
    </div>
  );
}
