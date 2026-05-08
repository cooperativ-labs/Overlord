'use client';

import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';

type McpAgentConfig = {
  label: string;
  location: string;
  description: string;
  installSteps?: string[];
  getConfig: (mcpUrl: string) => string;
};

const MCP_AGENT_CONFIGS: Record<string, McpAgentConfig> = {
  claude: {
    label: 'Claude (Custom Connector)',
    location: 'https://claude.ai/customize/connectors',
    description:
      'Create a custom connector in Claude at https://claude.ai/customize/connectors. Use the MCP address below and authenticate through OAuth 2.1.',
    installSteps: [
      'Open Claude connector settings and create a new custom connector.',
      'Paste the Overlord MCP URL as the connector server URL.',
      'Start the connector login flow and complete the OAuth consent screen.'
    ],
    getConfig: mcpUrl => mcpUrl
  },
  cursor: {
    label: 'Cursor',
    location: 'mcp.json (global or project-level)',
    description:
      'Add this object to mcp.json in ~/.cursor/ (global) or .cursor/ (project-level). Cursor will use OAuth 2.1 to authenticate with Overlord using your saved credentials.',
    installSteps: [
      'Open your global or project-level Cursor MCP config file.',
      'Paste the Overlord MCP server object below.',
      'Restart Cursor or reload MCP servers, then complete the OAuth login flow when prompted.'
    ],
    getConfig: mcpUrl =>
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
    label: 'Codex',
    location: '~/.codex/config.toml',
    description:
      'Add this MCP server block to ~/.codex/config.toml. Codex should authenticate with Overlord through the OAuth flow or shared OAuth credentials.',
    installSteps: [
      'Add the Codex MCP block below to ~/.codex/config.toml.',
      'Run ovld auth repair first if this machine already has shared Overlord OAuth credentials; otherwise run ovld auth login.',
      'Restart Codex and complete the OAuth flow if prompted.'
    ],
    getConfig: mcpUrl => `[mcp_servers.overlord]\nurl = "${mcpUrl}"`
  }
};

export function AgentsAndMcpPage({ open }: { open: boolean }) {
  const { isElectron } = useElectron();

  const [selectedMcpAgent, setSelectedMcpAgent] = useState('claude-cloud');
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [mcpConfigCopied, setMcpConfigCopied] = useState(false);
  const [agentDomainSnippetCopied, setAgentDomainSnippetCopied] = useState(false);
  const [codexInstallScriptCopied, setCodexInstallScriptCopied] = useState(false);

  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

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
    new Set([resolvedPlatformDomain].filter((v): v is string => Boolean(v)))
  ).join('\n');
  const isLocationUrl = (value: string) => /^https?:\/\//i.test(value);

  useEffect(() => {
    if (!open || !isElectron) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
  }, [isElectron, open]);

  async function handleCopyAgentDomainSnippet() {
    await navigator.clipboard.writeText(domainSnippet);
    setAgentDomainSnippetCopied(true);
    setTimeout(() => setAgentDomainSnippetCopied(false), 2000);
  }

  async function handleCopyCodexInstallScript() {
    const script = [
      'mkdir -p ~/.codex',
      "cat >> ~/.codex/config.toml <<'EOF'",
      `[mcp_servers.overlord]`,
      `url = "${mcpUrl}"`,
      'EOF',
      'ovld auth repair',
      'ovld auth login'
    ].join('\n');

    await navigator.clipboard.writeText(script);
    setCodexInstallScriptCopied(true);
    setTimeout(() => setCodexInstallScriptCopied(false), 2000);
  }

  async function handleCopyMcpConfig() {
    const cfg = MCP_AGENT_CONFIGS[selectedMcpAgent];
    if (!cfg) return;
    await navigator.clipboard.writeText(cfg.getConfig(mcpUrl));
    setMcpConfigCopied(true);
    setTimeout(() => setMcpConfigCopied(false), 2000);
  }

  async function handleCopyMcpUrl() {
    await navigator.clipboard.writeText(mcpUrl);
    setMcpUrlCopied(true);
    setTimeout(() => setMcpUrlCopied(false), 2000);
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">MCP & cloud agents</p>
          <p className="text-xs text-muted-foreground">
            Agents running in cloud environments communicate with Overlord through MCP. Configure
            clients with the MCP endpoint below and authenticate through OAuth.
          </p>
          <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-900 dark:text-amber-200">
                <span className="font-semibold">OAuth fallback:</span> If the OAuth connector is
                unreliable in your environment, use a per-project{' '}
                <code className="rounded bg-amber-200/50 px-1 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">
                  OVERLORD_AGENT_TOKEN
                </code>{' '}
                instead. Generate one in each project&apos;s settings under{' '}
                <span className="font-semibold">Project settings &rarr; Agents</span>.
              </p>
            </div>
          </div>
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
            Copy the MCP server config snippet to connect your AI coding agent to Overlord. Clients
            should use the public MCP URL directly and complete the OAuth login flow.
          </p>
        </div>
        <Select value={selectedMcpAgent} onValueChange={setSelectedMcpAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-cloud">OAuth setup notes</SelectItem>
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
                Use the notes below for environments that need network allowlists or CLI
                bootstrapping. Agents authenticate through OAuth; local CLI users should sign in
                with Overlord Desktop, or try <code>ovld auth repair</code> first if a shared
                session already exists before running <code>ovld auth login</code>.
              </p>
              <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Create or update the environment that launches your agent runtime.</li>
                <li>Configure the MCP URL in the client using the per-agent snippets below.</li>
                <li>
                  Add the domains snippet to allowed domains if your platform uses outbound domain
                  allowlists.
                </li>
                <li>For Codex, also add the config.toml block or install script shown below.</li>
              </ol>
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
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">Codex install script</p>
                <button
                  type="button"
                  onClick={() => void handleCopyCodexInstallScript()}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy Codex install script"
                >
                  {codexInstallScriptCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {[
                  'mkdir -p ~/.codex',
                  "cat >> ~/.codex/config.toml <<'EOF'",
                  '[mcp_servers.overlord]',
                  `url = "${mcpUrl}"`,
                  'EOF',
                  'ovld auth repair',
                  'ovld auth login'
                ].join('\n')}
              </pre>
              <p className="text-xs text-muted-foreground">
                Use this for self-serve Codex setup on machines that can complete the OAuth login
                flow.
              </p>
            </div>
          </div>
        ) : (
          (() => {
            const cfg = MCP_AGENT_CONFIGS[selectedMcpAgent];
            if (!cfg) return null;
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
                  {cfg.getConfig(mcpUrl)}
                </pre>
                <p className="text-xs text-muted-foreground">{cfg.description}</p>
                <div className="rounded-md border bg-background/60 p-2">
                  <p className="text-xs font-medium text-foreground">Auth mode: OAuth login</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Complete the login flow in the client or sign in with shared Overlord CLI
                    credentials.
                  </p>
                </div>
                {cfg.installSteps ? (
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                    {cfg.installSteps.map(step => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
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
    </div>
  );
}
