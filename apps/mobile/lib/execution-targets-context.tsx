import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/lib/auth-context';
import {
  loadExecutionTargets,
  mergeAgentLaunchConfig,
  persistTargetAgentConfig
} from '@/lib/execution-targets';
import type { AgentLaunchConfigUpdate, ExecutionTarget } from '@/lib/types';

const SELECTED_TARGET_KEY = 'overlord.selectedExecutionTargetId';

const persistOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
};

interface ExecutionTargetsContextValue {
  targets: ExecutionTarget[];
  loading: boolean;
  selectedTargetId: string | null;
  selectedTarget: ExecutionTarget | null;
  selectTarget: (targetId: string | null) => void;
  refresh: () => Promise<ExecutionTarget[]>;
  getTargetById: (targetId: string) => ExecutionTarget | null;
  /**
   * Update the per-agent launch config (pre-command + flags) on a target,
   * persisting to `user_execution_targets.agent_configs` and updating local state
   * so every surface (chooser, Servers tab) reflects the change immediately.
   */
  updateTargetAgentConfig: (
    targetId: string,
    agentType: string,
    update: AgentLaunchConfigUpdate
  ) => Promise<void>;
}

const ExecutionTargetsContext = createContext<ExecutionTargetsContextValue | undefined>(undefined);

export function ExecutionTargetsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [targets, setTargets] = useState<ExecutionTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(() =>
    SecureStore.getItem(SELECTED_TARGET_KEY)
  );
  const hasLoadedRef = useRef(false);

  const selectTarget = useCallback((targetId: string | null) => {
    setSelectedTargetId(targetId);
    if (targetId) {
      void SecureStore.setItemAsync(SELECTED_TARGET_KEY, targetId, persistOptions);
    } else {
      void SecureStore.deleteItemAsync(SELECTED_TARGET_KEY);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      hasLoadedRef.current = false;
      setTargets([]);
      setLoading(false);
      return [];
    }

    if (!hasLoadedRef.current) {
      setLoading(true);
    }

    try {
      const loaded = await loadExecutionTargets(userId);
      setTargets(loaded);
      hasLoadedRef.current = true;
      // Auto-select a sensible default the first time we see targets so the
      // queue button is usable without an extra trip to the Servers tab.
      setSelectedTargetId(current => {
        if (current && loaded.some(target => target.id === current)) return current;
        const fallback = loaded[0]?.id ?? null;
        if (fallback) {
          void SecureStore.setItemAsync(SELECTED_TARGET_KEY, fallback, persistOptions);
        }
        return fallback;
      });
      return loaded;
    } catch (error) {
      if (__DEV__) console.error('Failed to load execution targets:', error);
      return targets;
    } finally {
      setLoading(false);
    }
  }, [userId, targets]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void refresh();
      }
    });

    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const updateTargetAgentConfig = useCallback(
    async (targetId: string, agentType: string, update: AgentLaunchConfigUpdate) => {
      if (!userId) return;

      // Optimistically merge into local state so the chooser/Servers tab update
      // without waiting for the round trip.
      setTargets(current =>
        current.map(target => {
          if (target.id !== targetId) return target;
          const currentConfig = target.agentFlags[agentType] ?? { flags: [], preCommand: null };
          return {
            ...target,
            agentFlags: {
              ...target.agentFlags,
              [agentType]: mergeAgentLaunchConfig(currentConfig, update)
            }
          };
        })
      );

      try {
        const saved = await persistTargetAgentConfig(userId, targetId, agentType, update);
        setTargets(current =>
          current.map(target =>
            target.id === targetId ? { ...target, agentFlags: saved } : target
          )
        );
      } catch (error) {
        if (__DEV__) console.error('Failed to update target agent config:', error);
        // Reload to drop the optimistic value if persistence failed.
        void refresh();
      }
    },
    [userId, refresh]
  );

  const selectedTarget = useMemo(
    () => targets.find(target => target.id === selectedTargetId) ?? null,
    [targets, selectedTargetId]
  );

  const value = useMemo<ExecutionTargetsContextValue>(
    () => ({
      targets,
      loading,
      selectedTargetId,
      selectedTarget,
      selectTarget,
      refresh,
      getTargetById: targetId => targets.find(target => target.id === targetId) ?? null,
      updateTargetAgentConfig
    }),
    [
      targets,
      loading,
      selectedTargetId,
      selectedTarget,
      selectTarget,
      refresh,
      updateTargetAgentConfig
    ]
  );

  return (
    <ExecutionTargetsContext.Provider value={value}>{children}</ExecutionTargetsContext.Provider>
  );
}

export function useExecutionTargets() {
  const context = useContext(ExecutionTargetsContext);
  if (context === undefined) {
    throw new Error('useExecutionTargets must be used within an ExecutionTargetsProvider');
  }
  return context;
}
