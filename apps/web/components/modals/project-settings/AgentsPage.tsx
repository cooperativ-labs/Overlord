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
  const [copied, setCopied] = useState(false);
  const [generateState, setGenerateState] = useState<ButtonLoadingState>('default');
  const [revokeState, setRevokeState] = useState<ButtonLoadingState>('default');
  const [message, setMessage] = useState<string | null>(null);

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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const hasToken = Boolean(tokenInfo);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Agent token</p>
        <p className="text-xs text-muted-foreground">
          Use an <code className="rounded bg-muted px-1">AGENT_TOKEN</code> as an alternative to
          OAuth when running agents in cloud environments like Claude. Set the token as an
          environment variable and Overlord will use it to authenticate and identify this project
          and your account automatically.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Set <code className="rounded bg-muted px-1">OVERLORD_AGENT_TOKEN</code> in your Claude
          environment settings. The token is scoped to this project — you must generate a separate
          token in each project&apos;s settings.
        </p>
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
              {copied ? (
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
