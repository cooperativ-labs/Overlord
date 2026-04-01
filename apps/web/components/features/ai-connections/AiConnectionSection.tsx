'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import type { AiConnectionStatus, AiProvider, AiUsageData } from '@/lib/actions/ai-connections';
import {
  disconnectAiProvider,
  getAiConnectionStatus,
  getAiUsage
} from '@/lib/actions/ai-connections';

type Props = {
  provider: AiProvider;
  title: string;
  description: string;
  connectHref: string;
  open: boolean;
};

function formatResetTime(iso: string | null): string {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'soon';
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24);
    return `in ${days}d ${diffHours % 24}h`;
  }
  if (diffHours > 0) return `in ${diffHours}h ${diffMins}m`;
  return `in ${diffMins}m`;
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs tabular-nums">
        <span>{used} used</span>
        {limit !== null ? <span>{limit} limit</span> : null}
        {pct !== null ? <span className="text-muted-foreground">{pct}%</span> : null}
      </div>
      {pct !== null ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function UsageSection({ usage }: { usage: AiUsageData }) {
  const hasUsage = usage.fiveHour || usage.sevenDay;
  if (!hasUsage) {
    return <p className="text-muted-foreground text-xs">No usage data available.</p>;
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      {usage.plan ? (
        <p className="text-xs">
          Plan: <span className="font-medium capitalize">{usage.plan}</span>
        </p>
      ) : null}

      {usage.fiveHour ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">5-hour window</p>
          <UsageBar used={usage.fiveHour.used} limit={usage.fiveHour.limit} />
          <p className="text-muted-foreground text-xs">
            Resets {formatResetTime(usage.fiveHour.resetsAt)}
          </p>
        </div>
      ) : null}

      {usage.sevenDay ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Weekly window</p>
          <UsageBar used={usage.sevenDay.used} limit={usage.sevenDay.limit} />
          <p className="text-muted-foreground text-xs">
            Resets {formatResetTime(usage.sevenDay.resetsAt)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AiConnectionSection({ provider, title, description, connectHref, open }: Props) {
  const [status, setStatus] = useState<AiConnectionStatus | null>(null);
  const [usage, setUsage] = useState<AiUsageData | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [disconnectState, setDisconnectState] = useState<ButtonLoadingState>('default');

  const loadStatus = useCallback(async () => {
    try {
      const s = await getAiConnectionStatus(provider);
      setStatus(s);
    } catch {
      setStatus({ connected: false, updatedAt: null });
    } finally {
      setStatusLoaded(true);
    }
  }, [provider]);

  const loadUsage = useCallback(async () => {
    setUsageError(null);
    try {
      const u = await getAiUsage(provider);
      setUsage(u);
    } catch (err) {
      setUsageError(err instanceof Error ? err.message : 'Failed to load usage.');
    }
  }, [provider]);

  useEffect(() => {
    if (!open) return;
    setStatusLoaded(false);
    setUsage(null);
    setUsageError(null);
    loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (status?.connected) {
      loadUsage();
    }
  }, [status?.connected, loadUsage]);

  async function handleDisconnect() {
    setDisconnectState('loading');
    try {
      await disconnectAiProvider(provider);
      setStatus({ connected: false, updatedAt: null });
      setUsage(null);
      setDisconnectState('default');
    } catch {
      setDisconnectState('error');
    }
  }

  return (
    <section className="max-w-2xl space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      {!statusLoaded ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : status?.connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-emerald-700">
              Connected
              {status.updatedAt
                ? ` — since ${new Date(status.updatedAt).toLocaleDateString()}`
                : ''}
            </span>
            <LoadingButton
              buttonState={disconnectState}
              setButtonState={setDisconnectState}
              text="Disconnect"
              loadingText="Disconnecting…"
              errorText="Retry"
              onClick={handleDisconnect}
              variant="outline"
              size="sm"
            />
          </div>

          {usageError ? (
            <p className="text-xs text-destructive">{usageError}</p>
          ) : usage ? (
            <UsageSection usage={usage} />
          ) : (
            <p className="text-muted-foreground text-xs">Loading usage…</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs">Not connected.</p>
          <Button asChild size="sm">
            <a href={connectHref}>Connect {title}</a>
          </Button>
        </div>
      )}
    </section>
  );
}
