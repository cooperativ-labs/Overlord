'use client';

import { Check, CheckCircle2, CircleAlert, Download, Loader2, Shield } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { AgentTypeValue } from '@/lib/helpers/agent-types';
import { AGENT_TYPES } from '@/lib/helpers/agent-types';

type Props = {
  onContinue: () => void;
  projectDirectory?: string;
};

type BundleAgent = 'claude' | 'opencode';
type SlashAgent = 'claude' | 'cursor' | 'gemini' | 'opencode';

/** What each agent connector includes. */
const AGENT_CONNECTOR_FEATURES: Record<
  AgentTypeValue,
  {
    bundle: boolean;
    service: boolean;
    slashCommands: boolean;
    permissions: boolean;
    details: string[];
  }
> = {
  claude: {
    bundle: true,
    service: false,
    slashCommands: true,
    permissions: true,
    details: [
      'Overlord skill (workflow protocol)',
      'Permission hook (auto-approve protocol calls)',
      'Settings merge (hooks config)',
      'Slash commands (/connect, /load, /spawn)',
      'Permission rules for ovld protocol & curl'
    ]
  },
  codex: {
    bundle: false,
    service: true,
    slashCommands: false,
    permissions: true,
    details: [
      'Home-local Overlord chat plugin with bundled Codex skill',
      'Legacy Codex bundle migration cleanup',
      'Permission prefix rules for ovld protocol & curl'
    ]
  },
  cursor: {
    bundle: false,
    service: false,
    slashCommands: true,
    permissions: true,
    details: [
      'Slash commands (/connect, /load, /spawn)',
      'Permission rules for ovld protocol & curl'
    ]
  },
  gemini: {
    bundle: false,
    service: false,
    slashCommands: true,
    permissions: true,
    details: [
      'Slash commands (/connect, /load, /spawn)',
      'TOML policy rules for ovld protocol & curl'
    ]
  },
  opencode: {
    bundle: true,
    service: false,
    slashCommands: true,
    permissions: true,
    details: [
      'AGENTS.md workflow instructions',
      'Slash commands (/connect, /load, /spawn)',
      'OpenCode config merge (instructions + bash permissions)'
    ]
  }
};

type InstallStatus = 'idle' | 'installing' | 'success' | 'error';

type AgentInstallState = {
  bundleStatus: 'idle' | 'installed' | 'not_installed' | 'stale' | 'partial' | 'error';
  slashStatus: 'idle' | 'installed' | 'not_installed' | 'partial';
  permissionsConfigured: boolean;
  installStatus: InstallStatus;
  error?: string;
};

