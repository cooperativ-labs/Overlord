'use client';

import { ChevronDown, Play, StopCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from '@/components/ui/popover';
import type { EverhourTimer } from '@/lib/actions/everhour';
import type { SidebarProject } from '@/lib/actions/project-types';
import { cn } from '@/lib/utils';

import { TimeEntriesPanel } from './TimeEntriesPanel';
import { useEverhourTimer } from './use-everhour-timer';

function getElapsedFromTimer(timer: EverhourTimer): number {
  if (typeof timer.duration === 'number') return timer.duration;
  if (typeof timer.today === 'number') return timer.today;
  return 0;
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Everhour request failed.';
}

export function deriveTicketIdFromPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (
    segments[0] === 'projects' &&
    typeof segments[2] === 'string' &&
    segments[2] !== 'current-changes'
  ) {
    return segments[2];
  }
  if (segments[0] === 'u' && typeof segments[1] === 'string') {
    return segments[1];
  }
  return null;
}

export function deriveProjectIdFromPath(pathname: string) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] === 'projects' && typeof segments[1] === 'string') {
    return segments[1];
  }
  return null;
}

export function isUserTicketsPath(pathname: string) {
  return pathname.split('/').filter(Boolean)[0] === 'u';
}

export function shouldShowNavTimerTimeEntriesContext({
  ticketId,
  everhourTaskId
}: {
  ticketId: string | null;
  everhourTaskId: string | null;
}) {
  return Boolean(ticketId || everhourTaskId);
}

type EverhourNavTimerProps = {
  projects: SidebarProject[];
};

