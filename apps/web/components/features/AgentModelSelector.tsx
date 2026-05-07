'use client';

import { Check, Info } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getAllAgentConfigsAction,
  updateAgentModelPreferenceAction
} from '@/lib/actions/agent-config';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import {
  getUserLaunchPreferenceAction,
  updateUserLaunchAgentPreferenceAction
} from '@/lib/actions/user-launch-preference';
import {
  type AgentModelSelection,
  resolveAgentModelSelection,
  resolveAgentSelectionForAgent,
  type UserLaunchPreference
} from '@/lib/helpers/agent-model-preference';
import { AGENT_TYPES, type AgentTypeValue, LAUNCH_AGENT_VALUES } from '@/lib/helpers/agent-types';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { cn } from '@/lib/utils';

type AgentModelSelectorProps = {
  value: AgentModelSelection;
  onChange: (selection: AgentModelSelection) => void;
  onAgentSelect?: (agent: AgentTypeValue) => void;
  /** When true, renders inline (for settings page). When false, renders compact (for popover). */
  inline?: boolean;
};

const AGENT_MODEL_SELECTION_EVENT = 'overlord:agent-model-selection-changed';
type AgentModelSelectionEvent = { selection: AgentModelSelection; sourceId: string };
const DEFAULT_SELECTION: AgentModelSelection = {
  agent: 'claude',
  model: null,
  thinking: null
};
const AGENT_SELECTOR_VALUES = [...LAUNCH_AGENT_VALUES];

let cachedResolvedModels: AgentModel[] | null = null;
let cachedConfigs: Record<string, AgentConfig> | null = null;
let cachedLaunchPreference: UserLaunchPreference | null | undefined;
let cachedSelection: AgentModelSelection | null = null;

/**
 * Rendered in the app layout to pre-populate the model cache from a server-fetched list.
 * Sets the module-level cache synchronously during render so useAgentModels() sees it immediately.
 */
export function AgentModelsPrefetch({ models }: { models: AgentModel[] }) {
  if (cachedResolvedModels === null) {
    cachedResolvedModels = models;
  }
  return null;
}

/** Returns the agent model list, using module-level cache to avoid duplicate fetches. */
export function useAgentModels(): { models: AgentModel[]; loading: boolean } {
  const [models, setModels] = useState<AgentModel[]>(() => cachedResolvedModels ?? []);
  const [loading, setLoading] = useState(() => cachedResolvedModels === null);

  useEffect(() => {
    if (cachedResolvedModels !== null) return;
    let cancelled = false;
    getAgentModelsAction()
      .then(data => {
        if (!cancelled) {
          cachedResolvedModels = data;
          setModels(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading };
}

function DefaultTooltipLabel() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="truncate">Default</span>
          <Info aria-hidden className="h-3 w-3 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Last used in terminal</TooltipContent>
    </Tooltip>
  );
}

function CursorAutoTooltipLabel() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="truncate">Auto</span>
          <Info aria-hidden className="h-3 w-3 shrink-0" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Cursor picks the model automatically</TooltipContent>
    </Tooltip>
  );
}

function syncConfigsForSelection(
  current: Record<string, AgentConfig>,
  nextSelection: AgentModelSelection
): Record<string, AgentConfig> {
  return {
    ...current,
    [nextSelection.agent]: {
      ...(current[nextSelection.agent] ?? { flags: [] }),
      defaultModel: nextSelection.model ?? undefined,
      defaultThinking: nextSelection.model ? (nextSelection.thinking ?? undefined) : undefined
    }
  };
}

function broadcastAgentModelSelection(selection: AgentModelSelection, sourceId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<AgentModelSelectionEvent>(AGENT_MODEL_SELECTION_EVENT, {
      detail: { selection, sourceId }
    })
  );
}

