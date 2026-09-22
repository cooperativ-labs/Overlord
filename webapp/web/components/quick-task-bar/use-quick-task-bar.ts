import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type AgentModelSelection,
  MANUAL_AGENT_KEY
} from '@/components/objectives/AgentModelSelector.tsx';
import { api } from '@/lib/api.ts';
import { getAgentIcon } from '@/lib/helpers/agent-icons.ts';
import {
  distinctProjectResourceKeys,
  executionTargetAvailability,
  firstObjectiveCreatePayload,
  primaryResourceConnection,
  projectResourceLabel
} from '@/lib/project-resources.ts';
import {
  useAccessibleWorkspaces,
  useAgentCatalog,
  useAllProjects,
  useCreateInboxItem,
  useCreateMission,
  useLaunchObjective,
  useLaunchPreference,
  useLaunchSettings,
  useProjectExecutionTarget,
  useProjectResources,
  useUpdateLaunchPreference,
  useUpdateObjective
} from '@/lib/queries.ts';

import type { AgentLaunchConfigDto } from '../../../shared/contract.ts';

import {
  getQuickTaskApi,
  type ProjectOption,
  resolveProjectId,
  type StagedFile
} from './quick-task-helpers.ts';

/**
 * State, effects, and mutations behind the quick-task bar. QuickTaskBar.tsx
 * composes the returned values with its picker panels; the effects here have
 * ordering dependencies on each other, so keep them in declaration order.
 */
