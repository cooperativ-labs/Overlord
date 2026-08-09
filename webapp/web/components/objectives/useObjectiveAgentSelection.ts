import { useCallback, useMemo } from 'react';

import type { AgentLaunchConfigDto, ObjectiveDto } from '../../../shared/contract.ts';
import {
  useAgentCatalog,
  useLaunchPreference,
  useLaunchSettings,
  useProject,
  useUpdateLaunchPreference,
  useUpdateObjective
} from '../../lib/queries.ts';

import type { AgentModelSelection } from './AgentModelSelector.tsx';

/**
 * The slice of an objective this hook actually reads. Loosened from the full
 * `ObjectiveDto` so a not-yet-created ghost objective (see GhostObjective)
 * can resolve the same default selection — project preference, then catalog
 * default — before any real objective exists to read from.
 */
type SelectableObjective = Pick<
  ObjectiveDto,
  'id' | 'projectId' | 'assignedAgent' | 'model' | 'reasoningEffort' | 'launchConfigOverrides'
>;

/**
 * Wires an objective's agent/model selection to its storage owners, following
 * connectors/docs/agent-harness-configuration-architecture.md:
 *
 * - The effective selection resolves objective assignment → project user
 *   preference → instance default (overlord.toml via the catalog endpoint).
 * - Selection changes persist to BOTH the objective (`assigned_agent`,
 *   `model`, `reasoning_effort`) and the project launch preference, so the
 *   next objective in this project starts from the same choice.
 * - Launch-config (pre-command/flags) edits persist with this objective as an
 *   explicit any-target override. Device and resource defaults remain defaults.
 */
export function useObjectiveAgentSelection(objective: SelectableObjective) {
  // The catalog is the objective's own workspace's — a mission open from a
  // secondary workspace offers that workspace's agents, not the active one's
  // (coo:324).
  const projectQ = useProject(objective.projectId);
  const workspaceId = projectQ.data?.workspaceId;
  const catalogQ = useAgentCatalog(workspaceId);
  // Read/write the launch config (pre-command + flags) in the objective's own
  // workspace — the same workspace `launchObjective` resolves it from — so a
  // mission open from a secondary workspace saves where the runner will read
  // (coo:331 Phase 0). Previously this used the unscoped active-workspace hook,
  // which is the one-line source of the launch-config regression.
  const settingsQ = useLaunchSettings(workspaceId);
  const preferenceQ = useLaunchPreference(objective.projectId);
  const updateObjective = useUpdateObjective();
  const updatePreference = useUpdateLaunchPreference(objective.projectId);

  const catalog = catalogQ.data ?? null;
  const preference = preferenceQ.data ?? null;
  const agentConfigs = useMemo(() => {
    const inherited = settingsQ.data?.agentConfigs ?? {};
    return { ...inherited, ...(objective.launchConfigOverrides?.['*'] ?? {}) };
  }, [objective.launchConfigOverrides, settingsQ.data?.agentConfigs]);
  const loaded = Boolean(catalog) && !preferenceQ.isLoading;

  const selection = useMemo<AgentModelSelection>(() => {
    if (objective.assignedAgent) {
      return {
        agent: objective.assignedAgent,
        model: objective.model,
        reasoningEffort: objective.reasoningEffort
      };
    }
    if (preference?.selectedAgent) {
      return {
        agent: preference.selectedAgent,
        model: preference.selectedModel,
        reasoningEffort: preference.selectedReasoningEffort
      };
    }
    return {
      agent: catalog?.defaultAgent ?? 'claude',
      model: catalog?.defaultModel ?? null,
      reasoningEffort: null
    };
  }, [catalog, objective.assignedAgent, objective.model, objective.reasoningEffort, preference]);

  const setSelection = useCallback(
    // `targetId` defaults to the bound objective but can be overridden — the
    // ghost composer resolves its selection against this hook before a real
    // objective exists, then supplies the freshly-materialized id once one
    // does (see GhostObjective).
    (next: AgentModelSelection, targetId: string = objective.id) => {
      // Both persistence calls must succeed for the selector to treat the
      // change as committed; either failing should surface to the caller so
      // it can stop a per-button loading indicator.
      return Promise.all([
        updateObjective.mutateAsync({
          id: targetId,
          body: {
            assignedAgent: next.agent,
            model: next.model,
            reasoningEffort: next.reasoningEffort
          }
        }),
        updatePreference.mutateAsync({
          selectedAgent: next.agent,
          selectedModel: next.model,
          selectedReasoningEffort: next.reasoningEffort
        })
      ]).then(() => undefined);
    },
    [objective.id, updateObjective, updatePreference]
  );

  const commitLaunchConfig = useCallback(
    (agentKey: string, config: AgentLaunchConfigDto, targetId: string = objective.id) => {
      if (!targetId) return;
      updateObjective.mutate({
        id: targetId,
        body: { launchConfigAgent: agentKey, launchConfigOverride: config }
      });
    },
    [objective.id, updateObjective]
  );

  return { catalog, agentConfigs, preference, selection, setSelection, commitLaunchConfig, loaded };
}
