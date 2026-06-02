'use client';

import { useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Accordion } from '@/components/ui/accordion';
import {
  getExecutionTargetAgentConfigsAction,
  updateExecutionTargetAgentConfigAction
} from '@/lib/actions/execution-target-agent-config';
import {
  type ExecutionTargetOwnership,
  getExecutionTargetOwnershipsAction,
  getUserExecutionTargetsWithDetailsAction,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';
import { type LaunchAgentType } from '@/lib/helpers/agent-types';
import { buildDirectAgentCommand } from '@/lib/overlord/launch-commands';
import {
  type AgentLaunchConfig,
  type AgentLaunchConfigUpdate,
  mergeAgentLaunchConfig,
  type TargetAgentConfigs
} from '@/lib/schemas/target-agent-config';

import { TargetAccordionItem } from './execution-targets/TargetAccordionItem';

export function ExecutionTargetsPage({
  open,
  onNavigate
}: {
  open: boolean;
  onNavigate?: (section: string) => void;
}) {
  const { api, isElectron } = useElectron();
  const [targets, setTargets] = useState<UserExecutionTargetDetailed[]>([]);
  const [ownerships, setOwnerships] = useState<Record<string, ExecutionTargetOwnership>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!open || !isElectron) return;
    void (async () => {
      try {
        const configs = await getExecutionTargetAgentConfigsAction();
        setTargetAgentConfigs(configs);
      } catch (err) {
        console.error('Failed to load execution target agent configs:', err);
      }
    })();
  }, [isElectron, open]);

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
      {!isElectron && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          Per-target terminal launch settings only apply when running the Overlord desktop app.
        </div>
      )}

      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Execution targets</h3>
        <p className="text-xs text-muted-foreground">
          Configure how Overlord opens each execution target. Settings are saved per target and per
          machine.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading execution targets…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : targets.length === 0 ? (
        <div className="rounded-md border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          You don&apos;t have any execution targets yet. Targets are created automatically when you
          launch an agent locally or add a remote SSH target to a project.
        </div>
      ) : (
        <Accordion type="multiple" className="rounded-md border" defaultValue={[targets[0]?.id]}>
          {targets.map(target => (
            <TargetAccordionItem
              key={target.id}
              target={target}
              api={api}
              isElectron={isElectron}
              ownership={ownerships[target.id]}
              onOwnershipChanged={loadOwnerships}
              onGetAgentConfig={currentAgentConfig}
              onSavePreCommand={handleSavePreCommand}
              onPreCommandInput={handlePreCommandInput}
              onAddFlag={handleAddFlag}
              onRemoveFlag={handleRemoveFlag}
              onBuildLocalAgentCommand={buildLocalAgentCommand}
              onNavigate={onNavigate}
            />
          ))}
        </Accordion>
      )}
    </div>
  );
}