export function useQuickTaskBar(defaultProjectId: string | null = null) {
  // Every accessible workspace's projects are offered — quick tasks may land
  // in any workspace the caller is a member of (coo:324).
  const projectsQ = useAllProjects();
  const workspaces = useAccessibleWorkspaces();
  const createMission = useCreateMission();
  const createInboxItem = useCreateInboxItem();
  const launchObjective = useLaunchObjective();
  const updateObjective = useUpdateObjective();

  const projects = useMemo<ProjectOption[]>(
    () =>
      projectsQ.data
        .filter(project => project.status === 'active')
        .map(project => ({
          id: project.id,
          name: project.name,
          color: project.color,
          workspaceId: project.workspaceId,
          workspaceName:
            workspaces.find(workspace => workspace.id === project.workspaceId)?.name ?? null,
          updatedAt: project.updatedAt
        })),
    [projectsQ.data, workspaces]
  );

  // The quick-task window is hidden between uses rather than recreated. Keep
  // an explicit record of user-driven project changes so reopening it honors a
  // picker or # selection ahead of all other defaults.
  const lastManualProjectIdRef = useRef<string | null>(null);
  const [objective, setObjective] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeMenu, setActiveMenu] = useState<'project' | 'agent' | 'resource' | null>(null);
  const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlBarRef = useRef<HTMLDivElement>(null);

  const resolveTextarea = useCallback(() => {
    return containerRef.current?.querySelector('textarea') ?? null;
  }, []);

  const selectedProject = projects.find(project => project.id === selectedProjectId) ?? null;
  const recentDefaultProjectId = useMemo(() => {
    const project = projects.find(item => item.id === defaultProjectId);
    const stored = Number(
      window.localStorage.getItem('overlord.defaultProjectWindowMinutes') ?? '15'
    );
    const minutes = Number.isFinite(stored) && stored >= 0 ? stored : 15;
    return project &&
      project.updatedAt &&
      Date.now() - Date.parse(project.updatedAt) <= minutes * 60_000
      ? project.id
      : null;
  }, [defaultProjectId, projects]);

  const preferenceQ = useLaunchPreference(selectedProjectId);
  const resourcesQ = useProjectResources(selectedProjectId);
  const updatePreference = useUpdateLaunchPreference(selectedProjectId);
  // The agent/model catalog follows the selected project's own workspace, so
  // cross-workspace projects offer their workspace's agents (coo:324).
  const catalogQ = useAgentCatalog(selectedProject?.workspaceId);
  const settingsQ = useLaunchSettings(selectedProject?.workspaceId, {
    enabled: Boolean(selectedProject)
  });

  const catalog = catalogQ.data ?? null;
  const agentConfigs = settingsQ.data?.agentConfigs ?? {};
  const selectionLoaded = Boolean(catalog) && !preferenceQ.isLoading && !settingsQ.isLoading;

  const defaultSelection = useMemo<AgentModelSelection>(() => {
    if (preferenceQ.data?.selectedAgent) {
      return {
        agent: preferenceQ.data.selectedAgent,
        model: preferenceQ.data.selectedModel,
        reasoningEffort: preferenceQ.data.selectedReasoningEffort
      };
    }
    return {
      agent: catalog?.defaultAgent ?? 'cursor',
      model: catalog?.defaultModel ?? null,
      reasoningEffort: null
    };
  }, [catalog, preferenceQ.data]);

  const [objectiveSelection, setObjectiveSelection] =
    useState<AgentModelSelection>(defaultSelection);
  const [explicitLaunchConfigs, setExplicitLaunchConfigs] = useState<
    Record<string, AgentLaunchConfigDto>
  >({});

  useEffect(() => {
    setObjectiveSelection(defaultSelection);
    setExplicitLaunchConfigs({});
  }, [defaultSelection]);

  const selectedAgentDef = catalog?.agents.find(a => a.key === objectiveSelection.agent);
  const selectedAgentModelDef = selectedAgentDef?.models.find(
    m => m.id === objectiveSelection.model
  );
  const selectedAgentLabel = selectedAgentDef ? selectedAgentDef.label : objectiveSelection.agent;
  const selectedAgentFullLabel = selectedAgentModelDef
    ? `${selectedAgentLabel} · ${selectedAgentModelDef.displayName}`
    : selectedAgentLabel;
  const selectedAgentIconKey = selectedAgentDef?.key ?? objectiveSelection.agent;
  const hasSelectedAgentIcon = getAgentIcon(selectedAgentIconKey) !== null;
  const primaryConnection = primaryResourceConnection(resourcesQ.data ?? []);
  const resources = resourcesQ.data ?? [];
  const resourceKeys = distinctProjectResourceKeys(resources);
  const hasMultipleResources = resourceKeys.length > 1;
  const primaryResourceKey = primaryConnection.primary?.resourceKey ?? null;
  const effectiveResourceKey = selectedResourceKey ?? primaryResourceKey ?? resourceKeys[0] ?? null;
  const selectedResourceLabel = effectiveResourceKey
    ? projectResourceLabel({ resources, resourceKey: effectiveResourceKey })
    : null;
  const executionTargetQ = useProjectExecutionTarget(selectedProjectId);
  const targetAvailability = executionTargetAvailability({
    primaryConnected: primaryConnection.connected,
    eligibleTargets: executionTargetQ.data?.eligibleTargets
  });

  useEffect(() => {
    setSelectedProjectId(current => {
      if (lastManualProjectIdRef.current || current || recentDefaultProjectId) {
        return resolveProjectId(
          projects,
          lastManualProjectIdRef.current,
          current,
          recentDefaultProjectId
        );
      }
      return '';
    });
  }, [projects, recentDefaultProjectId]);

  const selectProject = useCallback((projectId: string) => {
    lastManualProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setSelectedResourceKey(null);
  }, []);

  // Drop a bound resource key once it no longer maps to a resource on the
  // selected project (e.g. after switching projects), falling back to inherit
  // the project primary.
  useEffect(() => {
    if (selectedResourceKey && !resourceKeys.includes(selectedResourceKey)) {
      setSelectedResourceKey(null);
    }
  }, [resourceKeys, selectedResourceKey]);

  const autoResize = useCallback(() => {
    const el = resolveTextarea();
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;

    const container = containerRef.current;
    const bar = controlBarRef.current;
    const quickTaskApi = getQuickTaskApi();
    if (!container || !quickTaskApi) return;

    if (bar && typeof quickTaskApi.setBounds === 'function') {
      const containerTop = container.getBoundingClientRect().top;
      const barTop = bar.getBoundingClientRect().top;
      quickTaskApi
        .setBounds({
          height: container.offsetHeight,
          barOffsetTop: Math.round(barTop - containerTop)
        })
        .catch(() => {});
    } else {
      quickTaskApi.setHeight(container.offsetHeight).catch(() => {});
    }
  }, [resolveTextarea]);

  useEffect(() => {
    autoResize();
  }, [autoResize, objective, stagedFiles.length, activeMenu, objectiveSelection]);

  // Selector panels (agent launch flags wrapping, model list scrolling, etc.)
  // can change height without touching the state above — observe the
  // container directly so the host window always grows/shrinks to match
  // whatever is actually rendered, instead of missing an edge case.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => autoResize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [autoResize]);

  useEffect(() => {
    if (activeMenu) return;
    requestAnimationFrame(() => {
      resolveTextarea()?.focus();
      autoResize();
    });
  }, [activeMenu, autoResize, resolveTextarea]);

  useEffect(() => {
    const quickTaskApi = getQuickTaskApi();
    if (!quickTaskApi) return;
    const off = quickTaskApi.onShown(() => {
      requestAnimationFrame(() => {
        setSelectedProjectId(current => {
          if (lastManualProjectIdRef.current || current || recentDefaultProjectId) {
            return resolveProjectId(
              projects,
              lastManualProjectIdRef.current,
              current,
              recentDefaultProjectId
            );
          }
          return '';
        });
        setObjectiveSelection(defaultSelection);
        setSelectedResourceKey(null);
        setActiveMenu(null);
        setSubmitError(null);
        resolveTextarea()?.focus();
        autoResize();
      });
    });
    return () => {
      off?.();
    };
  }, [autoResize, defaultSelection, projects, recentDefaultProjectId, resolveTextarea]);

  const handleClose = useCallback(() => {
    const quickTaskApi = getQuickTaskApi();
    if (quickTaskApi) {
      quickTaskApi.close().catch(() => {});
      return;
    }
    setObjective('');
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeMenu) {
          setActiveMenu(null);
          return;
        }
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMenu, handleClose]);

  const handleFilesSelected = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const next = Array.from(fileList).map(file => ({
      id: `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`,
      file
    }));
    setStagedFiles(prev => [...prev, ...next]);
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setStagedFiles(prev => prev.filter(file => file.id !== id));
  }, []);

  const handleMentionMenuOpenChange = useCallback(() => {
    requestAnimationFrame(() => autoResize());
  }, [autoResize]);

  const handleSelectionChange = useCallback(
    (next: AgentModelSelection) => {
      setObjectiveSelection(next);
      if (!selectedProjectId) return;
      updatePreference.mutate({
        selectedAgent: next.agent,
        selectedModel: next.model,
        selectedReasoningEffort: next.reasoningEffort
      });
    },
    [selectedProjectId, updatePreference]
  );

  async function uploadStagedFiles(objectiveId: string, files: StagedFile[]): Promise<void> {
    if (files.length === 0) return;
    await Promise.all(
      files.map(async ({ file }) => {
        await api.uploadObjectiveAttachment(objectiveId, file);
      })
    );
  }

  async function handleSubmit(shouldLaunch = false) {
    const trimmed = objective.trim();
    if (!trimmed || isSubmitting || (selectedProject && !selectionLoaded)) return;

    setIsSubmitting(true);
    setSubmitError(null);
    const filesToUpload = stagedFiles;

    try {
      if (!selectedProject) {
        if (shouldLaunch) throw new Error('Assign a project before running this task');
        await createInboxItem.mutateAsync({ title: trimmed, objectives: [trimmed] });
        setObjective('');
        handleClose();
        return;
      }
      if (shouldLaunch && objectiveSelection.agent === MANUAL_AGENT_KEY) {
        throw new Error('Please select an agent to launch this task');
      }
      if (shouldLaunch && !primaryConnection.connected) {
        throw new Error(primaryConnection.message ?? 'Primary resource is not connected.');
      }
      if (shouldLaunch && !targetAvailability.available) {
        throw new Error(targetAvailability.message ?? 'No execution target is available.');
      }

      const detail = await createMission.mutateAsync({
        projectId: selectedProject.id,
        ...firstObjectiveCreatePayload(trimmed, selectedResourceKey)
      });
      const createdObjective = detail.objectives[0];
      if (!createdObjective) {
        throw new Error('Mission was created without an objective.');
      }

      if (shouldLaunch) {
        await launchObjective.mutateAsync({
          id: createdObjective.id,
          body: {
            agent: objectiveSelection.agent,
            model: objectiveSelection.model,
            reasoningEffort: objectiveSelection.reasoningEffort,
            launchConfigOverride: explicitLaunchConfigs[objectiveSelection.agent]
          }
        });
      } else {
        await updateObjective.mutateAsync({
          id: createdObjective.id,
          body: {
            assignedAgent: objectiveSelection.agent,
            model: objectiveSelection.model,
            reasoningEffort: objectiveSelection.reasoningEffort,
            ...(explicitLaunchConfigs[objectiveSelection.agent]
              ? {
                  launchConfigAgent: objectiveSelection.agent,
                  launchConfigOverride: explicitLaunchConfigs[objectiveSelection.agent]
                }
              : {})
          }
        });
        updatePreference.mutate({
          selectedAgent: objectiveSelection.agent,
          selectedModel: objectiveSelection.model,
          selectedReasoningEffort: objectiveSelection.reasoningEffort
        });
      }

      if (filesToUpload.length > 0) {
        void uploadStagedFiles(createdObjective.id, filesToUpload).catch(error => {
          console.error('Failed to upload quick-task attachments:', error);
        });
      }

      setObjective('');
      setStagedFiles([]);
      setSelectedResourceKey(null);
      handleClose();
    } catch (error) {
      console.error('Failed to create quick task:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create mission.');
    } finally {
      setObjectiveSelection(defaultSelection);
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit(event.metaKey || event.ctrlKey);
    }
  }

  const canSubmit =
    Boolean(objective.trim()) && !isSubmitting && (!selectedProject || selectionLoaded);

  const canLaunch =
    canSubmit &&
    objectiveSelection.agent !== MANUAL_AGENT_KEY &&
    primaryConnection.connected &&
    targetAvailability.available;

  return {
    isLoadingProjects: projectsQ.isLoading,
    projects,
    lastManualProjectIdRef,
    objective,
    setObjective,
    selectedProjectId,
    setSelectedProjectId,
    stagedFiles,
    isSubmitting,
    activeMenu,
    setActiveMenu,
    selectedResourceKey,
    setSelectedResourceKey,
    submitError,
    fileInputRef,
    containerRef,
    controlBarRef,
    selectedProject,
    catalog,
    agentConfigs,
    selectionLoaded,
    objectiveSelection,
    setExplicitLaunchConfigs,
    selectedAgentFullLabel,
    selectedAgentIconKey,
    hasSelectedAgentIcon,
    primaryConnection,
    resources,
    hasMultipleResources,
    selectedResourceLabel,
    targetAvailability,
    selectProject,
    autoResize,
    handleFilesSelected,
    handleRemoveFile,
    handleMentionMenuOpenChange,
    handleSelectionChange,
    handleSubmit,
    handleKeyDown,
    canSubmit,
    canLaunch
  };
}
