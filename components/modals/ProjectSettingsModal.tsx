'use client';

import { Folder } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { ProjectStatusSettings } from '@/components/features/projects/ProjectStatusSettings';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import {
  updateProjectColorAction,
  updateProjectNameAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

type TicketStatusType = Database['public']['Enums']['ticket_status_type'];

type ProjectSettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  initialStatuses: Array<{
    name: string;
    position: number;
    statusType: TicketStatusType;
    isDefault: boolean;
  }>;
  hasEverhourApiKey: boolean;
};

export function ProjectSettingsModal({
  open,
  onOpenChange,
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  initialStatuses,
  hasEverhourApiKey
}: ProjectSettingsModalProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [savedColor, setSavedColor] = useState(initialColor);
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [nameSaveState, setNameSaveState] = useState<ButtonLoadingState>('default');
  const [workingDirectorySaveState, setWorkingDirectorySaveState] =
    useState<ButtonLoadingState>('default');
  const [syncButtonState, setSyncButtonState] = useState<ButtonLoadingState>('default');
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [workingDirectoryError, setWorkingDirectoryError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const hasSavedWorkingDirectory = savedWorkingDirectory.trim().length > 0;

  useEffect(() => {
    setSavedColor(initialColor);
  }, [initialColor]);

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
    setWorkingDirectory(next);
    setSavedWorkingDirectory(next);
  }, [initialWorkingDirectory]);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSavedName(initialName);
    }
  }, [open, initialName]);

  async function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed === savedName) return;

    setNameSaveState('loading');
    setNameError(null);
    try {
      await updateProjectNameAction({ projectId, name: trimmed });
      setSavedName(trimmed);
      setNameSaveState('success');
      router.refresh();
    } catch (error) {
      setNameSaveState('error');
      setNameError(error instanceof Error ? error.message : 'Failed to update name.');
    }
  }

  async function handleSelectColor(color: string) {
    if (color.toLowerCase() === savedColor.toLowerCase()) return;

    setColorError(null);
    try {
      await updateProjectColorAction({ projectId, color: color.toLowerCase() });
      setSavedColor(color.toLowerCase());
      router.refresh();
    } catch (error) {
      setColorError(error instanceof Error ? error.message : 'Failed to update color.');
    }
  }

  async function handleSyncEverhour() {
    setSyncButtonState('loading');
    setSyncMessage(null);
    try {
      const result = await syncEverhourProjectsForOrganization(organizationId);
      setSyncButtonState('success');
      const baseMessage = `Synced ${result.totalLocal} project${result.totalLocal === 1 ? '' : 's'} to Everhour (${result.created} created, ${result.linked} linked, ${result.mapped} mapped).`;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogTitle>Project settings</DialogTitle>

        <div className="grid gap-6 pt-2">
          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <div className="flex gap-2">
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Mobile App"
                className="h-8"
                onBlur={handleSaveName}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                }}
                disabled={nameSaveState === 'loading'}
              />
              <LoadingButton
                buttonState={nameSaveState}
                setButtonState={setNameSaveState}
                text="Save"
                loadingText="Saving…"
                successText="Saved"
                errorText="Retry"
                reset
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={handleSaveName}
              />
            </div>
            {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
          </div>

          <div className="grid gap-2">
            <label className="text-xs font-medium text-muted-foreground">Color</label>
            <ProjectColorSetter value={savedColor} onSelect={handleSelectColor} />
            {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
          </div>

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
                  title={
                    hasSavedWorkingDirectory ? savedWorkingDirectory : 'Add a project directory'
                  }
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {hasSavedWorkingDirectory ? savedWorkingDirectory : 'Add a project directory'}
                  </span>
                </button>
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

          {hasEverhourApiKey ? (
            <div className="grid gap-2">
              <LoadingButton
                buttonState={syncButtonState}
                setButtonState={setSyncButtonState}
                text="Sync Everhour"
                loadingText="Syncing…"
                successText="Synced"
                errorText="Retry"
                reset
                size="sm"
                variant="outline"
                onClick={handleSyncEverhour}
              />
              {syncMessage ? (
                <p className="text-xs text-muted-foreground" title={syncMessage}>
                  {syncMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          <ProjectStatusSettings
            organizationId={organizationId}
            projectId={projectId}
            initialStatuses={initialStatuses}
            defaultExpanded
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
