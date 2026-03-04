'use client';

import { Check, Copy } from 'lucide-react';
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
import { getAgentTokenAction, rotateAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getOverlordMcpUrl, getPlatformUrl } from '@/lib/env';

type SlashCommandConfig = {
  label: string;
  filePath: string;
  description: string;
  fileContent: string;
  installCmd: string;
};

const SLASH_COMMAND_CONFIGS: Record<string, SlashCommandConfig> = {
  claude: {
    label: 'Claude Code',
    filePath: '.claude/commands/switch-ticket.md',
    description:
      'Creates a /switch-ticket slash command for Claude Code in your project directory.',
    fileContent: `The user wants to switch to a different Overlord ticket.

Run \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once the user picks a ticket, run \`ovld attach <ticketId> claude\` to launch a new agent session on that ticket.`,
    installCmd: `mkdir -p .claude/commands && cat > .claude/commands/switch-ticket.md << 'EOF'\nThe user wants to switch to a different Overlord ticket.\n\nRun \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once the user picks a ticket, run \`ovld attach <ticketId> claude\` to launch a new agent session on that ticket.\nEOF`
  },
  codex: {
    label: 'Codex CLI',
    filePath: 'AGENTS.md',
    description:
      'Appends switch-ticket instructions to your AGENTS.md so Codex knows how to switch tickets.',
    fileContent: `## Switching Overlord tickets

To switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> codex\` to go directly to a specific ticket.`,
    installCmd: `cat >> AGENTS.md << 'EOF'\n\n## Switching Overlord tickets\n\nTo switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> codex\` to go directly to a specific ticket.\nEOF`
  },
  cursor: {
    label: 'Cursor',
    filePath: '.cursor/rules/switch-ticket.mdc',
    description:
      'Creates a Cursor rule that teaches the agent how to switch Overlord tickets on request.',
    fileContent: `---
description: Switch to a different Overlord ticket
globs:
alwaysApply: false
---

The user wants to switch to a different Overlord ticket.

Run \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once confirmed, run \`ovld attach <ticketId> cursor\` to start a new session on that ticket.`,
    installCmd: `mkdir -p .cursor/rules && cat > .cursor/rules/switch-ticket.mdc << 'EOF'\n---\ndescription: Switch to a different Overlord ticket\nglobs:\nalwaysApply: false\n---\n\nThe user wants to switch to a different Overlord ticket.\n\nRun \`ovld tickets list\` to show available tickets, or \`ovld attach\` for an interactive picker. Once confirmed, run \`ovld attach <ticketId> cursor\` to start a new session on that ticket.\nEOF`
  },
  gemini: {
    label: 'Gemini CLI',
    filePath: 'GEMINI.md',
    description:
      'Appends switch-ticket instructions to your GEMINI.md so Gemini knows how to switch tickets.',
    fileContent: `## Switching Overlord tickets

To switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> gemini\` to go directly to a specific ticket.`,
    installCmd: `cat >> GEMINI.md << 'EOF'\n\n## Switching Overlord tickets\n\nTo switch to a different Overlord ticket, run \`ovld attach\` in the terminal for an interactive picker, or \`ovld attach <ticketId> gemini\` to go directly to a specific ticket.\nEOF`
  }
};

