import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowUp, Check, ChevronDown, Loader2, Play, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { AgentModelChooserButton } from '@/components/objectives/AgentModelChooserButton.tsx';
import {
  type AgentModelSelection,
  MANUAL_AGENT_KEY
} from '@/components/objectives/AgentModelSelector.tsx';
import { ObjectiveResourcePicker } from '@/components/objectives/ObjectiveResourcePicker.tsx';
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea.tsx';
import { Button } from '@/components/ui.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu.tsx';
import {
  executionTargetAvailability,
  objectiveResourceConnection
} from '@/lib/project-resources.ts';
import {
  useDeleteInboxItem,
  useLaunchObjective,
  useMission,
  usePromoteInboxItem,
  useUpdateInboxItem,
  useUpdateObjective
} from '@/lib/queries.ts';

import type {
  AgentCatalogDto,
  AgentLaunchConfigDto,
  InboxItemDto,
  MissionDetailDto,
  ProjectResourceDto
} from '../../shared/contract.ts';

import { useInboxCardState } from './inbox-mission-card/use-inbox-card-state.ts';

type InboxMissionCardProps =
  | {
      variant: 'inbox';
      item: InboxItemDto;
      /** Called after promotion so the Inbox page can keep this card sticky. */
      onPromoted: (mission: MissionDetailDto) => void;
    }
  | {
      variant: 'mission';
      mission: MissionDetailDto;
    };

/**
 * Inbox capture card shaped like {@link NewMissionModal}: instruction body over a
 * footer toolbar. While unassigned, only text + project selection are available.
 * Choosing a project unlocks agent / resource / run. Promoting keeps the card on
 * the page as a live mission surface so the user can keep working without a
 * sudden navigation away from Inbox.
 */
export function InboxMissionCard(props: InboxMissionCardProps) {
  if (props.variant === 'mission') {
    return <PromotedInboxMissionCard initialMission={props.mission} />;
  }
  return <UnassignedInboxMissionCard item={props.item} onPromoted={props.onPromoted} />;
}