export function AgentModelSelector({
  value,
  onChange,
  onAgentSelect,
  inline = false
}: AgentModelSelectorProps) {
  const { models, loading } = useAgentModels();

  const modelsByAgent = useMemo(() => {
    const grouped: Record<string, AgentModel[]> = {};
    for (const m of models) {
      if (!grouped[m.agent_type]) grouped[m.agent_type] = [];
      grouped[m.agent_type].push(m);
    }
    return grouped;
  }, [models]);

  const currentModels = modelsByAgent[value.agent] ?? [];
  const selectedModel = currentModels.find(m => m.model_id === value.model);
  const thinkingEnabled = value.agent !== 'codex';
  const thinkingOptions = thinkingEnabled ? (selectedModel?.thinking_options ?? []) : [];

  const handleAgentChange = useCallback(
    (agent: AgentTypeValue) => {
      if (onAgentSelect) {
        onAgentSelect(agent);
        return;
      }

      const newSelection: AgentModelSelection = { agent, model: null, thinking: null };
      onChange(newSelection);
      void updateUserLaunchAgentPreferenceAction(agent);
    },
    [onAgentSelect, onChange]
  );

  const handleModelChange = useCallback(
    (modelId: string | null) => {
      const newSelection: AgentModelSelection = {
        agent: value.agent,
        model: modelId,
        thinking: null
      };
      onChange(newSelection);
      void updateAgentModelPreferenceAction(value.agent, modelId, null);
    },
    [onChange, value.agent]
  );

  const handleThinkingChange = useCallback(
    (thinking: string | null) => {
      const newSelection: AgentModelSelection = {
        agent: value.agent,
        model: value.model,
        thinking
      };
      onChange(newSelection);
      void updateAgentModelPreferenceAction(value.agent, value.model, thinking);
    },
    [onChange, value.agent, value.model]
  );

  return (
    <div className={cn('flex gap-3', inline ? 'flex-col' : 'flex-row')}>
      {/* Agent column */}
      <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[110px]')}>
        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Agent
        </p>
        {AGENT_SELECTOR_VALUES.map(agentValue => {
          const agent = AGENT_TYPES.find(a => a.value === agentValue)!;
          const isSelected = value.agent === agentValue;
          return (
            <button
              key={agentValue}
              type="button"
              onClick={() => handleAgentChange(agentValue)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <Image
                  src={agent.icon}
                  alt={agent.label}
                  width={12}
                  height={12}
                  className={cn(agent.invertDark ? 'dark:invert' : '')}
                />
              </span>
              <span className="truncate">{agent.label}</span>
              {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Model column */}
      <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[160px]')}>
        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Model
        </p>
        <button
          type="button"
          onClick={() => handleModelChange(null)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
            value.model === null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          )}
        >
          <DefaultTooltipLabel />
          {value.model === null && <Check className="ml-auto h-3 w-3 shrink-0" />}
        </button>
        {value.agent === 'cursor' ? (
          <button
            type="button"
            onClick={() => handleModelChange('auto')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
              value.model === 'auto' ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
          >
            <CursorAutoTooltipLabel />
            {value.model === 'auto' && <Check className="ml-auto h-3 w-3 shrink-0" />}
          </button>
        ) : null}
        {currentModels.length > 0 ? (
          <div className="max-h-[220px] overflow-y-auto">
            {currentModels.map(m => {
              const isSelected = value.model === m.model_id;
              return (
                <button
                  key={m.model_id}
                  type="button"
                  onClick={() => handleModelChange(m.model_id)}
                  className={cn(
                    'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  )}
                >
                  <span className="truncate">{m.display_name}</span>
                  {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        ) : loading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading...</p>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No models available</p>
        )}
      </div>

      {/* Thinking column — only shown when a model with thinking options is selected */}
      {thinkingEnabled && thinkingOptions.length > 0 && (
        <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[90px]')}>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Thinking
          </p>
          <button
            type="button"
            onClick={() => handleThinkingChange(null)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
              value.thinking === null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
          >
            <span className="truncate text-muted-foreground">Default</span>
            {value.thinking === null && <Check className="ml-auto h-3 w-3 shrink-0" />}
          </button>
          {thinkingOptions.map(option => {
            const isSelected = value.thinking === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => handleThinkingChange(option)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs capitalize transition-colors',
                  isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                <span className="truncate">{option}</span>
                {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Hook to load the user's saved agent/model/thinking preference */
export function useAgentModelPreference(): {
  selection: AgentModelSelection;
  setSelection: (s: AgentModelSelection) => void;
  selectAgent: (agent: AgentTypeValue) => void;
  loaded: boolean;
} {
  const instanceId = useRef(Math.random().toString(36).slice(2));
  const [selection, setSelection] = useState<AgentModelSelection>(
    () => cachedSelection ?? DEFAULT_SELECTION
  );
  const [configs, setConfigs] = useState<Record<string, AgentConfig>>(() => cachedConfigs ?? {});
  const [launchPreference, setLaunchPreference] = useState<UserLaunchPreference | null>(
    () => cachedLaunchPreference ?? null
  );
  const [loaded, setLoaded] = useState(() => cachedSelection !== null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([getAllAgentConfigsAction(), getUserLaunchPreferenceAction()]).then(
      results => {
        if (cancelled) return;

        const configs =
          results[0].status === 'fulfilled'
            ? results[0].value
            : ({} as Record<string, AgentConfig>);
        const launchPreference = results[1].status === 'fulfilled' ? results[1].value : null;
        const resolvedSelection = resolveAgentModelSelection(configs, launchPreference);
        cachedConfigs = configs;
        cachedLaunchPreference = launchPreference;
        cachedSelection = resolvedSelection;
        setConfigs(configs);
        setLaunchPreference(launchPreference);
        setSelection(resolvedSelection);
        setLoaded(true);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    function handleSelectionChange(event: Event) {
      const { selection: nextSelection, sourceId } = (
        event as CustomEvent<AgentModelSelectionEvent>
      ).detail;
      // Skip events emitted by this same hook instance — state is already up to date
      if (sourceId === instanceId.current) return;
      cachedSelection = nextSelection;
      setSelection(nextSelection);
      setConfigs(current => {
        const nextConfigs = syncConfigsForSelection(current, nextSelection);
        cachedConfigs = nextConfigs;
        return nextConfigs;
      });
      cachedLaunchPreference = nextSelection;
      setLaunchPreference(nextSelection);
      setLoaded(true);
    }

    window.addEventListener(AGENT_MODEL_SELECTION_EVENT, handleSelectionChange);
    return () => {
      window.removeEventListener(AGENT_MODEL_SELECTION_EVENT, handleSelectionChange);
    };
  }, []);

  const updateSelection = useCallback((nextSelection: AgentModelSelection) => {
    cachedSelection = nextSelection;
    setSelection(nextSelection);
    setConfigs(current => {
      const nextConfigs = syncConfigsForSelection(current, nextSelection);
      cachedConfigs = nextConfigs;
      return nextConfigs;
    });
    cachedLaunchPreference = nextSelection;
    setLaunchPreference(nextSelection);
    setLoaded(true);
    broadcastAgentModelSelection(nextSelection, instanceId.current);
  }, []);

  const selectAgent = useCallback(
    (agent: AgentTypeValue) => {
      const nextSelection = resolveAgentSelectionForAgent(configs, agent, launchPreference);
      cachedSelection = nextSelection;
      setSelection(nextSelection);
      cachedLaunchPreference = nextSelection;
      setLaunchPreference(nextSelection);
      setLoaded(true);
      broadcastAgentModelSelection(nextSelection, instanceId.current);
      void updateUserLaunchAgentPreferenceAction(agent);
    },
    [configs, launchPreference]
  );

  return { selection, setSelection: updateSelection, selectAgent, loaded };
}