export function CliPage({ open }: { open: boolean }) {
  const { isElectron, api } = useElectron();

  const [agentToken, setAgentToken] = useState<string | null>(null);
  const [agentTokenLoading, setAgentTokenLoading] = useState(false);
  const [agentTokenError, setAgentTokenError] = useState<string | null>(null);
  const [rotateTokenButtonState, setRotateTokenButtonState] =
    useState<ButtonLoadingState>('default');

  const [selectedSlashAgent, setSelectedSlashAgent] = useState('claude');
  const [slashCommandCopied, setSlashCommandCopied] = useState(false);
  const [agentEnvSnippetCopied, setAgentEnvSnippetCopied] = useState(false);

  const [cliInstallButtonState, setCliInstallButtonState] =
    useState<ButtonLoadingState>('default');
  const [cliInstalled, setCliInstalled] = useState(false);
  const [cliInstallPath, setCliInstallPath] = useState<string | null>(null);
  const [cliInstallMessage, setCliInstallMessage] = useState<string | null>(null);
  const [cliVersion, setCliVersion] = useState<string | null>(null);
  const [cliIsStale, setCliIsStale] = useState(false);

  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  const mcpUrl = getOverlordMcpUrl();
  const resolvedPlatformUrl = getPlatformUrl(platformUrl);

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
    void loadAgentToken();
  }, [open, loadAgentToken]);

  useEffect(() => {
    if (!open || !isElectron || !api?.cli) return;
    void api.cli.getInstallStatus().then(({ installed, installPath, isStale, version }) => {
      setCliInstalled(installed);
      setCliInstallPath(installPath ?? null);
      setCliIsStale(isStale ?? false);
      setCliVersion(version);
    });
  }, [api, isElectron, open]);

  useEffect(() => {
    if (!open || !isElectron) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
  }, [isElectron, open]);

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

  async function handleCopySlashInstall() {
    const config = SLASH_COMMAND_CONFIGS[selectedSlashAgent];
    if (!config) return;
    await navigator.clipboard.writeText(config.installCmd);
    setSlashCommandCopied(true);
    setTimeout(() => setSlashCommandCopied(false), 2000);
  }

  async function handleCopyAgentEnvSnippet() {
    const snippetToken = agentToken ?? '<AGENT_TOKEN>';
    const snippet = `OVERLORD_URL=${resolvedPlatformUrl}\nOVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${snippetToken}`;
    await navigator.clipboard.writeText(snippet);
    setAgentEnvSnippetCopied(true);
    setTimeout(() => setAgentEnvSnippetCopied(false), 2000);
  }

  async function handleInstallCli() {
    if (!api?.cli) return;
    setCliInstallButtonState('loading');
    setCliInstallMessage(null);
    try {
      const result = await api.cli.install();
      if (result.ok) {
        setCliInstallButtonState('success');
        setCliInstalled(true);
        setCliInstallPath(result.installPath);
        setCliInstallMessage(result.pathInstruction);
        setCliIsStale(false);
      } else {
        setCliInstallButtonState('error');
        setCliInstallMessage(result.error);
      }
    } catch (error) {
      setCliInstallButtonState('error');
      setCliInstallMessage(error instanceof Error ? error.message : 'Install failed');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Overlord CLI (ovld)</p>
        <p className="text-xs text-muted-foreground">
          The CLI lets agents in Claude Code, Codex, Cursor, and Gemini work with Overlord tickets.
          Available commands:
        </p>
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
        {agentToken && !agentTokenLoading ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2">
              <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                {`OVERLORD_URL=${resolvedPlatformUrl}\nOVERLORD_MCP_URL=${mcpUrl}\nAGENT_TOKEN=${agentToken}`}
              </pre>
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
            <p className="text-xs text-muted-foreground">
              Add this snippet to your custom cloud environment in Claude Code or Codex. Also add
              the domains from the Cloud agents &amp; MCP domain snippet to the allow-list, and we
              recommend keeping the option checked to also include the default domain list.
            </p>
          </div>
        ) : null}
        {!agentToken && !agentTokenLoading && !agentTokenError ? (
          <p className="text-xs text-muted-foreground">
            No agent token found yet. Use &quot;Create token&quot; to generate one.
          </p>
        ) : null}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs">
        <p className="mb-2 font-sans font-medium text-foreground">Top-level</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld attach [ticketId] [agent]</code>{' '}
            interactive ticket picker + agent launcher
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld auth</code> login, status, logout
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld tickets</code> create, list
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld ticket</code> context
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld protocol</code> attach, update, ask,
            read-context, write-context, deliver
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld run &lt;agent&gt;</code> launch
            agent (requires TICKET_ID)
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld resume &lt;agent&gt;</code>{' '}
            resume an agent session
          </li>
        </ul>
        <p className="mt-3 mb-2 font-sans font-medium text-foreground">Examples</p>
        <ul className="grid gap-1 text-muted-foreground">
          <li className="break-words">
            <code className="rounded bg-muted px-1">ovld attach</code> — interactive: search
            tickets, pick agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">ovld attach &lt;ticketId&gt;</code> —
            skip search, pick agent
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld attach &lt;ticketId&gt; claude
            </code>{' '}
            — fully non-interactive
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld protocol attach --ticket-id &lt;id&gt;
            </code>
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld protocol update --session-key &lt;key&gt; --summary &quot;...&quot;
            </code>
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld protocol deliver --session-key &lt;key&gt; --summary &quot;...&quot;
            </code>
          </li>
          <li className="break-words">
            <code className="rounded bg-muted px-1 break-all">
              ovld tickets create --objective &quot;...&quot; --execution-target agent
            </code>
          </li>
        </ul>
        <p className="mt-2 text-muted-foreground">
          Run{' '}
          <code className="rounded bg-muted px-1 break-all">ovld &lt;command&gt; --help</code> for
          more detail.
        </p>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Agent slash commands</p>
        <p className="text-xs text-muted-foreground">
          Install a <code className="rounded bg-muted px-1">/switch-ticket</code> command so your
          agent can switch Overlord tickets without leaving its session. Select your agent for setup
          instructions.
        </p>
        <Select value={selectedSlashAgent} onValueChange={setSelectedSlashAgent}>
          <SelectTrigger>
            <SelectValue placeholder="Select agent" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SLASH_COMMAND_CONFIGS).map(([key, cfg]) => (
              <SelectItem key={key} value={key}>
                {cfg.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(() => {
          const cfg = SLASH_COMMAND_CONFIGS[selectedSlashAgent];
          if (!cfg) return null;
          return (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <p className="mb-1 font-sans text-muted-foreground">{cfg.description}</p>
              <p className="mb-2 break-all font-sans text-muted-foreground">
                File: <code className="rounded bg-muted px-1">{cfg.filePath}</code>
              </p>
              <pre className="mb-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-foreground">
                {cfg.fileContent}
              </pre>
              <div className="flex items-center gap-2">
                <p className="shrink-0 font-sans text-muted-foreground">Install command:</p>
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-1">
                  {cfg.installCmd}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopySlashInstall()}
                  className="shrink-0 rounded p-1 hover:bg-muted"
                  title="Copy install command"
                >
                  {slashCommandCopied ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            </div>
          );
        })()}
      </div>

      {isElectron && api?.cli ? (
        <>
          {cliInstalled && !cliIsStale ? (
            <div className="rounded-md border p-3">
              <p className="text-sm font-medium text-green-600 dark:text-green-400">
                ovld {cliVersion ? `v${cliVersion}` : ''} installed at {cliInstallPath}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Automatically updated when the desktop app updates.
              </p>
              {cliInstallMessage ? (
                <p className="mt-1 text-xs text-muted-foreground">{cliInstallMessage}</p>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2">
              {cliIsStale ? (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 p-3 dark:bg-yellow-900/10">
                  <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                    CLI wrapper is outdated
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The installed wrapper points to an old app location. Reinstall to link it to the
                    current version{cliVersion ? ` (v${cliVersion})` : ''}.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <LoadingButton
                  buttonState={cliInstallButtonState}
                  setButtonState={setCliInstallButtonState}
                  text={cliIsStale ? 'Reinstall CLI' : 'Install CLI'}
                  loadingText={cliIsStale ? 'Reinstalling...' : 'Installing...'}
                  successText={cliIsStale ? 'Reinstalled' : 'Installed'}
                  errorText="Retry"
                  reset
                  variant="default"
                  onClick={handleInstallCli}
                />
                {cliInstallMessage ? (
                  <p className="text-sm text-destructive">{cliInstallMessage}</p>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Install the{' '}
            <Link href="/downloads" className="text-foreground underline underline-offset-4">
              desktop app
            </Link>{' '}
            to install the CLI with one click. Or run{' '}
            <code className="rounded bg-muted px-1">npx overlord</code> from the project directory.
          </p>
        </div>
      )}
    </div>
  );
}
