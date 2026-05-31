'use client';

import { Bot, Check, Info } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentIcon } from '@/components/features/AgentIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getAllAgentConfigsAction,
  updateAgentModelPreferenceAction
} from '@/lib/actions/agent-config';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import {
  getUserLaunchPreferenceAction,
  updateUserLaunchAgentPreferenceAction,
  upsertUserLaunchPreferenceAction
} from '@/lib/actions/user-launch-preference';
import {
  type AgentModelSelection,
  resolveAgentModelSelection,
  resolveAgentSelectionForAgent,
  type UserLaunchPreference
} from '@/lib/helpers/agent-model-preference';
import { AGENT_TYPES, type LaunchAgentType } from '@/lib/helpers/agent-types';
import { getModelPlaceholder, getThinkingPlaceholder } from '@/lib/helpers/custom-agent';
import {
  type AgentConfig,
  CUSTOM_AGENTS_CONFIG_KEY,
  type CustomAgent
} from '@/lib/schemas/agent-config';
import { cn } from '@/lib/utils';

type AgentModelSelectorProps = {
  value: AgentModelSelection;
  onChange: (selection: AgentModelSelection) => void;
  onAgentSelect?: (agent: LaunchAgentType) => void;
  /** When true, renders inline (for settings page). When false, renders compact (for popover). */
  inline?: boolean;
  /** Marketing/demo surfaces: UI only, no preference persistence. */
  demo?: boolean;
  /** When set, uses this catalog instead of the fetched/offered-models cache. */
  catalogModels?: AgentModel[];
  /**
   * User agent configs (visibility + custom agents). Defaults to the module
   * cache populated by AgentModelsPrefetch. Pass explicitly from the settings
   * page so visibility toggles re-render the selector immediately.
   */
  userConfigs?: Record<string, AgentConfig>;
};

const AGENT_MODEL_SELECTION_EVENT = 'overlord:agent-model-selection-changed';
type AgentModelSelectionEvent = { selection: AgentModelSelection; sourceId: string };
const DEFAULT_SELECTION: AgentModelSelection = {
  agent: 'claude',
  model: null,
  thinking: null
};
export const AGENT_MODEL_OPTIONS = AGENT_TYPES;

let cachedResolvedModels: AgentModel[] | null = null;
let cachedConfigs: Record<string, AgentConfig> | null = null;
let cachedLaunchPreference: UserLaunchPreference | null | undefined;
let cachedSelection: AgentModelSelection | null = null;

/**
 * Rendered in the app layout to pre-populate every module-level cache from server-fetched data.
 * Runs synchronously during render so all hooks see populated caches immediately and never
 * need to hit the server again during the session. After this, the cache is the source of truth:
 * user actions update it directly, broadcasts sync it across components, and the fire-and-forget
 * server saves never feed back into client state.
 */
export function seedAgentModelsCache(models: AgentModel[]): void {
  if (models.length > 0) {
    cachedResolvedModels = models;
  }
}

