'use client';

import { Folder } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectStatusSettings } from '@/components/features/projects/ProjectStatusSettings';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import {
  updateProjectSshConfigAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
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
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
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
  initialSshCommand,
  initialRemoteWorkingDirectory,
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

  // SSH remote workspace state
  const [sshCommand, setSshCommand] = useState(initialSshCommand ?? '');
  const [savedSshCommand, setSavedSshCommand] = useState(initialSshCommand ?? '');
  const [remoteWorkingDirectory, setRemoteWorkingDirectory] = useState(
    initialRemoteWorkingDirectory ?? ''
  );
  const [savedRemoteWorkingDirectory, setSavedRemoteWorkingDirectory] = useState(
    initialRemoteWorkingDirectory ?? ''
  );
  const [sshSaveState, setSshSaveState] = useState<ButtonLoadingState>('default');
  const [sshError, setSshError] = useState<string | null>(null);
  const hasSshConfig = savedSshCommand.trim().length > 0;
  const sshHasUnsavedChanges =
    sshCommand.trim() !== savedSshCommand ||
    remoteWorkingDirectory.trim() !== savedRemoteWorkingDirectory;

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
    setWorkingDirectory(next);
    setSavedWorkingDirectory(next);
  }, [initialWorkingDirectory]);

  useEffect(() => {
    setSshCommand(initialSshCommand ?? '');
    setSavedSshCommand(initialSshCommand ?? '');
    setRemoteWorkingDirectory(initialRemoteWorkingDirectory ?? '');
    setSavedRemoteWorkingDirectory(initialRemoteWorkingDirectory ?? '');
  }, [initialSshCommand, initialRemoteWorkingDirectory]);

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

  async function handleSaveSshConfig() {
    const normalizedSsh = sshCommand.trim();
    const normalizedRemote = remoteWorkingDirectory.trim();
    if (normalizedSsh === savedSshCommand && normalizedRemote === savedRemoteWorkingDirectory)
      return;

    setSshSaveState('loading');
    setSshError(null);
    try {
      await updateProjectSshConfigAction({
        projectId,
        sshCommand: normalizedSsh || null,
        remoteWorkingDirectory: normalizedRemote || null
      });
      setSavedSshCommand(normalizedSsh);
      setSavedRemoteWorkingDirectory(normalizedRemote);
      setSshSaveState('success');
      router.refresh();
    } catch (error) {
      setSshSaveState('error');
      setSshError(error instanceof Error ? error.message : 'Failed to update SSH configuration.');
    }
  }

  async function handleClearSshConfig() {
    setSshSaveState('loading');
    setSshError(null);
    try {
      await updateProjectSshConfigAction({
        projectId,
        sshCommand: null,
        remoteWorkingDirectory: null
      });
      setSshCommand('');
      setSavedSshCommand('');
      setRemoteWorkingDirectory('');
      setSavedRemoteWorkingDirectory('');
      setSshSaveState('success');
      router.refresh();
    } catch (error) {
      setSshSaveState('error');
      setSshError(error instanceof Error ? error.message : 'Failed to clear SSH configuration.');
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

      {/* SSH / Remote workspace */}
      <div className="grid gap-2">
        <label className="text-xs font-medium text-muted-foreground">SSH / Remote workspace</label>
        <p className="text-xs text-muted-foreground">
          Launch agents on a remote server via SSH. The{' '}
          <code className="rounded bg-muted px-1">ovld</code> CLI must be installed on the remote
          server.
        </p>
        <div className="grid gap-2">
          <input
            type="text"
            value={sshCommand}
            onChange={e => setSshCommand(e.target.value)}
            placeholder="e.g. ssh user@10.0.0.5"
            className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            value={remoteWorkingDirectory}
            onChange={e => setRemoteWorkingDirectory(e.target.value)}
            placeholder="Remote path, e.g. /home/user/projects/myapp"
            className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSaveSshConfig}
              disabled={sshSaveState === 'loading' || !sshHasUnsavedChanges}
            >
              {sshSaveState === 'loading' ? 'Saving…' : 'Save'}
            </Button>
            {hasSshConfig ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={handleClearSshConfig}
                disabled={sshSaveState === 'loading'}
              >
                Clear
              </Button>
            ) : null}
            {sshSaveState === 'success' ? (
              <span className="text-xs text-emerald-600">Saved</span>
            ) : null}
          </div>
        </div>
        {sshError ? <p className="text-xs text-destructive">{sshError}</p> : null}
      </div>

      <ProjectStatusSettings
        organizationId={organizationId}
        projectId={projectId}
        initialStatuses={initialStatuses}
        defaultExpanded
      />
    </>
  );
}
