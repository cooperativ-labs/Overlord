'use client';

import { Check } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  getAllAgentConfigsAction,
  updateAgentModelPreferenceAction
} from '@/lib/actions/agent-config';
import { type AgentModel, getAgentModelsAction } from '@/lib/actions/agent-models';
import { AGENT_TYPES, type AgentTypeValue, LAUNCH_AGENT_VALUES } from '@/lib/helpers/agent-types';
import type { AgentConfig } from '@/lib/schemas/agent-config';
import { cn } from '@/lib/utils';

export type AgentModelSelection = {
  agent: AgentTypeValue;
  model: string | null;
  thinking: string | null;
};

type AgentModelSelectorProps = {
  value: AgentModelSelection;
  onChange: (selection: AgentModelSelection) => void;
  /** When true, renders inline (for settings page). When false, renders compact (for popover). */
  inline?: boolean;
};

export function AgentModelSelector({ value, onChange, inline = false }: AgentModelSelectorProps) {
  const [models, setModels] = useState<AgentModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAgentModelsAction()
      .then(data => {
        if (!cancelled) {
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
  const thinkingOptions = selectedModel?.thinking_options ?? [];

  const handleAgentChange = useCallback(
    (agent: AgentTypeValue) => {
      const newSelection: AgentModelSelection = { agent, model: null, thinking: null };
      onChange(newSelection);
      void updateAgentModelPreferenceAction(agent, null, null);
    },
    [onChange]
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
      <div className={cn('flex flex-col gap-1', inline ? 'w-full' : 'min-w-[120px]')}>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Agent
        </p>
        {LAUNCH_AGENT_VALUES.map(agentValue => {
          const agent = AGENT_TYPES.find(a => a.value === agentValue)!;
          const isSelected = value.agent === agentValue;
          return (
            <button
              key={agentValue}
              type="button"
              onClick={() => handleAgentChange(agentValue)}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
            >
              <span className="flex h-4 w-4 items-center justify-center">
                <Image src={agent.icon} alt={agent.label} width={14} height={14} />
              </span>
              <span className="truncate">{agent.label}</span>
              {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Model column */}
      <div className={cn('flex flex-col gap-1', inline ? 'w-full' : 'min-w-[180px]')}>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Model
        </p>
        <button
          type="button"
          onClick={() => handleModelChange(null)}
          className={cn(
            'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
            value.model === null ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
          )}
        >
          <span className="truncate text-muted-foreground">Default</span>
          {value.model === null && <Check className="ml-auto h-3 w-3 shrink-0" />}
        </button>
        {loading ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading...</p>
        ) : currentModels.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No models available</p>
        ) : (
          <div className="max-h-[200px] overflow-y-auto">
            {currentModels.map(m => {
              const isSelected = value.model === m.model_id;
              return (
                <button
                  key={m.model_id}
                  type="button"
                  onClick={() => handleModelChange(m.model_id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                  )}
                >
                  <span className="truncate">{m.display_name}</span>
                  {m.is_recommended && (
                    <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary">
                      rec
                    </span>
                  )}
                  {isSelected && <Check className="ml-auto h-3 w-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Thinking column — only shown when a model with thinking options is selected */}
      {thinkingOptions.length > 0 && (
        <div className={cn('flex flex-col gap-1', inline ? 'w-full' : 'min-w-[100px]')}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Thinking
          </p>
          <button
            type="button"
            onClick={() => handleThinkingChange(null)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
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
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs capitalize transition-colors',
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
  loaded: boolean;
} {
  const [selection, setSelection] = useState<AgentModelSelection>({
    agent: 'claude',
    model: null,
    thinking: null
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAllAgentConfigsAction()
      .then(configs => {
        if (cancelled) return;
        // Find the first config with a defaultModel set, or use the first agent
        const agents = Object.keys(configs) as AgentTypeValue[];
        for (const agent of agents) {
          const config = configs[agent];
          if (config?.defaultModel) {
            setSelection({
              agent,
              model: config.defaultModel ?? null,
              thinking: config.defaultThinking ?? null
            });
            setLoaded(true);
            return;
          }
        }
        // No explicit model preference — check if there's a default agent config
        if (agents.length > 0) {
          const firstAgent = agents[0];
          const config = configs[firstAgent];
          setSelection({
            agent: LAUNCH_AGENT_VALUES.includes(firstAgent as AgentTypeValue)
              ? (firstAgent as AgentTypeValue)
              : 'claude',
            model: config?.defaultModel ?? null,
            thinking: config?.defaultThinking ?? null
          });
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { selection, setSelection, loaded };
}
