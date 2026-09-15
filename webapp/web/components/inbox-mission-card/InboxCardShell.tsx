import { AlertTriangle, ArrowUp, Check, ChevronDown, Loader2, Play, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { AgentModelChooserButton } from '@/components/objectives/AgentModelChooserButton.tsx';
import type { AgentModelSelection } from '@/components/objectives/AgentModelSelector.tsx';
import { ObjectiveResourcePicker } from '@/components/objectives/ObjectiveResourcePicker.tsx';
import { RepositoryMentionTextarea } from '@/components/RepositoryMentionTextarea.tsx';
import { DueDatePickerButton } from '@/components/scheduling/DueDatePickerButton.tsx';
import { Button } from '@/components/ui.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu.tsx';
import type {
  executionTargetAvailability,
  objectiveResourceConnection
} from '@/lib/project-resources.ts';

import type {
  AgentCatalogDto,
  AgentLaunchConfigDto,
  ProjectResourceDto
} from '../../../shared/contract.ts';

import type { InboxCardPendingAction } from './inbox-card-actions.ts';

type ProjectGroup = {
  workspace: { id: string; name: string };
  projects: Array<{ id: string; name: string; color: string | null; workspaceId: string }>;
};

export type InboxCardShellProps = {
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
  dueDatetime: string | null;
  onDueDatetimeChange: (next: string | null) => void | Promise<void>;
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
  pendingAction: InboxCardPendingAction | null;
  submitError: string | null;
  onSave: () => void;
  onRun: () => void;
  onDelete?: () => void;
  showDelete: boolean;
  assignedBanner: ReactNode;
};

/**
 * Presentational Inbox card: instruction body over a project / resource / due
 * date / agent toolbar. Shared by the unassigned and promoted variants.
 */
export function InboxCardShell({
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
  dueDatetime,
  onDueDatetimeChange,
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

            <DueDatePickerButton
              size="sm"
              emptyLabel="Due date"
              heading="Due date"
              description="Schedule when this task is due."
              value={dueDatetime}
              onChange={onDueDatetimeChange}
              disabled={isBusy}
            />
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
