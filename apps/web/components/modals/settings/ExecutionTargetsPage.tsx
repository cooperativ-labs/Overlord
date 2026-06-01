'use client';

import { ArrowRight, Check, Copy, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  getExecutionTargetAgentConfigsAction,
  updateExecutionTargetAgentConfigAction
} from '@/lib/actions/execution-target-agent-config';
import {
  getUserExecutionTargetsAction,
  getUserExecutionTargetsWithDetailsAction,
  type UserExecutionTarget,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';
import { type LaunchAgentType } from '@/lib/helpers/agent-types';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import { buildDirectAgentCommand } from '@/lib/overlord/launch-commands';
import {
  type AgentLaunchConfig,
  type AgentLaunchConfigUpdate,
  mergeAgentLaunchConfig,
  type TargetAgentConfigs
} from '@/lib/schemas/target-agent-config';

import { AgentNameWithLogo } from './execution-targets/AgentNameWithLogo';
import { AGENT_LABELS, AGENTS } from './execution-targets/execution-targets-helpers';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedLocalAgent, setSelectedLocalAgent] = useState<LaunchAgentType>('claude');
  const [localTargets, setLocalTargets] = useState<UserExecutionTarget[]>([]);
  const [selectedLocalTargetId, setSelectedLocalTargetId] = useState<string>('');
  const [targetAgentConfigs, setTargetAgentConfigs] = useState<Record<string, TargetAgentConfigs>>(
    {}
  );
  const [flagInput, setFlagInput] = useState('');
  const { copied: commandCopied, copy: copyCommand } = useCopyToClipboard();

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
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !isElectron) return;
    void (async () => {
      try {
        const [lt, configs] = await Promise.all([
          getUserExecutionTargetsAction(),
          getExecutionTargetAgentConfigsAction()
        ]);
        setLocalTargets(lt);
        setTargetAgentConfigs(configs);
        setSelectedLocalTargetId(current =>
          current && lt.some(t => t.id === current) ? current : (lt[0]?.id ?? '')
        );
      } catch (err) {
        console.error('Failed to load execution target agent configs:', err);
      }
    })();
  }, [isElectron, open]);

  function currentAgentConfig(targetId: string, agent: string): AgentLaunchConfig {
    return targetAgentConfigs[targetId]?.[agent] ?? { flags: [] };
  }

  async function persistAgentConfig(agent: string, update: AgentLaunchConfigUpdate) {
    const targetId = selectedLocalTargetId;
    if (!targetId) return;
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

  async function handleAddFlag() {
    const flag = flagInput.trim();
    if (!flag || !selectedLocalTargetId) return;
    const config = currentAgentConfig(selectedLocalTargetId, selectedLocalAgent);
    if (!config.flags.includes(flag)) {
      await persistAgentConfig(selectedLocalAgent, {
        ...config,
        flags: [...config.flags, flag]
      });
    }
    setFlagInput('');
  }

  async function handleSavePreCommand(agent: string, value: string) {
    if (!selectedLocalTargetId) return;
    const trimmed = value.trim();
    await persistAgentConfig(agent, {
      preCommand: trimmed.length > 0 ? trimmed : null
    });
  }

  async function handleRemoveFlag(agent: string, index: number) {
    if (!selectedLocalTargetId) return;
    const config = currentAgentConfig(selectedLocalTargetId, agent);
    await persistAgentConfig(agent, {
      ...config,
      flags: config.flags.filter((_, i) => i !== index)
    });
  }

  function handlePreCommandInput(agent: string, value: string) {
    const targetId = selectedLocalTargetId;
    if (!targetId) return;
    setTargetAgentConfigs(current => {
      const forTarget = { ...(current[targetId] ?? {}) };
      const config = forTarget[agent] ?? { flags: [] };
      forTarget[agent] = { ...config, preCommand: value };
      return { ...current, [targetId]: forTarget };
    });
  }

  function buildLocalAgentCommand(agent: string): string {
    const config = currentAgentConfig(selectedLocalTargetId, agent);
    return buildDirectAgentCommand(agent as LaunchAgentType, {
      preCommand: config.preCommand,
      flags: config.flags
    });
  }

  async function handleCopyCommand() {
    await copyCommand(buildLocalAgentCommand(selectedLocalAgent));
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
        <Accordion type="multiple" className="rounded-md border">
          {targets.map(target => (
            <TargetAccordionItem
              key={target.id}
              target={target}
              api={api}
              isElectron={isElectron}
            />
          ))}
        </Accordion>
      )}

      {isElectron ? (
        <div className="rounded-md border px-3 py-3 grid gap-4">
          <div className="grid gap-1">
            <p className="text-sm font-medium">Local agent configuration</p>
            <p className="text-xs text-muted-foreground">
              These settings apply to agents launched from Overlord on the selected execution
              target, so you can customize how Overlord starts each local agent per target.
            </p>
          </div>
          <div className="grid gap-4">
            {localTargets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No execution targets yet. Launch an agent locally (or add a remote SSH target to a
                project) to create one, then configure its launch flags here.
              </p>
            ) : (
              <Select value={selectedLocalTargetId} onValueChange={setSelectedLocalTargetId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select execution target" />
                </SelectTrigger>
                <SelectContent>
                  {localTargets.map(target => (
                    <SelectItem key={target.id} value={target.id}>
                      {target.label}
                      {target.hostname ? ` · ${target.hostname}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select
              value={selectedLocalAgent}
              onValueChange={value => setSelectedLocalAgent(value as LaunchAgentType)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select agent" />
              </SelectTrigger>
              <SelectContent>
                {AGENTS.map(agent => (
                  <SelectItem key={agent} value={agent}>
                    <AgentNameWithLogo agent={agent} label={AGENT_LABELS[agent] ?? agent} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Pre-command</label>
                <input
                  type="text"
                  placeholder="e.g., ollama or agent-pod"
                  value={
                    currentAgentConfig(selectedLocalTargetId, selectedLocalAgent).preCommand ?? ''
                  }
                  onChange={e => handlePreCommandInput(selectedLocalAgent, e.target.value)}
                  onBlur={e => void handleSavePreCommand(selectedLocalAgent, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleSavePreCommand(selectedLocalAgent, e.currentTarget.value);
                    }
                  }}
                  className="w-full rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-[11px] text-muted-foreground">
                  Runs in your shell before the agent binary, wrapping it — e.g.{' '}
                  <code className="rounded bg-muted px-1">ollama</code> launches{' '}
                  <code className="rounded bg-muted px-1">ollama {selectedLocalAgent} …</code>
                </p>
                {currentAgentConfig(selectedLocalTargetId, selectedLocalAgent).preCommand ? (
                  <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 p-2.5 dark:bg-yellow-900/10">
                    <p className="text-[11px] text-yellow-800 dark:text-yellow-300">
                      If this command runs inside a container, make sure{' '}
                      <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                        overlord-cli
                      </code>{' '}
                      is installed{' '}
                      <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                        npm install -g overlord-cli
                      </code>{' '}
                      there so agents can communicate with Overlord. We recommend generating a token
                      and using the{' '}
                      <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                        ovld auth login --token {`<oat…>`}
                      </code>{' '}
                      command to persist it in your environment.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 w-fit"
                      onClick={() => onNavigate?.('Agent Tokens')}
                    >
                      Manage agent tokens
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">Command flags</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g., --enable-auto-mode"
                    value={flagInput}
                    onChange={e => setFlagInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddFlag();
                      }
                    }}
                    className="flex-1 rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddFlag()}
                    className="rounded border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80"
                  >
                    Add
                  </button>
                </div>
              </div>
              {currentAgentConfig(selectedLocalTargetId, selectedLocalAgent).flags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {currentAgentConfig(selectedLocalTargetId, selectedLocalAgent).flags.map(
                      (flag, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1"
                        >
                          <code className="text-xs font-medium">{flag}</code>
                          <button
                            type="button"
                            onClick={() => void handleRemoveFlag(selectedLocalAgent, index)}
                            className="rounded p-0.5 hover:bg-muted-foreground/20"
                            title="Remove flag"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">Command</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand()}
                    className="shrink-0 rounded p-1 hover:bg-muted"
                    title="Copy command"
                  >
                    {commandCopied ? (
                      <Check className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                  {buildLocalAgentCommand(selectedLocalAgent)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
