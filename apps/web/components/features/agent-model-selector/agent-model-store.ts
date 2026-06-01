'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getAllAgentConfigsAction } from '@/lib/actions/agent-config';
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
import { AGENT_TYPES, type LaunchAgentType } from '@/lib/helpers/agent-types';
import type { AgentConfig } from '@/lib/schemas/agent-config';

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

/**
 * Returns the module-level configs cache (populated by AgentModelsPrefetch / the preference
 * hook). The selector reads this as a fallback when configs aren't passed explicitly.
 */
export function getCachedAgentConfigs(): Record<string, AgentConfig> {
  return cachedConfigs ?? {};
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
