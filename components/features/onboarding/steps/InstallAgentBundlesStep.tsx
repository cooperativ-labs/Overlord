'use client';

import { Check, Download, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Props = {
  onContinue: () => void;
};

type BundleStatusEntry = {
  agent: 'claude' | 'codex';
  status: 'installed' | 'stale' | 'partial' | 'not_installed' | 'error';
  version: string | null;
  installedVersion: string | null;
  details: string;
};

const AGENTS: Array<BundleStatusEntry['agent']> = ['claude', 'codex'];

function statusBadge(status: BundleStatusEntry['status']) {
  if (status === 'installed') {
    return <Badge className="bg-green-600 text-xs text-white">Installed</Badge>;
  }
  if (status === 'stale') {
    return (
      <Badge variant="secondary" className="text-xs">
        Update available
      </Badge>
    );
  }
  if (status === 'partial') {
    return (
      <Badge variant="secondary" className="text-xs">
        Needs repair
      </Badge>
    );
  }
  if (status === 'not_installed') {
    return (
      <Badge variant="outline" className="text-xs">
        Not installed
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-xs">
      Error
    </Badge>
  );
}

export function InstallAgentBundlesStep({ onContinue }: Props) {
  const { isElectron } = useElectron();
  const [statuses, setStatuses] = useState<BundleStatusEntry[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const loadStatuses = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.agentBundle) return;
    const result = await window.electronAPI.agentBundle.getAllStatuses();
    setStatuses(result);
  }, [isElectron]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  const statusMap = useMemo(() => {
    const map = new Map<BundleStatusEntry['agent'], BundleStatusEntry>();
    for (const entry of statuses) {
      map.set(entry.agent, entry);
    }
    return map;
  }, [statuses]);

  async function install(agent: BundleStatusEntry['agent']) {
    if (!window.electronAPI?.agentBundle) return;
    setLoadingAction(`install:${agent}`);
    try {
      await window.electronAPI.agentBundle.install(agent);
      await loadStatuses();
    } finally {
      setLoadingAction(null);
    }
  }

  async function repair(agent: BundleStatusEntry['agent']) {
    if (!window.electronAPI?.agentBundle) return;
    setLoadingAction(`repair:${agent}`);
    try {
      await window.electronAPI.agentBundle.repair(agent);
      await loadStatuses();
    } finally {
      setLoadingAction(null);
    }
  }

  async function uninstall(agent: BundleStatusEntry['agent']) {
    if (!window.electronAPI?.agentBundle) return;
    setLoadingAction(`uninstall:${agent}`);
    try {
      await window.electronAPI.agentBundle.uninstall(agent);
      await loadStatuses();
    } finally {
      setLoadingAction(null);
    }
  }

  async function installAll() {
    if (!window.electronAPI?.agentBundle) return;
    setLoadingAction('install:all');
    try {
      await window.electronAPI.agentBundle.installAll();
      await loadStatuses();
    } finally {
      setLoadingAction(null);
    }
  }

  if (!isElectron) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Install agent plugins</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Install the Overlord workflow bundle for each local agent. This enables shorter prompts
          and durable permission notifications.
        </p>
      </div>

      <div className="space-y-2">
        {AGENTS.map(agent => {
          const entry = statusMap.get(agent) ?? {
            agent,
            status: 'not_installed' as const,
            version: null,
            installedVersion: null,
            details: 'Bundle not installed.'
          };
          const busy = loadingAction !== null;

          return (
            <div
              key={agent}
              className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3"
            >
              <div className="grid gap-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium capitalize">{agent}</p>
                  {statusBadge(entry.status)}
                </div>
                <p className="text-xs text-muted-foreground">{entry.details}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {(entry.status === 'not_installed' || entry.status === 'stale') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void install(agent)}
                    className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                    title={entry.status === 'stale' ? 'Update' : 'Install'}
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {(entry.status === 'partial' || entry.status === 'error') && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void repair(agent)}
                    className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                    title="Repair"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
                {entry.status === 'installed' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void uninstall(agent)}
                    className="rounded p-1.5 hover:bg-muted disabled:opacity-50"
                    title="Uninstall"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void installAll()}
          disabled={loadingAction !== null}
        >
          <Download className="h-4 w-4" />
          Install all
        </Button>
        <Button type="button" onClick={onContinue} disabled={loadingAction !== null}>
          <Check className="h-4 w-4" />
          Continue
        </Button>
      </div>
    </div>
  );
}
