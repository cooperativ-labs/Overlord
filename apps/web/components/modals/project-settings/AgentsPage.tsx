'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  type AgentTokenInfo,
  generateProjectAgentTokenAction,
  getProjectAgentTokenInfoAction,
  revokeProjectAgentTokenAction
} from '@/lib/actions/project-agent-tokens';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const generateTokenWithRetry = withElectronActionRetry(generateProjectAgentTokenAction);
const revokeTokenWithRetry = withElectronActionRetry(revokeProjectAgentTokenAction);
const getTokenInfoWithRetry = withElectronActionRetry(getProjectAgentTokenInfoAction);

type AgentsPageProps = {
  projectId: string;
  open: boolean;
};

export function AgentsPage({ projectId, open }: AgentsPageProps) {
  const [tokenInfo, setTokenInfo] = useState<AgentTokenInfo | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [generateState, setGenerateState] = useState<ButtonLoadingState>('default');
  const [revokeState, setRevokeState] = useState<ButtonLoadingState>('default');
  const [message, setMessage] = useState<string | null>(null);
  const mcpUrl = 'https://www.ovld.ai/api/mcp';
  const allowedDomain = 'ovld.ai';
  const envBlock = newToken
    ? `OVERLORD_AGENT_TOKEN=${newToken}\nOVERLORD_MCP_URL=${mcpUrl}`
    : `OVERLORD_AGENT_TOKEN=<paste token>\nOVERLORD_MCP_URL=${mcpUrl}`;

  useEffect(() => {
    if (!open) return;
    setNewToken(null);
    setMessage(null);
    void getTokenInfoWithRetry(projectId).then(info => setTokenInfo(info));
  }, [open, projectId]);

  async function handleGenerate() {
    setGenerateState('loading');
    setMessage(null);
    try {
      const result = await generateTokenWithRetry(projectId);
      setTokenInfo(result.info);
      setNewToken(result.token);
      setGenerateState('success');
      setMessage('Token generated. Copy it now — it will not be shown again.');
    } catch (error) {
      setGenerateState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to generate token.');
    }
  }

  async function handleRevoke() {
    setRevokeState('loading');
    setMessage(null);
    try {
      await revokeTokenWithRetry(projectId);
      setTokenInfo(null);
      setNewToken(null);
      setRevokeState('success');
      setMessage('Token revoked.');
    } catch (error) {
      setRevokeState('error');
      setMessage(error instanceof Error ? error.message : 'Failed to revoke token.');
    }
  }

  async function handleCopy() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  }

  async function handleCopyField({ value, field }: { value: string; field: string }) {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  const hasToken = Boolean(tokenInfo);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Agent token</p>
        <p className="text-xs text-muted-foreground">
          An alternative to OAuth for agents running in cloud environments. Generate a token below.{' '}
          <strong>
            Note: The token is scoped to this project — generate a separate token in each
            project&apos;s settings.
          </strong>
        </p>
      </div>

      <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
        <p className="text-sm font-medium">Environment setup for Claude Code (Cloud)</p>
        <p className="text-xs text-muted-foreground">
          Claude allows you to configure custom environments for your agents to run in. Use the
          notes below to set up your agent environment.
        </p>

        <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
          <li>
            Set <span className="font-medium text-foreground">Name</span> to your project name
            (example: Overlord).
          </li>
          <li>
            Set <span className="font-medium text-foreground">Network access</span> to{' '}
            <span className="font-medium text-foreground">Custom</span>.
          </li>
          <li>
            Add <span className="font-medium text-foreground">Allowed domains</span>:{' '}
            <code className="rounded bg-muted px-1">ovld.ai</code> (wildcard optional:{' '}
            <code className="rounded bg-muted px-1">*.ovld.ai</code>).
          </li>
          <li>Add both environment variables exactly as shown below.</li>
        </ol>

        <div className="space-y-2">
          <div className="space-y-1 rounded-md border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-foreground">Allowed domain</p>
              <button
                type="button"
                onClick={() => void handleCopyField({ value: allowedDomain, field: 'domain' })}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {copiedField === 'domain' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code className="text-xs">{allowedDomain}</code>
          </div>

          <div className="space-y-1 rounded-md border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-foreground">OVERLORD_MCP_URL</p>
              <button
                type="button"
                onClick={() => void handleCopyField({ value: mcpUrl, field: 'mcp-url' })}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {copiedField === 'mcp-url' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code className="text-xs">{mcpUrl}</code>
          </div>

          <div className="space-y-1 rounded-md border bg-background p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-medium text-foreground">Environment variables block</p>
              <button
                type="button"
                onClick={() => void handleCopyField({ value: envBlock, field: 'env-block' })}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {copiedField === 'env-block' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
              {envBlock}
            </pre>
          </div>
        </div>
      </div>

      {newToken ? (
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Your new token</p>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="shrink-0 rounded p-1 hover:bg-muted"
              title="Copy token"
            >
              {copiedToken ? (
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
      ) : tokenInfo ? (
        <div className="space-y-1 rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">Active token</p>
          <p className="font-mono text-xs text-muted-foreground">
            {tokenInfo.tokenPrefix}
            <span className="opacity-50">••••••••••••••••••••••••••••••</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Created {new Date(tokenInfo.createdAt).toLocaleDateString()}
            {tokenInfo.lastUsedAt
              ? ` · Last used ${new Date(tokenInfo.lastUsedAt).toLocaleDateString()}`
              : ' · Never used'}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <LoadingButton
          buttonState={generateState}
          setButtonState={setGenerateState}
          text={hasToken ? 'Rotate token' : 'Generate token'}
          loadingText={hasToken ? 'Rotating…' : 'Generating…'}
          successText="Generated"
          errorText="Retry"
          reset
          size="sm"
          variant="outline"
          onClick={handleGenerate}
        />
        {hasToken && (
          <LoadingButton
            buttonState={revokeState}
            setButtonState={setRevokeState}
            text="Revoke"
            loadingText="Revoking…"
            successText="Revoked"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            onClick={handleRevoke}
          />
        )}
      </div>

      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
    </div>
  );
}