export function ConnectorSetupStep({ onContinue, projectDirectory }: Props) {
  const { isElectron } = useElectron();
  const [selectedAgents, setSelectedAgents] = useState<Set<AgentTypeValue>>(
    new Set(['claude', 'codex', 'cursor', 'gemini', 'opencode'])
  );
  const [agentStates, setAgentStates] = useState<Record<AgentTypeValue, AgentInstallState>>({
    claude: {
      bundleStatus: 'idle',
      slashStatus: 'idle',
      permissionsConfigured: false,
      installStatus: 'idle'
    },
    codex: {
      bundleStatus: 'idle',
      slashStatus: 'idle',
      permissionsConfigured: false,
      installStatus: 'idle'
    },
    cursor: {
      bundleStatus: 'idle',
      slashStatus: 'idle',
      permissionsConfigured: false,
      installStatus: 'idle'
    },
    gemini: {
      bundleStatus: 'idle',
      slashStatus: 'idle',
      permissionsConfigured: false,
      installStatus: 'idle'
    },
    opencode: {
      bundleStatus: 'idle',
      slashStatus: 'idle',
      permissionsConfigured: false,
      installStatus: 'idle'
    }
  });
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [hasInstalled, setHasInstalled] = useState(false);

  const loadStatuses = useCallback(async () => {
    if (!isElectron) return;
    const api = window.electronAPI;
    if (!api) return;

    try {
      const [bundleStatuses, slashStatuses, pluginStatus] = await Promise.all([
        api.agentBundle?.getAllStatuses() ?? Promise.resolve([]),
        api.agentSlash?.getAllStatuses() ?? Promise.resolve([]),
        api.overlordPlugin?.getStatus() ?? Promise.resolve(null)
      ]);

      setAgentStates(prev => {
        const next = { ...prev };
        for (const bs of bundleStatuses) {
          if (next[bs.agent]) {
            next[bs.agent] = { ...next[bs.agent], bundleStatus: bs.status };
          }
        }
        for (const ss of slashStatuses) {
          if (next[ss.agent]) {
            next[ss.agent] = { ...next[ss.agent], slashStatus: ss.status };
          }
        }
        if (pluginStatus) {
          next.codex = {
            ...next.codex,
            bundleStatus:
              pluginStatus.status === 'installed'
                ? 'installed'
                : pluginStatus.status === 'stale'
                  ? 'stale'
                  : pluginStatus.status === 'partial'
                    ? 'partial'
                    : pluginStatus.status === 'error'
                      ? 'error'
                      : 'not_installed'
          };
        }
        return next;
      });
    } catch {
      // statuses unavailable — leave as idle
    }
  }, [isElectron]);

  useEffect(() => {
    void loadStatuses();
  }, [loadStatuses]);

  function toggleAgent(agent: AgentTypeValue) {
    setSelectedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) {
        next.delete(agent);
      } else {
        next.add(agent);
      }
      return next;
    });
  }

  async function installSelected() {
    if (!isElectron || !window.electronAPI) return;
    const api = window.electronAPI;
    const agents = Array.from(selectedAgents);
    if (agents.length === 0) return;

    setInstalling(true);
    setGlobalError(null);

    // Reset install status for selected agents
    setAgentStates(prev => {
      const next = { ...prev };
      for (const agent of agents) {
        next[agent] = { ...next[agent], installStatus: 'installing', error: undefined };
      }
      return next;
    });

    const errors: string[] = [];

    // Install bundles for bundle-capable agents
    const bundleAgents = agents.filter((a): a is BundleAgent => AGENT_CONNECTOR_FEATURES[a].bundle);
    for (const agent of bundleAgents) {
      try {
        if (api.agentBundle) {
          await api.agentBundle.install(agent);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bundle install failed';
        errors.push(`${agent} bundle: ${msg}`);
        setAgentStates(prev => ({
          ...prev,
          [agent]: { ...prev[agent], installStatus: 'error' as const, error: msg }
        }));
      }
    }

    // Install slash commands for slash-capable agents
    const slashAgents = agents.filter(
      (a): a is SlashAgent => AGENT_CONNECTOR_FEATURES[a].slashCommands
    );
    for (const agent of slashAgents) {
      try {
        if (api.agentSlash) {
          await api.agentSlash.install(agent);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Slash command install failed';
        errors.push(`${agent} slash: ${msg}`);
        setAgentStates(prev => ({
          ...prev,
          [agent]: { ...prev[agent], installStatus: 'error' as const, error: msg }
        }));
      }
    }

    if (agents.includes('codex')) {
      try {
        if (api.overlordPlugin) {
          const result = await api.overlordPlugin.install();
          setAgentStates(prev => ({
            ...prev,
            codex: {
              ...prev.codex,
              permissionsConfigured: result.ok,
              ...(result.ok ? {} : { error: result.error ?? 'Plugin install failed' })
            }
          }));
          if (!result.ok && result.error) {
            errors.push(`codex plugin: ${result.error}`);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Plugin install failed';
        errors.push(`codex plugin: ${msg}`);
        setAgentStates(prev => ({
          ...prev,
          codex: { ...prev.codex, installStatus: 'error' as const, error: msg }
        }));
      }
    }

    // Configure permissions for all selected agents
    try {
      if (api.agentPermissions) {
        const result = await api.agentPermissions.configure({ projectDirectory });
        for (const r of result.results) {
          if (agents.includes(r.agent)) {
            setAgentStates(prev => ({
              ...prev,
              [r.agent]: {
                ...prev[r.agent],
                permissionsConfigured: r.ok,
                ...(r.ok ? {} : { error: r.error ?? 'Permission config failed' })
              }
            }));
            if (!r.ok && r.error) {
              errors.push(`${r.agent} permissions: ${r.error}`);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Permission config failed';
      errors.push(`permissions: ${msg}`);
    }

    // Mark successes
    setAgentStates(prev => {
      const next = { ...prev };
      for (const agent of agents) {
        if (next[agent].installStatus === 'installing') {
          next[agent] = { ...next[agent], installStatus: 'success' };
        }
      }
      return next;
    });

    if (errors.length > 0) {
      setGlobalError(`Some installations had issues: ${errors.join('; ')}`);
    }

    // Refresh statuses
    await loadStatuses();
    setInstalling(false);
    setHasInstalled(true);
  }

  const anySelected = selectedAgents.size > 0;

  if (!isElectron) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Set up agent connectors</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose which agents to connect with Overlord. Each connector installs plugins, slash
          commands, and permission rules so agents can work with your tickets seamlessly.
        </p>
      </div>

      <Alert>
        <Shield className="h-4 w-4" />
        <AlertDescription>
          Connectors append to your existing agent config files. Originals are backed up
          automatically. You can uninstall at any time from Settings.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        {AGENT_TYPES.map(agentType => {
          const features = AGENT_CONNECTOR_FEATURES[agentType.value];
          const state = agentStates[agentType.value];
          const isSelected = selectedAgents.has(agentType.value);
          const isInstalled =
            state.installStatus === 'success' ||
            (features.service && state.bundleStatus === 'installed' && !features.slashCommands) ||
            (features.bundle && state.bundleStatus === 'installed' && !features.slashCommands) ||
            (features.slashCommands &&
              state.slashStatus === 'installed' &&
              !features.bundle &&
              !features.service) ||
            (features.bundle &&
              state.bundleStatus === 'installed' &&
              features.slashCommands &&
              state.slashStatus === 'installed');

          return (
            <div
              key={agentType.value}
              className={`rounded-lg border p-4 transition-colors ${
                isSelected ? 'border-primary/50 bg-primary/5' : 'bg-muted/20'
              }`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id={`agent-${agentType.value}`}
                  checked={isSelected}
                  onCheckedChange={() => toggleAgent(agentType.value)}
                  disabled={installing}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`agent-${agentType.value}`}
                      className="text-sm font-semibold cursor-pointer"
                    >
                      {agentType.label}
                    </label>
                    {isInstalled && (
                      <Badge className="bg-green-600 text-xs text-white">
                        <Check className="mr-0.5 h-3 w-3" />
                        Installed
                      </Badge>
                    )}
                    {state.installStatus === 'installing' && (
                      <Badge variant="secondary" className="text-xs">
                        <Loader2 className="mr-0.5 h-3 w-3 animate-spin" />
                        Installing
                      </Badge>
                    )}
                    {state.installStatus === 'error' && (
                      <Badge variant="destructive" className="text-xs">
                        Error
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {features.bundle && (
                      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                        Workflow bundle
                      </span>
                    )}
                    {features.service && (
                      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                        Chat plugin
                      </span>
                    )}
                    {features.slashCommands && (
                      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                        Slash commands
                      </span>
                    )}
                    {features.permissions && (
                      <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
                        Permissions
                      </span>
                    )}
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {features.details.map(detail => (
                      <li
                        key={detail}
                        className="text-muted-foreground text-xs flex items-start gap-1.5"
                      >
                        <span className="text-muted-foreground/60 mt-0.5">·</span>
                        {detail}
                      </li>
                    ))}
                  </ul>
                  {state.error && <p className="text-destructive text-xs mt-1">{state.error}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {globalError && (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertDescription>{globalError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!anySelected || installing}
          onClick={() => void installSelected()}
        >
          {installing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Installing…
            </>
          ) : hasInstalled ? (
            <>
              <Download className="h-4 w-4" />
              Reinstall selected
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              Install selected
            </>
          )}
        </Button>
        <Button
          type="button"
          variant={hasInstalled ? 'default' : 'ghost'}
          onClick={onContinue}
          disabled={installing}
          className={hasInstalled ? '' : 'text-muted-foreground'}
        >
          <CheckCircle2 className="h-4 w-4" />
          {hasInstalled ? 'Continue' : 'Skip for now'}
        </Button>
      </div>
    </div>
  );
}
