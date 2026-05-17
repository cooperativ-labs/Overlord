'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, useTransition } from 'react';

import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter,
  toHexColor
} from '@/components/features/projects/ProjectColorSetter';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger
} from '@/components/ui/select';
import { setTicketProjectAction } from '@/lib/actions/tickets';
import { useCreateProjectMutation } from '@/lib/client-data/projects/mutations';
import { moveTicketProjectInBoards } from '@/lib/client-data/tickets/cache';
import { useProjects } from '@/lib/client-data/tickets/hooks';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const PERSONAL_PROJECT_VALUE = '__personal__';
const setTicketProjectActionWithRetry = withElectronActionRetry(setTicketProjectAction);

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
};

type TicketProjectSelectProps = {
  ticketId: string;
  organizationId: number;
  currentProjectId: string | null;
  projects: ProjectOption[];
};

export function TicketProjectSelect({
  ticketId,
  organizationId,
  currentProjectId,
  projects
}: TicketProjectSelectProps) {
  const queryClient = useQueryClient();
  const createProjectMutation = useCreateProjectMutation();
  const initialSidebarProjects = useMemo(
    () =>
      projects.map(project => ({
        id: project.id,
        name: project.name,
        color: project.color,
        organizationId,
        localWorkingDirectory: null,
        sshCommand: null,
        remoteWorkingDirectory: null,
        sshHost: null,
        sshPort: null,
        sshUser: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
        remoteHelperInstalledAt: null,
        remoteHelperVersion: null
      })),
    [organizationId, projects]
  );
  const projectsQuery = useProjects(initialSidebarProjects);
  const everhourByProjectId = useMemo(
    () => new Map(projects.map(project => [project.id, project.everhour_project_id])),
    [projects]
  );
  const availableProjects = useMemo<ProjectOption[]>(
    () =>
      (projectsQuery.data ?? initialSidebarProjects).map(project => ({
        id: project.id,
        name: project.name,
        color: project.color,
        everhour_project_id: everhourByProjectId.get(project.id) ?? null
      })),
    [everhourByProjectId, initialSidebarProjects, projectsQuery.data]
  );
  const [savedProjectId, setSavedProjectId] = useState(currentProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    currentProjectId ?? PERSONAL_PROJECT_VALUE
  );
  const [isSavingProject, startSavingProject] = useTransition();
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [colorInput, setColorInput] = useState(DEFAULT_PROJECT_COLOR);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');

  const selectedProject = useMemo(
    () => availableProjects.find(project => project.id === selectedProjectId) ?? null,
    [availableProjects, selectedProjectId]
  );

  function handleProjectChange(nextValue: string) {
    const previousProjectId = savedProjectId ?? PERSONAL_PROJECT_VALUE;
    const nextProjectId = nextValue === PERSONAL_PROJECT_VALUE ? null : nextValue;
    setSelectedProjectId(nextValue);
    setUpdateError(null);

    startSavingProject(async () => {
      try {
        await setTicketProjectActionWithRetry(ticketId, nextProjectId);
        const nextProject = availableProjects.find(project => project.id === nextProjectId) ?? null;
        if (nextProjectId && nextProject) {
          moveTicketProjectInBoards(queryClient, ticketId, {
            project_id: nextProject.id,
            project_name: nextProject.name,
            project_color: nextProject.color,
            project_everhour_project_id: nextProject.everhour_project_id
          });
        } else {
          moveTicketProjectInBoards(queryClient, ticketId, {
            project_id: null,
            project_name: 'Inbox',
            project_color: null,
            project_everhour_project_id: null
          });
        }
        setSavedProjectId(nextProjectId);
      } catch (error) {
        setSelectedProjectId(previousProjectId);
        setUpdateError(error instanceof Error ? error.message : 'Failed to update project.');
      }
    });
  }

  function handleCreateDialogOpenChange(next: boolean) {
    if (!next) {
      setName('');
      setColorInput(DEFAULT_PROJECT_COLOR);
      setCreateError(null);
      setCreateButtonState('default');
    }
    setShowCreateForm(next);
  }

  async function handleCreateProject() {
    setCreateButtonState('loading');
    setCreateError(null);

    try {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error('Project name is required.');
      }

      const color = toHexColor(colorInput);
      if (!color) {
        throw new Error('Use a valid 6-digit hex color, like #d4d4d8.');
      }
      const created = await createProjectMutation.mutateAsync({
        organizationId,
        name: trimmedName,
        color
      });
      await setTicketProjectActionWithRetry(ticketId, created.id);
      moveTicketProjectInBoards(queryClient, ticketId, {
        project_id: created.id,
        project_name: created.name,
        project_color: created.color,
        project_everhour_project_id: null
      });

      setSavedProjectId(created.id);
      setSelectedProjectId(created.id);
      setCreateButtonState('success');
      handleCreateDialogOpenChange(false);
    } catch (error) {
      setCreateButtonState('error');
      setCreateError(error instanceof Error ? error.message : 'Failed to create project.');
    }
  }

  const projectIndicatorStyle = selectedProject
    ? { backgroundColor: selectedProject.color, borderColor: selectedProject.color }
    : undefined;

  return (
    <>
      <Select
        value={selectedProjectId}
        onValueChange={(value: string | undefined) =>
          handleProjectChange(value ?? PERSONAL_PROJECT_VALUE)
        }
        disabled={isSavingProject}
      >
        <SelectTrigger
          id="ticket-project-select"
          aria-label="Select project"
          className="h-6 w-auto rounded-md border bg-transparent px-3 text-xs font-base hover:bg-muted"
        >
          <span className="flex items-center gap-1.5">
            {selectedProject ? (
              <span
                className="h-2.5 w-2.5 rounded-[4px] border shrink-0"
                style={projectIndicatorStyle}
              />
            ) : (
              <span className="h-2.5 w-2.5 rounded-[4px] border border-muted-foreground/50 bg-muted shrink-0" />
            )}
            <span>{selectedProject?.name ?? 'Inbox'}</span>
          </span>
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value={PERSONAL_PROJECT_VALUE}>Inbox</SelectItem>
          <SelectSeparator />
          {availableProjects.map(project => (
            <SelectItem key={project.id} value={project.id}>
              {project.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <div className="p-1 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                handleCreateDialogOpenChange(true);
              }}
            >
              Create new project
            </Button>
          </div>
        </SelectContent>
      </Select>
      {updateError ? <p className="text-xs text-destructive">{updateError}</p> : null}
      <Dialog open={showCreateForm} onOpenChange={handleCreateDialogOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Create a project and assign it to this ticket.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-project-name">Project name</Label>
              <Input
                id="new-project-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Mobile App"
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    handleCreateProject();
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>Project color</Label>
              <ProjectColorSetter value={colorInput} onSelect={setColorInput} />
            </div>

            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                handleCreateDialogOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <LoadingButton
              buttonState={createButtonState}
              setButtonState={setCreateButtonState}
              text="Create project"
              loadingText="Creating project…"
              successText="Project created"
              errorText="Failed to create"
              reset
              onClick={handleCreateProject}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
