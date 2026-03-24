'use client';

import { Folder } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectStatusSettings } from '@/components/features/projects/ProjectStatusSettings';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { updateProjectWorkingDirectoryAction } from '@/lib/actions/projects';
import {
  isWorkingDirectoryNone,
  WORKING_DIRECTORY_NONE
} from '@/lib/helpers/project-working-directory';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type WorkflowPageProps = {
  projectId: string;
  organizationId: number;
  initialWorkingDirectory: string | null;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
};

export function WorkflowPage({
  projectId,
  organizationId,
  initialWorkingDirectory,
  initialStatuses
}: WorkflowPageProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [workingDirectorySaveState, setWorkingDirectorySaveState] =
    useState<ButtonLoadingState>('default');
  const [workingDirectoryError, setWorkingDirectoryError] = useState<string | null>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const hasSavedWorkingDirectory =
    savedWorkingDirectory.trim().length > 0 && !isWorkingDirectoryNone(savedWorkingDirectory);

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
    setWorkingDirectory(next);
    setSavedWorkingDirectory(next);
  }, [initialWorkingDirectory]);

  async function handleSaveWorkingDirectory(nextValue?: string) {
    const normalized = (nextValue ?? workingDirectory).trim();
    if (normalized === savedWorkingDirectory) return;

    setWorkingDirectorySaveState('loading');
    setWorkingDirectoryError(null);
    try {
      await updateProjectWorkingDirectoryAction({
        projectId,
        workingDirectory: normalized || null
      });
      setSavedWorkingDirectory(normalized);
      setWorkingDirectory(normalized);
      setWorkingDirectorySaveState('success');
      router.refresh();
    } catch (error) {
      setWorkingDirectorySaveState('error');
      setWorkingDirectoryError(
        error instanceof Error ? error.message : 'Failed to update working directory.'
      );
    }
  }

  async function handleSkipWorkingDirectory() {
    await handleSaveWorkingDirectory(WORKING_DIRECTORY_NONE);
  }

  async function handleChooseDirectory() {
    setWorkingDirectoryError(null);

    if (isElectron && api) {
      const chosenPath = await api.terminal.chooseDirectory();
      if (!chosenPath) return;
      setWorkingDirectory(chosenPath);
      await handleSaveWorkingDirectory(chosenPath);
      return;
    }

    const w =
      typeof window !== 'undefined'
        ? (window as Window & { showDirectoryPicker?(): Promise<{ name: string }> })
        : null;
    if (w?.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        const folderName = handle.name;
        setWorkingDirectory(folderName);
        await handleSaveWorkingDirectory(folderName);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setWorkingDirectoryError('Could not access the selected folder.');
        }
      }
      return;
    }

    directoryInputRef.current?.click();
  }

  async function handleWebDirectoryInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = firstPath ? firstPath.split('/')[0] : '';
    e.target.value = '';
    if (folderName) {
      setWorkingDirectory(folderName);
      await handleSaveWorkingDirectory(folderName);
    }
  }

  return (
    <>
      {isElectron ? (
        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">Working directory</label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted/60 hover:text-foreground',
                hasSavedWorkingDirectory
                  ? 'border-border'
                  : 'border-dashed border-muted-foreground/60 italic'
              )}
              onClick={handleChooseDirectory}
              disabled={workingDirectorySaveState === 'loading'}
              title={hasSavedWorkingDirectory ? savedWorkingDirectory : 'Add a project directory'}
            >
              <Folder className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {hasSavedWorkingDirectory
                  ? savedWorkingDirectory
                  : isWorkingDirectoryNone(savedWorkingDirectory)
                    ? 'No directory'
                    : 'Add a project directory'}
              </span>
            </button>
            {!hasSavedWorkingDirectory && !isWorkingDirectoryNone(savedWorkingDirectory) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-2 py-1.5 text-xs text-muted-foreground"
                onClick={handleSkipWorkingDirectory}
                disabled={workingDirectorySaveState === 'loading'}
              >
                Skip — no directory
              </Button>
            ) : null}
            <input
              ref={directoryInputRef}
              type="file"
              {...({
                webkitdirectory: '',
                directory: ''
              } as React.InputHTMLAttributes<HTMLInputElement>)}
              multiple
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={handleWebDirectoryInputChange}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Terminal sessions will open here when running agents on tickets in this project.
          </p>
          {workingDirectoryError ? (
            <p className="text-xs text-destructive">{workingDirectoryError}</p>
          ) : null}
        </div>
      ) : null}

      <ProjectStatusSettings
        organizationId={organizationId}
        projectId={projectId}
        initialStatuses={initialStatuses}
        defaultExpanded
      />
    </>
  );
}