export function EverhourNavTimer({ projects }: EverhourNavTimerProps) {
  const pathname = usePathname();
  const ticketId = useMemo(() => deriveTicketIdFromPath(pathname ?? ''), [pathname]);
  const currentProjectId = useMemo(() => deriveProjectIdFromPath(pathname ?? ''), [pathname]);
  const onUserTicketsPage = useMemo(() => isUserTicketsPath(pathname ?? ''), [pathname]);
  const { timer, errorMessage: pollError, startForProject, stop } = useEverhourTimer();
  const [elapsedSeconds, setElapsedSeconds] = useState(() => getElapsedFromTimer(timer));
  const [actionError, setActionError] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const isRunning = timer.status === 'active';
  const everhourTaskId = timer.task?.id ?? null;
  const availableProjects = useMemo(
    () => projects.filter(project => project.everhourProjectId),
    [projects]
  );
  const routeProject = useMemo(
    () => projects.find(project => project.id === currentProjectId) ?? null,
    [currentProjectId, projects]
  );
  const currentProject = useMemo(
    () => availableProjects.find(project => project.id === currentProjectId) ?? null,
    [availableProjects, currentProjectId]
  );

  useEffect(() => {
    if (currentProject) {
      setSelectedProjectId(currentProject.id);
      return;
    }

    setSelectedProjectId(previous => {
      if (previous && availableProjects.some(project => project.id === previous)) {
        return previous;
      }
      return availableProjects[0]?.id ?? '';
    });
  }, [availableProjects, currentProject]);

  const selectedProject = useMemo(
    () => availableProjects.find(project => project.id === selectedProjectId) ?? null,
    [availableProjects, selectedProjectId]
  );
  const targetProject = onUserTicketsPage ? selectedProject : currentProject;

  useEffect(() => {
    setElapsedSeconds(getElapsedFromTimer(timer));
  }, [timer]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(previous => previous + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isRunning]);

  const inactiveProject = routeProject ?? selectedProject;
  const title =
    timer.task?.name ?? (inactiveProject ? `${inactiveProject.name} general` : 'No timer running');
  const badge = isRunning ? formatElapsed(elapsedSeconds) : null;
  const description = isRunning
    ? `Elapsed ${formatElapsed(elapsedSeconds)}`
    : currentProject
      ? `Start a general timer for ${currentProject.name}.`
      : routeProject
        ? `${routeProject.name} is not linked to Everhour yet.`
        : onUserTicketsPage
          ? 'Select a project to start a general timer.'
          : 'No timer is running right now.';

  const actionLabel = isRunning
    ? 'Stop timer'
    : currentProject
      ? `Start ${currentProject.name}`
      : targetProject
        ? `Start ${targetProject.name}`
        : 'Start timer';
  const canStartProjectTimer = Boolean(targetProject);
  const shouldShowTimeEntries = shouldShowNavTimerTimeEntriesContext({
    everhourTaskId,
    ticketId
  });

  const handleAction = useCallback(async () => {
    setActionError(null);
    setButtonState('loading');

    try {
      if (isRunning) {
        await stop();
      } else {
        const targetProjectId = targetProject?.id ?? null;
        if (!targetProjectId) {
          throw new Error('Choose a project with an Everhour mapping first.');
        }
        await startForProject(targetProjectId);
      }
      setButtonState('success');
    } catch (error) {
      setButtonState('error');
      setActionError(getErrorMessage(error));
    }
  }, [isRunning, startForProject, stop, targetProject]);

  const triggerLabel = isRunning
    ? badge
    : currentProject
      ? 'General'
      : onUserTicketsPage
        ? 'Project'
        : 'General';

  return (
    <Popover>
      <div className="flex justify-end">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={isRunning ? `Everhour timer: ${title}` : 'Open Everhour timer controls'}
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full border transition-[width,background-color,box-shadow,border] duration-200 ease-in-out',
              isRunning
                ? 'min-w-[70px] gap-2 border-red-500/40 bg-red-500/15 px-2 py-2 text-xs font-semibold text-red-600'
                : 'min-w-[76px] gap-1 border-border bg-muted/60 px-2 py-1.5 text-xs font-medium text-foreground hover:bg-accent'
            )}
          >
            <span
              className="pointer-events-none inline-flex items-center gap-1 text-[11px]"
              aria-live="polite"
            >
              {isRunning ? (
                <StopCircle className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {triggerLabel}
            </span>
            {!isRunning && onUserTicketsPage ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : null}
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent className="max-h-[70vh] w-[26rem] overflow-y-auto">
        <PopoverHeader>
          <PopoverTitle className="truncate text-base">{title}</PopoverTitle>
          <PopoverDescription className="truncate text-sm">{description}</PopoverDescription>
        </PopoverHeader>
        <div className="mt-4 flex flex-col gap-3">
          {shouldShowTimeEntries ? (
            <TimeEntriesPanel ticketId={ticketId} everhourTaskId={everhourTaskId} />
          ) : null}
          {!isRunning && onUserTicketsPage ? (
            <div className="flex flex-col gap-2">
              <label
                htmlFor="everhour-project-timer"
                className="text-xs font-medium text-muted-foreground"
              >
                Project
              </label>
              <select
                id="everhour-project-timer"
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                value={selectedProjectId}
                onChange={event => setSelectedProjectId(event.target.value)}
              >
                {availableProjects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <LoadingButton
            buttonState={buttonState}
            setButtonState={setButtonState}
            text={actionLabel}
            loadingText={isRunning ? 'Stopping…' : 'Starting…'}
            successText={isRunning ? 'Stopped' : 'Started'}
            errorText="Retry"
            reset
            variant={isRunning ? 'destructive' : 'outline'}
            className="w-full"
            size="sm"
            disabled={!isRunning && !canStartProjectTimer}
            onClick={handleAction}
          />
          {!isRunning && !canStartProjectTimer ? (
            <p className="text-xs text-muted-foreground">
              {onUserTicketsPage
                ? 'No Everhour-linked projects are available yet. Sync Projects to Everhour first.'
                : 'This project is not linked to Everhour yet. Use Sync Projects to Everhour in the Project section.'}
            </p>
          ) : null}
          {actionError || pollError ? (
            <p className="text-xs text-destructive">{actionError ?? pollError}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
