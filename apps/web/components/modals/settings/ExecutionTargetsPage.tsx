'use client';

import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Accordion } from '@/components/ui/accordion';
import {
  getExecutionTargetAgentConfigsAction,
  updateExecutionTargetAgentConfigAction
} from '@/lib/actions/execution-target-agent-config';
import {
  getExecutionTargetTerminalProfilesAction,
  updateExecutionTargetTerminalProfileAction
} from '@/lib/actions/execution-target-terminal-profile';
import {
  type ExecutionTargetOwnership,
  getExecutionTargetOwnershipsAction,
  getUserExecutionTargetsWithDetailsAction,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';
import { type LaunchAgentType } from '@/lib/helpers/agent-types';
import {
  DEFAULT_RUNNER_TERMINAL_PROFILE,
  type RunnerTerminalProfile
} from '@/lib/helpers/runner-terminal-settings';
import { buildDirectAgentCommand } from '@/lib/overlord/launch-commands';
import {
  type AgentLaunchConfig,
  type AgentLaunchConfigUpdate,
  mergeAgentLaunchConfig,
  type TargetAgentConfigs
} from '@/lib/schemas/target-agent-config';

import { removeOrganizationFromOwnership } from './execution-targets/execution-targets-helpers';
import { TargetAccordionItem } from './execution-targets/TargetAccordionItem';

export function ExecutionTargetsPage({
  open,
  onNavigate
}: {
  open: boolean;
  onNavigate?: (section: string) => void;
}) {
  const { isElectron } = useElectron();
  const [targets, setTargets] = useState<UserExecutionTargetDetailed[]>([]);
  const [ownerships, setOwnerships] = useState<Record<string, ExecutionTargetOwnership>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [terminalProfiles, setTerminalProfiles] = useState<Record<string, RunnerTerminalProfile>>(
    {}
  );
  const [targetAgentConfigs, setTargetAgentConfigs] = useState<Record<string, TargetAgentConfigs>>(
    {}
  );

  const loadOwnerships = useCallback(() => {
    getExecutionTargetOwnershipsAction()
      .then(rows => {
        setOwnerships(Object.fromEntries(rows.map(row => [row.targetId, row])));
      })
      .catch(err => {
        console.error('Failed to load execution target ownership', err);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserExecutionTargetsWithDetailsAction()
      .then(rows => {
        if (cancelled) return;
        setTargets(rows);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load execution targets', err);
        setError(err instanceof Error ? err.message : 'Failed to load execution targets.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    loadOwnerships();
    return () => {
      cancelled = true;
    };
  }, [open, loadOwnerships]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const profiles = await getExecutionTargetTerminalProfilesAction();
        setTerminalProfiles(profiles);
      } catch (err) {
        console.error('Failed to load execution target terminal profiles:', err);
      }
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const configs = await getExecutionTargetAgentConfigsAction();
        setTargetAgentConfigs(configs);
      } catch (err) {
        console.error('Failed to load execution target agent configs:', err);
      }
    })();
  }, [open]);

  function currentTerminalProfile(targetId: string): RunnerTerminalProfile {
    return terminalProfiles[targetId] ?? DEFAULT_RUNNER_TERMINAL_PROFILE;
  }

  async function persistTerminalProfile(targetId: string, profile: RunnerTerminalProfile) {
    setTerminalProfiles(current => ({ ...current, [targetId]: profile }));
    try {
      const saved = await updateExecutionTargetTerminalProfileAction(targetId, profile);
      setTerminalProfiles(current => ({ ...current, [targetId]: saved }));
    } catch (err) {
      console.error('Failed to save execution target terminal profile:', err);
    }
  }

  function currentAgentConfig({
    targetId,
    agent
  }: {
    targetId: string;
    agent: string;
  }): AgentLaunchConfig {
    return targetAgentConfigs[targetId]?.[agent] ?? { flags: [] };
  }

  async function persistAgentConfig({
    targetId,
    agent,
    update
  }: {
    targetId: string;
    agent: string;
    update: AgentLaunchConfigUpdate;
  }) {
    setTargetAgentConfigs(current => {
      const forTarget = { ...(current[targetId] ?? {}) };
      const merged = mergeAgentLaunchConfig(forTarget[agent] ?? { flags: [] }, update);
      forTarget[agent] = merged;
      return { ...current, [targetId]: forTarget };
    });
    try {
      const saved = await updateExecutionTargetAgentConfigAction(targetId, agent, update);
      setTargetAgentConfigs(current => ({ ...current, [targetId]: saved }));
    } catch (err) {
      console.error('Failed to save target agent config:', err);
    }
  }

  function handleLabelChanged(targetId: string, newLabel: string) {
    setTargets(current => current.map(t => (t.id === targetId ? { ...t, label: newLabel } : t)));
  }

  function handleTargetDeleted(targetId: string, organizationId: number) {
    const existing = ownerships[targetId];
    if (!existing) return;

    const nextOwnership = removeOrganizationFromOwnership(existing, organizationId);
    if (!nextOwnership) {
      setOwnerships(current => {
        const next = { ...current };
        delete next[targetId];
        return next;
      });
      setTargets(current => current.filter(target => target.id !== targetId));
      return;
    }

    setOwnerships(current => ({ ...current, [targetId]: nextOwnership }));
  }

  async function handleAddFlag({
    targetId,
    selectedLocalAgent,
    flagInput
  }: {
    targetId: string;
    selectedLocalAgent: string;
    flagInput: string;
  }) {
    const flag = flagInput.trim();
    if (!flag || !targetId) return;
    const config = currentAgentConfig({ targetId, agent: selectedLocalAgent });
    if (!config.flags.includes(flag)) {
      await persistAgentConfig({
        targetId,
        agent: selectedLocalAgent,
        update: {
          ...config,
          flags: [...config.flags, flag]
        }
      });
    }
  }

  async function handleSavePreCommand({
    targetId,
    agent,
    value
  }: {
    targetId: string;
    agent: string;
    value: string;
  }) {
    if (!targetId) return;
    const trimmed = value.trim();
    await persistAgentConfig({
      targetId,
      agent,
      update: { preCommand: trimmed.length > 0 ? trimmed : null }
    });
  }

  async function handleRemoveFlag({
    targetId,
    agent,
    index
  }: {
    targetId: string;
    agent: string;
    index: number;
  }) {
    if (!targetId) return;
    const config = currentAgentConfig({ targetId, agent });
    await persistAgentConfig({
      targetId,
      agent,
      update: { ...config, flags: config.flags.filter((_, i) => i !== index) }
    });
  }

  function handlePreCommandInput({
    targetId,
    agent,
    value
  }: {
    targetId: string;
    agent: string;
    value: string;
  }) {
    if (!targetId) return;
    setTargetAgentConfigs(current => {
      const forTarget = { ...(current[targetId] ?? {}) };
      const config = forTarget[agent] ?? { flags: [] };
      forTarget[agent] = { ...config, preCommand: value };
      return { ...current, [targetId]: forTarget };
    });
  }

  function buildLocalAgentCommand({
    targetId,
    agent
  }: {
    targetId: string;
    agent: string;
  }): string {
    const config = currentAgentConfig({ targetId, agent });
    return buildDirectAgentCommand(agent as LaunchAgentType, {
      preCommand: config.preCommand,
      flags: config.flags
    });
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Execution targets</h3>
        <p className="text-xs text-muted-foreground">
          Configure how Overlord opens each execution target. Settings are saved per target and used
          when launches are pinned to that machine.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading execution targets…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : targets.length === 0 ? (
        <div className="rounded-md border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          <p className="mb-3">You don&apos;t have any execution targets yet.</p>
          <p className="mb-3">
            To set up an execution target, install the Overlord CLI and run{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">ovld setup</code> in
            your project directory. This registers your machine as an execution target and
            configures the agent connector.
          </p>
          <p>
            Install the CLI globally with npm:{' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              npm install -g overlord-cli
            </code>
          </p>
        </div>
      ) : (
        <Accordion
          type="multiple"
          className="rounded-md border border-border bg-muted/20 p-2"
          defaultValue={[targets[0]?.id]}
        >
          {targets.map(target => (
            <TargetAccordionItem
              key={target.id}
              target={target}
              isElectron={isElectron}
              ownership={ownerships[target.id]}
              onOwnershipChanged={loadOwnerships}
              terminalProfile={currentTerminalProfile(target.id)}
              onTerminalProfileChange={profile => void persistTerminalProfile(target.id, profile)}
              onLabelChanged={handleLabelChanged}
              onGetAgentConfig={currentAgentConfig}
              onSavePreCommand={handleSavePreCommand}
              onPreCommandInput={handlePreCommandInput}
              onAddFlag={handleAddFlag}
              onRemoveFlag={handleRemoveFlag}
              onBuildLocalAgentCommand={buildLocalAgentCommand}
              onNavigate={onNavigate}
              onDeleted={handleTargetDeleted}
            />
          ))}
        </Accordion>
      )}
    </div>
  );
}