export function AgentModelsPrefetch({
  models,
  configs,
  launchPreference
}: {
  models: AgentModel[];
  configs: Record<string, AgentConfig>;
  launchPreference: UserLaunchPreference | null;
}) {
  seedAgentModelsCache(models);
  if (cachedResolvedModels === null) {
    cachedResolvedModels = models;
  }
  if (cachedSelection === null) {
    cachedConfigs = configs;
    cachedLaunchPreference = launchPreference;
    cachedSelection = resolveAgentModelSelection(configs, launchPreference);
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

export function getAgentThinkingLabel(agent: LaunchAgentType): 'Thinking' | 'Effort' {
  return agent === 'codex' ? 'Effort' : 'Thinking';
}

export function supportsBuiltInThinkingSelection(
  agent: LaunchAgentType,
  antigravityManagesModels: boolean
): boolean {
  return !antigravityManagesModels && agent !== 'cursor';
}

function syncConfigsForSelection(
  current: Record<string, AgentConfig>,
  nextSelection: AgentModelSelection
): Record<string, AgentConfig> {
  // Custom-agent selections don't map to a built-in agent config row.
  if (nextSelection.customAgentId) return current;
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
  inline = false,
  demo = false,
  catalogModels,
  userConfigs
}: AgentModelSelectorProps) {
  const { models: fetchedModels, loading: fetchedLoading } = useAgentModels();
  const models = catalogModels ?? fetchedModels;
  const loading = catalogModels ? false : fetchedLoading;

  // Visibility + custom agents come from the user's saved configs. In demo mode
  // everything stays visible and nothing persists.
  const configs = demo ? {} : (userConfigs ?? cachedConfigs ?? {});
  const customAgents: CustomAgent[] = demo
    ? []
    : (configs[CUSTOM_AGENTS_CONFIG_KEY]?.customAgents ?? []);
  const selectedCustomAgent = value.customAgentId
    ? (customAgents.find(agent => agent.id === value.customAgentId) ?? null)
    : null;

  const modelsByAgent = useMemo(() => {
    const grouped: Record<string, AgentModel[]> = {};
    for (const m of models) {
      if (!grouped[m.agent_type]) grouped[m.agent_type] = [];
      grouped[m.agent_type].push(m);
    }
    return grouped;
  }, [models]);

  // Built-in agents the user has not hidden (the currently selected one always shows).
  const visibleBuiltInAgents = AGENT_MODEL_OPTIONS.filter(
    agent => !configs[agent.value]?.hidden || value.agent === agent.value
  );

  const hiddenModelsForAgent = configs[value.agent]?.hiddenModels ?? [];
  const antigravityManagesModels = !selectedCustomAgent && value.agent === 'antigravity';
  const currentModels =
    antigravityManagesModels || selectedCustomAgent
      ? []
      : (modelsByAgent[value.agent] ?? []).filter(m => !hiddenModelsForAgent.includes(m.model_id));
  const selectedModel = currentModels.find(m => m.model_id === value.model);

  const customModelPlaceholder = selectedCustomAgent
    ? getModelPlaceholder(selectedCustomAgent)
    : null;
  const customThinkingPlaceholder = selectedCustomAgent
    ? getThinkingPlaceholder(selectedCustomAgent)
    : null;

  const thinkingEnabled = selectedCustomAgent
    ? Boolean(customThinkingPlaceholder)
    : supportsBuiltInThinkingSelection(value.agent, antigravityManagesModels);
  const thinkingOptions = selectedCustomAgent
    ? (customThinkingPlaceholder?.options.map(option => option.value) ?? [])
    : thinkingEnabled
      ? (selectedModel?.thinking_options ?? [])
      : [];

  const handleAgentChange = useCallback(
    (agent: LaunchAgentType) => {
      if (onAgentSelect) {
        onAgentSelect(agent);
        return;
      }

      const newSelection: AgentModelSelection = {
        agent,
        model: null,
        thinking: null,
        customAgentId: null
      };
      onChange(newSelection);
      if (!demo) {
        void updateUserLaunchAgentPreferenceAction(agent);
      }
    },
    [demo, onAgentSelect, onChange]
  );

  const handleCustomAgentSelect = useCallback(
    (customAgent: CustomAgent) => {
      const newSelection: AgentModelSelection = {
        agent: value.agent,
        model: null,
        thinking: null,
        customAgentId: customAgent.id
      };
      onChange(newSelection);
      if (!demo) {
        void upsertUserLaunchPreferenceAction({
          agent: customAgent.id as AgentModelSelection['agent'],
          model: null,
          thinking: null
        });
      }
    },
    [demo, onChange, value.agent]
  );

  const handleModelChange = useCallback(
    (modelId: string | null) => {
      const newSelection: AgentModelSelection = {
        agent: value.agent,
        model: modelId,
        thinking: null,
        customAgentId: value.customAgentId ?? null
      };
      onChange(newSelection);
      if (demo) return;
      if (value.customAgentId) {
        void upsertUserLaunchPreferenceAction({
          agent: value.customAgentId as AgentModelSelection['agent'],
          model: modelId,
          thinking: null
        });
      } else {
        void updateAgentModelPreferenceAction(value.agent, modelId, null);
      }
    },
    [demo, onChange, value.agent, value.customAgentId]
  );

  const handleThinkingChange = useCallback(
    (thinking: string | null) => {
      const newSelection: AgentModelSelection = {
        agent: value.agent,
        model: value.model,
        thinking,
        customAgentId: value.customAgentId ?? null
      };
      onChange(newSelection);
      if (demo) return;
      if (value.customAgentId) {
        void upsertUserLaunchPreferenceAction({
          agent: value.customAgentId as AgentModelSelection['agent'],
          model: value.model,
          thinking
        });
      } else {
        void updateAgentModelPreferenceAction(value.agent, value.model, thinking);
      }
    },
    [demo, onChange, value.agent, value.model, value.customAgentId]
  );

  return (
    <div className={cn('flex gap-3', inline ? 'flex-col' : 'flex-row')}>
      {/* Agent column */}
      <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[110px]')}>
        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Agent
        </p>
        {visibleBuiltInAgents.map(agent => {
          const isSelected = !selectedCustomAgent && value.agent === agent.value;
          return (
            <button
              key={agent.value}
              type="button"
              onClick={() => handleAgentChange(agent.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <AgentIcon agentType={agent} size={12} />
              </span>
              <span className="truncate">{agent.label}</span>
              {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
            </button>
          );
        })}
        {customAgents.map(customAgent => {
          const isSelected = value.customAgentId === customAgent.id;
          return (
            <button
              key={customAgent.id}
              type="button"
              onClick={() => handleCustomAgentSelect(customAgent)}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <Bot className="h-3 w-3" aria-hidden />
              </span>
              <span className="truncate">{customAgent.name}</span>
              {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Model column */}
      <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[160px]')}>
        <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {selectedCustomAgent ? (customModelPlaceholder?.label ?? 'Model') : 'Model'}
        </p>
        {selectedCustomAgent ? (
          customModelPlaceholder && customModelPlaceholder.options.length > 0 ? (
            <div className="max-h-[220px] overflow-y-auto">
              {customModelPlaceholder.options.map(option => {
                const isSelected = value.model === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleModelChange(option.value)}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                      isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
              This agent has no model options.
            </p>
          )
        ) : antigravityManagesModels ? (
          <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
            Antigravity chooses models in its own UI.
          </p>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Thinking column — only shown when a model with thinking options is selected */}
      {thinkingEnabled && thinkingOptions.length > 0 && (
        <div className={cn('flex flex-col gap-0.5', inline ? 'w-full' : 'min-w-[90px]')}>
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {selectedCustomAgent
              ? (customThinkingPlaceholder?.label ?? 'Thinking')
              : getAgentThinkingLabel(value.agent)}
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
  selectAgent: (agent: LaunchAgentType) => void;
  configs: Record<string, AgentConfig>;
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
    // Cache is populated by AgentModelsPrefetch in the app layout. Skip fetching when it's
    // already there — re-fetching here would race against in-flight fire-and-forget saves and
    // can overwrite the user's just-clicked selection with stale server state.
    if (cachedSelection !== null) return;

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
    (agent: LaunchAgentType) => {
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

  return { selection, setSelection: updateSelection, selectAgent, configs, loaded };
}
