'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import { createProjectAction, setTicketProjectAction } from '@/lib/actions/tickets';

import {
  DEFAULT_PROJECT_COLOR,
  ProjectColorSetter,
  toHexColor
} from '@/components/features/projects/ProjectColorSetter';

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
  const router = useRouter();
  const [availableProjects, setAvailableProjects] = useState<ProjectOption[]>(projects);
  const [savedProjectId, setSavedProjectId] = useState(currentProjectId ?? '');
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId ?? '');
  const [isSavingProject, startSavingProject] = useTransition();
  const [updateError, setUpdateError] = useState<string | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState('');
  const [colorInput, setColorInput] = useState(DEFAULT_PROJECT_COLOR);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createButtonState, setCreateButtonState] = useState<ButtonLoadingState>('default');
  const [syncButtonState, setSyncButtonState] = useState<ButtonLoadingState>('default');
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
        await setTicketProjectAction(ticketId, nextProjectId || null);
        setSavedProjectId(nextProjectId);
        router.refresh();
      } catch (error) {
        setSelectedProjectId(previousProjectId);
        setUpdateError(error instanceof Error ? error.message : 'Failed to update project.');
      }
    });
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
      setName('');
      setColorInput(DEFAULT_PROJECT_COLOR);
      setShowCreateForm(false);
      setCreateButtonState('success');
      router.refresh();
    } catch (error) {
      setCreateButtonState('error');
      setCreateError(error instanceof Error ? error.message : 'Failed to create project.');
    }
  }

  const projectIndicatorStyle = selectedProject
    ? { backgroundColor: selectedProject.color, borderColor: selectedProject.color }
    : undefined;

  async function handleSyncEverhourProjects() {
    setSyncButtonState('loading');
    setSyncMessage(null);
    setCreateError(null);

    try {
      const result = await syncEverhourProjectsForOrganization(organizationId);
      setAvailableProjects(result.projects);

      if (selectedProjectId) {
        const selectedStillExists = result.projects.some(
          project => project.id === selectedProjectId
        );
        if (!selectedStillExists) {
          setSelectedProjectId('');
          setSavedProjectId('');
        }
      }

      setSyncButtonState('success');
      const baseMessage = `Synced ${result.totalLocal} local project${result.totalLocal === 1 ? '' : 's'} to Everhour (${result.created} created, ${result.linked} linked, ${result.mapped} mapped).`;
      const failedMessage =
        result.failedProjects.length > 0
          ? ` Could not auto-create: ${result.failedProjects.join(', ')}. Create these in Everhour, then sync again.`
          : '';
      setSyncMessage(`${baseMessage}${failedMessage}`);
      router.refresh();
    } catch (error) {
      setSyncButtonState('error');
      setSyncMessage(error instanceof Error ? error.message : 'Failed to sync Everhour projects.');
    }
  }

  return (
    <section className="mb-6 rounded-lg  p-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Project
      </h2>
      <button
        type="button"
        className="mt-2 inline-flex w-full items-center justify-between rounded-full border border-stone-300 bg-white px-3 py-1.5 text-left text-xs shadow-sm transition hover:bg-stone-50"
        onClick={() => setShowSettings(value => !value)}
        aria-expanded={showSettings}
      >
        <span className="flex items-center gap-2">
          {selectedProject ? (
            <span className="h-3 w-3 rounded-[6px] border" style={projectIndicatorStyle} />
          ) : (
            <span className="h-3 w-3 rounded-[6px] border border-muted-foreground/50 bg-muted" />
          )}
          <span className="text-sm font-medium">
            {selectedProject?.name ?? 'No project selected'}
          </span>
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {showSettings ? 'Hide' : 'Change'}
        </span>
      </button>

      {showSettings ? (
        <div className="mt-4 space-y-3 rounded-md border border-stone-200 bg-white p-3">
          <div className="space-y-2">
            <Label htmlFor="ticket-project-select">Assign project</Label>
            <select
              id="ticket-project-select"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
              value={selectedProjectId}
              onChange={event => handleProjectChange(event.target.value)}
              disabled={isSavingProject}
            >
              <option value="">No project</option>
              {availableProjects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.everhour_project_id ? ' (Everhour)' : ''}
                </option>
              ))}
            </select>
            {isSavingProject ? (
              <p className="text-xs text-muted-foreground">Saving project…</p>
            ) : null}
            {updateError ? <p className="text-xs text-destructive">{updateError}</p> : null}
            {selectedProject && !selectedProject.everhour_project_id ? (
              <p className="text-xs text-muted-foreground">
                This project is local only. Sync projects to Everhour to enable timer task creation.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCreateForm(value => !value);
                setCreateError(null);
                setCreateButtonState('default');
              }}
            >
              Create new project
            </Button>
            <LoadingButton
              buttonState={syncButtonState}
              setButtonState={setSyncButtonState}
              text="Sync Projects to Everhour"
              loadingText="Syncing…"
              successText="Synced"
              errorText="Retry"
              reset
              size="sm"
              variant="outline"
              onClick={handleSyncEverhourProjects}
            />
          </div>
          {syncMessage ? <p className="text-xs text-muted-foreground">{syncMessage}</p> : null}

          {showCreateForm ? (
            <div className="space-y-3 border-t pt-3">
              <div className="space-y-2">
                <Label htmlFor="new-project-name">Project name</Label>
                <Input
                  id="new-project-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="e.g. Mobile App"
                />
              </div>

              <div className="space-y-2">
                <Label>Project color</Label>
                <ProjectColorSetter value={colorInput} onSelect={setColorInput} />
              </div>

              {createError ? <p className="text-xs text-destructive">{createError}</p> : null}

              <div className="flex flex-wrap items-center gap-2">
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCreateForm(false);
                    setName('');
                    setColorInput(DEFAULT_PROJECT_COLOR);
                    setCreateError(null);
                    setCreateButtonState('default');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
