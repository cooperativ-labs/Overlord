'use client';

import { useRouter } from 'next/navigation';
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
import { createProjectAction, setTicketProjectAction } from '@/lib/actions/tickets';

type ProjectOption = {
  id: string;
  name: string;
  color: string;
  everhour_project_id: string | null;
};

type TicketProjectSelectProps = {
  ticketId: string;
  organizationId: number;
  currentProjectId: string;
  projects: ProjectOption[];
};

export function TicketProjectSelect({
  ticketId,
  organizationId,
  currentProjectId,
  projects
}: TicketProjectSelectProps) {
  const router = useRouter();
  const [availableProjects, setAvailableProjects] = useState<ProjectOption[]>(projects);
  const [savedProjectId, setSavedProjectId] = useState(currentProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId);
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

  function handleProjectChange(nextProjectId: string) {
    const previousProjectId = savedProjectId;
    setSelectedProjectId(nextProjectId);
    setUpdateError(null);

    startSavingProject(async () => {
      try {
        await setTicketProjectAction(ticketId, nextProjectId);
        setSavedProjectId(nextProjectId);
        router.refresh();
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
      const created = await createProjectAction({ organizationId, name: trimmedName, color });
      await setTicketProjectAction(ticketId, created.id);

      setAvailableProjects(prev =>
        [...prev, created].sort((left, right) => left.name.localeCompare(right.name))
      );
      setSavedProjectId(created.id);
      setSelectedProjectId(created.id);
      setCreateButtonState('success');
      handleCreateDialogOpenChange(false);
      router.refresh();
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
        onValueChange={(value: string | undefined) => handleProjectChange(value ?? '')}
        disabled={isSavingProject}
      >
        <SelectTrigger
          id="ticket-project-select"
          aria-label="Select project"
          className="h-6 w-auto rounded-lg border bg-transparent px-3 text-xs font-base hover:bg-muted"
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
            <span>{selectedProject?.name ?? 'Project'}</span>
          </span>
        </SelectTrigger>
        <SelectContent align="start">
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