function UnassignedInboxMissionCard({
  item,
  onPromoted
}: {
  item: InboxItemDto;
  onPromoted: (mission: MissionDetailDto) => void;
}) {
  const updateInbox = useUpdateInboxItem();
  const promote = usePromoteInboxItem();
  const remove = useDeleteInboxItem();
  const launchObjective = useLaunchObjective();
  const updateObjective = useUpdateObjective();

  const [instruction, setInstruction] = useState(item.objectives[0] ?? item.title);
  const [projectId, setProjectId] = useState('');
  const [resourceKey, setResourceKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'save' | 'run' | 'delete' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setInstruction(item.objectives[0] ?? item.title);
  }, [item.id, item.objectives, item.title]);

  const state = useInboxCardState({
    projectId,
    workspaceId: undefined,
    resourceKey,
    instruction,
    isBusy: pendingAction !== null
  });
  const {
    projects,
    projectGroups,
    showWorkspaceGroups,
    selectedProject,
    catalog,
    agentConfigs,
    resources,
    selectionLoaded,
    primaryConnection,
    targetAvailability,
    selection,
    explicitLaunchConfigs,
    setExplicitLaunchConfigs,
    handleSelectionChange,
    persistSelectionPreference,
    isBusy,
    isManual,
    canSubmit,
    canRun
  } = state;

  async function persistInboxText(text: string) {
    const title = text.split('\n')[0]?.trim() || text;
    await updateInbox.mutateAsync({
      id: item.id,
      body: { title, objectives: [text] }
    });
  }

  async function submit(shouldLaunch: boolean) {
    const text = instruction.trim();
    if (!text || (projectId && !selectionLoaded) || isBusy) return;

    setPendingAction(shouldLaunch ? 'run' : 'save');
    setSubmitError(null);

    try {
      if (!projectId) {
        await persistInboxText(text);
        return;
      }

      if (shouldLaunch && isManual) {
        throw new Error('Please select an agent to launch this task');
      }
      if (shouldLaunch && !primaryConnection.connected) {
        throw new Error(primaryConnection.message ?? 'Primary resource is not connected.');
      }
      if (shouldLaunch && !targetAvailability.available) {
        throw new Error(targetAvailability.message ?? 'No execution target is available.');
      }

      // Keep the inbox row current before promote so the mission inherits edits.
      await persistInboxText(text);
      const mission = await promote.mutateAsync({ id: item.id, projectId });
      const objective = mission.objectives[0];
      if (!objective) {
        throw new Error('Mission was created without an objective.');
      }

      if (resourceKey) {
        await updateObjective.mutateAsync({
          id: objective.id,
          body: { resourceKey }
        });
      }

      if (shouldLaunch) {
        await launchObjective.mutateAsync({
          id: objective.id,
          body: {
            agent: selection.agent,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            launchConfigOverride: explicitLaunchConfigs[selection.agent]
          }
        });
      } else {
        await updateObjective.mutateAsync({
          id: objective.id,
          body: {
            assignedAgent: selection.agent,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            ...(explicitLaunchConfigs[selection.agent]
              ? {
                  launchConfigAgent: selection.agent,
                  launchConfigOverride: explicitLaunchConfigs[selection.agent]
                }
              : {})
          }
        });
        persistSelectionPreference(selection);
      }

      onPromoted(mission);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update Inbox item.');
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (isBusy) return;
    setPendingAction('delete');
    setSubmitError(null);
    try {
      await remove.mutateAsync(item.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to delete Inbox item.');
      setPendingAction(null);
    }
  }

  return (
    <InboxCardShell
      instruction={instruction}
      onInstructionChange={setInstruction}
      projectId={projectId}
      resourceKey={resourceKey}
      projects={projects}
      projectGroups={projectGroups}
      showWorkspaceGroups={showWorkspaceGroups}
      selectedProject={selectedProject}
      onSelectProject={nextProjectId => {
        setProjectId(nextProjectId);
        setResourceKey(null);
      }}
      onSelectInbox={() => {
        setProjectId('');
        setResourceKey(null);
      }}
      onResourceChange={setResourceKey}
      resources={resources}
      selection={selection}
      onSelectionChange={handleSelectionChange}
      catalog={catalog}
      agentConfigs={agentConfigs}
      onLaunchConfigCommit={(agentKey, config) =>
        setExplicitLaunchConfigs(previous => ({ ...previous, [agentKey]: config }))
      }
      selectionLoaded={selectionLoaded}
      primaryConnection={primaryConnection}
      targetAvailability={targetAvailability}
      isBusy={isBusy}
      canSubmit={canSubmit}
      canRun={canRun}
      isManual={isManual}
      pendingAction={pendingAction}
      submitError={submitError}
      onSave={() => void submit(false)}
      onRun={() => void submit(true)}
      onDelete={() => void handleDelete()}
      showDelete
      assignedBanner={null}
    />
  );
}

function PromotedInboxMissionCard({ initialMission }: { initialMission: MissionDetailDto }) {
  const missionQ = useMission(initialMission.id);
  const mission = missionQ.data ?? initialMission;
  const objective = mission.objectives[0] ?? null;

  const launchObjective = useLaunchObjective();
  const updateObjective = useUpdateObjective();

  const [instruction, setInstruction] = useState(objective?.instructionText ?? mission.title);
  const [resourceKey, setResourceKey] = useState<string | null>(objective?.resourceKey ?? null);
  const [pendingAction, setPendingAction] = useState<'save' | 'run' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!objective) return;
    setInstruction(objective.instructionText);
    setResourceKey(objective.resourceKey);
  }, [objective?.id, objective?.instructionText, objective?.resourceKey, objective]);

  const state = useInboxCardState({
    projectId: mission.projectId,
    workspaceId: mission.workspaceId,
    resourceKey,
    instruction,
    isBusy: pendingAction !== null,
    isActionable: Boolean(objective),
    assignedSelection: objective
      ? {
          agent: objective.assignedAgent,
          model: objective.model,
          reasoningEffort: objective.reasoningEffort
        }
      : null,
    launchConfigOverrides: objective?.launchConfigOverrides?.['*']
  });
  const {
    projects,
    projectGroups,
    showWorkspaceGroups,
    selectedProject,
    catalog,
    agentConfigs,
    resources,
    selectionLoaded,
    primaryConnection,
    targetAvailability,
    selection,
    explicitLaunchConfigs,
    setExplicitLaunchConfigs,
    handleSelectionChange,
    persistSelectionPreference,
    isBusy,
    isManual,
    canSubmit,
    canRun
  } = state;

  async function submit(shouldLaunch: boolean) {
    const text = instruction.trim();
    if (!text || !objective || !selectionLoaded || isBusy) return;

    setPendingAction(shouldLaunch ? 'run' : 'save');
    setSubmitError(null);

    try {
      if (shouldLaunch && isManual) {
        throw new Error('Please select an agent to launch this task');
      }
      if (shouldLaunch && !primaryConnection.connected) {
        throw new Error(primaryConnection.message ?? 'Primary resource is not connected.');
      }
      if (shouldLaunch && !targetAvailability.available) {
        throw new Error(targetAvailability.message ?? 'No execution target is available.');
      }

      await updateObjective.mutateAsync({
        id: objective.id,
        body: {
          instructionText: text,
          resourceKey,
          ...(shouldLaunch
            ? {}
            : {
                assignedAgent: selection.agent,
                model: selection.model,
                reasoningEffort: selection.reasoningEffort
              }),
          ...(explicitLaunchConfigs[selection.agent]
            ? {
                launchConfigAgent: selection.agent,
                launchConfigOverride: explicitLaunchConfigs[selection.agent]
              }
            : {})
        }
      });

      if (shouldLaunch) {
        await launchObjective.mutateAsync({
          id: objective.id,
          body: {
            agent: selection.agent,
            model: selection.model,
            reasoningEffort: selection.reasoningEffort,
            launchConfigOverride: explicitLaunchConfigs[selection.agent]
          }
        });
      } else {
        persistSelectionPreference(selection);
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to update mission.');
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <InboxCardShell
      instruction={instruction}
      onInstructionChange={setInstruction}
      projectId={mission.projectId}
      resourceKey={resourceKey}
      projects={projects}
      projectGroups={projectGroups}
      showWorkspaceGroups={showWorkspaceGroups}
      selectedProject={selectedProject}
      onSelectProject={() => {
        /* Project is locked after promotion; open the mission panel to move it. */
      }}
      onSelectInbox={() => {
        /* Cannot return a promoted mission to Inbox from this card. */
      }}
      projectLocked
      onResourceChange={setResourceKey}
      resources={resources}
      selection={selection}
      onSelectionChange={handleSelectionChange}
      catalog={catalog}
      agentConfigs={agentConfigs}
      onLaunchConfigCommit={(agentKey, config) =>
        setExplicitLaunchConfigs(previous => ({ ...previous, [agentKey]: config }))
      }
      selectionLoaded={selectionLoaded}
      primaryConnection={primaryConnection}
      targetAvailability={targetAvailability}
      isBusy={isBusy}
      canSubmit={canSubmit}
      canRun={canRun}
      isManual={isManual}
      pendingAction={pendingAction}
      submitError={submitError}
      onSave={() => void submit(false)}
      onRun={() => void submit(true)}
      showDelete={false}
      assignedBanner={
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span>
            Assigned to{' '}
            <span className="font-medium text-foreground">
              {selectedProject?.name ?? 'project'}
            </span>
            . Stays here until you leave Inbox.
          </span>
          <Link
            to="/user/missions/$missionId"
            params={{ missionId: mission.id }}
            className="font-mono text-primary hover:underline"
          >
            Open {mission.displayId}
          </Link>
        </div>
      }
    />
  );
}

type ProjectGroup = {
  workspace: { id: string; name: string };
  projects: Array<{ id: string; name: string; color: string | null; workspaceId: string }>;
};

type InboxCardShellProps = {
  instruction: string;
  onInstructionChange: (value: string) => void;
  projectId: string;
  resourceKey: string | null;
  projects: Array<{ id: string; name: string; color: string | null; workspaceId: string }>;
  projectGroups: ProjectGroup[];
  showWorkspaceGroups: boolean;
  selectedProject: { id: string; name: string; color: string | null } | null;
  onSelectProject: (projectId: string) => void;
  onSelectInbox: () => void;
  projectLocked?: boolean;
  onResourceChange: (resourceKey: string | null) => void;
  resources: ProjectResourceDto[];
  selection: AgentModelSelection;
  onSelectionChange: (next: AgentModelSelection) => void;
  catalog: AgentCatalogDto | null;
  agentConfigs: Record<string, AgentLaunchConfigDto>;
  onLaunchConfigCommit: (agentKey: string, config: AgentLaunchConfigDto) => void;
  selectionLoaded: boolean;
  primaryConnection: ReturnType<typeof objectiveResourceConnection>;
  targetAvailability: ReturnType<typeof executionTargetAvailability>;
  isBusy: boolean;
  canSubmit: boolean;
  canRun: boolean;
  isManual: boolean;
  pendingAction: 'save' | 'run' | 'delete' | null;
  submitError: string | null;
  onSave: () => void;
  onRun: () => void;
  onDelete?: () => void;
  showDelete: boolean;
  assignedBanner: ReactNode;
};

function InboxCardShell({
  instruction,
  onInstructionChange,
  projectId,
  resourceKey,
  projects,
  projectGroups,
  showWorkspaceGroups,
  selectedProject,
  onSelectProject,
  onSelectInbox,
  projectLocked = false,
  onResourceChange,
  resources,
  selection,
  onSelectionChange,
  catalog,
  agentConfigs,
  onLaunchConfigCommit,
  selectionLoaded,
  primaryConnection,
  targetAvailability,
  isBusy,
  canSubmit,
  canRun,
  isManual,
  pendingAction,
  submitError,
  onSave,
  onRun,
  onDelete,
  showDelete,
  assignedBanner
}: InboxCardShellProps) {
  const hasProject = Boolean(projectId);

  return (
    <article className="space-y-1">
      <div className="w-full overflow-hidden rounded-xl border border-muted-foreground/20 transition-all focus-within:shadow-md dark:focus-within:ring-1 focus-within:ring-ring/50 bg-background">
        {assignedBanner}

        <RepositoryMentionTextarea
          rows={4}
          projectId={projectId}
          resourceKey={resourceKey}
          value={instruction}
          placeholder="Describe what the agent should do… (@ file, # selects project, $ mission)"
          onValueChange={onInstructionChange}
          projectMentionOptions={projects}
          projectMentionSelectionBehavior="select"
          onProjectMentionSelect={project => {
            if (projectLocked) return;
            onSelectProject(project.id);
          }}
          className="w-full min-h-32 max-h-[200px] md:max-h-[600px] border-none bg-transparent text-sm leading-relaxed shadow-none placeholder:text-muted-foreground/70 p-4"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave();
          }}
        />

        <div className="flex flex-nowrap items-center justify-between gap-2 border-t border-border/40 px-3 py-2">
          <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={projects.length === 0 || isBusy || projectLocked}
                aria-label="Choose project"
                title={
                  projectLocked
                    ? 'Project is assigned — open the mission to move it'
                    : 'Choose project'
                }
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-[4px] border"
                  style={{
                    backgroundColor: selectedProject?.color ?? undefined,
                    borderColor: selectedProject?.color ?? undefined
                  }}
                />
                <span className="max-w-[140px] truncate">
                  {selectedProject?.name ?? 'No project'}
                </span>
                {!projectLocked ? <ChevronDown className="h-3 w-3 shrink-0" /> : null}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuLabel>Project</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onClick={() => {
                    onSelectInbox();
                  }}
                >
                  <span className="h-3 w-3 shrink-0 rounded-[4px] border border-muted-foreground" />
                  <span className="truncate">No project (Inbox)</span>
                  {!hasProject ? <Check className="ml-auto h-3 w-3 text-muted-foreground" /> : null}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {projectGroups.map((group, groupIndex) => (
                  <div key={group.workspace.id}>
                    {showWorkspaceGroups ? (
                      <>
                        {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                          {group.workspace.name}
                        </DropdownMenuLabel>
                      </>
                    ) : null}
                    {group.projects.map(project => (
                      <DropdownMenuItem
                        key={project.id}
                        className="gap-2 text-xs"
                        onClick={() => onSelectProject(project.id)}
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-[4px] border"
                          style={{
                            backgroundColor: project.color ?? undefined,
                            borderColor: project.color ?? undefined
                          }}
                        />
                        <span className="truncate">{project.name}</span>
                        {project.id === projectId ? (
                          <Check className="ml-auto h-3 w-3 text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {hasProject ? (
              <ObjectiveResourcePicker
                resources={resources}
                value={resourceKey}
                disabled={isBusy}
                onChange={onResourceChange}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {showDelete ? (
              <Button
                variant="secondary"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={onDelete}
                disabled={isBusy}
                aria-label="Delete inbox item"
                title="Delete"
              >
                {pendingAction === 'delete' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            ) : null}

            {hasProject ? (
              <AgentModelChooserButton
                catalog={catalog}
                selection={selection}
                onChange={onSelectionChange}
                agentConfigs={agentConfigs}
                onLaunchConfigCommit={onLaunchConfigCommit}
                disabled={isBusy}
              />
            ) : null}

            <Button
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={onSave}
              disabled={!canSubmit}
            >
              {pendingAction === 'save' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUp className="h-3.5 w-3.5" />
              )}
              Save
            </Button>

            {hasProject && !isManual ? (
              <Button
                variant="primary"
                className="h-8 gap-1.5 px-3 text-xs"
                onClick={onRun}
                disabled={!canRun}
              >
                {pendingAction === 'run' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Run
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {submitError ? <p className="text-xs text-red-400">{submitError}</p> : null}
      {!primaryConnection.connected && selectionLoaded && hasProject ? (
        <div className="bg-background rounded-md mt-1">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>{primaryConnection.message}</p>
          </div>
        </div>
      ) : !targetAvailability.available && selectionLoaded && hasProject ? (
        <div className="bg-background rounded-md mt-1">
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <p>{targetAvailability.message}</p>
          </div>
        </div>
      ) : null}
    </article>
  );
}
