'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { syncEverhourProjectsForOrganization } from '@/lib/actions/everhour';
import {
  updateProjectColorAction,
  updateProjectNameAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
import { cn } from '@/lib/utils';

import { ProjectColorSetter } from './ProjectColorSetter';

type ProjectSettingsSectionProps = {
  projectId: string;
  organizationId: number;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  hasEverhourApiKey: boolean;
};

export function ProjectSettingsSection({
  projectId,
  organizationId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  hasEverhourApiKey
}: ProjectSettingsSectionProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [nameEditing, setNameEditing] = useState(false);
  const [savedColor, setSavedColor] = useState(initialColor);
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [nameSaveState, setNameSaveState] = useState<ButtonLoadingState>('default');
  const [colorSaveState, setColorSaveState] = useState<ButtonLoadingState>('default');
  const [workingDirectorySaveState, setWorkingDirectorySaveState] =
    useState<ButtonLoadingState>('default');
  const [syncButtonState, setSyncButtonState] = useState<ButtonLoadingState>('default');
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [workingDirectoryError, setWorkingDirectoryError] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSavedColor(initialColor);
  }, [initialColor]);

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
    setWorkingDirectory(next);
    setSavedWorkingDirectory(next);
  }, [initialWorkingDirectory]);

  useEffect(() => {
    if (nameEditing) nameInputRef.current?.focus();
  }, [nameEditing]);

  async function handleSaveName() {
    const trimmed = name.trim();
    if (trimmed === savedName) {
      setNameEditing(false);
      return;
    }
    setNameSaveState('loading');
    setNameError(null);
    try {
      await updateProjectNameAction({ projectId, name: trimmed });
      setSavedName(trimmed);
      setNameSaveState('success');
      setNameEditing(false);
      router.refresh();
    } catch (error) {
      setNameSaveState('error');
      setNameError(error instanceof Error ? error.message : 'Failed to update name.');
    }
  }

  function cancelNameEdit() {
    setName(savedName);
    setNameError(null);
    setNameEditing(false);
  }

  async function handleSelectColor(color: string) {
    if (color.toLowerCase() === savedColor.toLowerCase()) {
      setColorPopoverOpen(false);
      return;
    }

    setColorSaveState('loading');
    setColorError(null);

    try {
      await updateProjectColorAction({ projectId, color: color.toLowerCase() });
      setSavedColor(color.toLowerCase());
      setColorSaveState('success');
      setColorPopoverOpen(false);
      router.refresh();
    } catch (error) {
      setColorSaveState('error');
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
    if (normalized === savedWorkingDirectory) {
      return;
    }

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

    // Web: File System Access API or fallback to directory input
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
    <section className="px-5 pt-5">
      <div className="flex flex-wrap items-center gap-3">
        {/* Project name: click to reveal input */}
        <div className="min-w-0 flex-1 ">
          {nameEditing ? (
            <Input
              ref={nameInputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Mobile App"
              className="h-8 max-w-xs font-semibold"
              onBlur={handleSaveName}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') cancelNameEdit();
              }}
              disabled={nameSaveState === 'loading'}
            />
          ) : (
            <button
              type="button"
              className={cn(
                'rounded px-1.5 py-0.5 text-left text-lg font-semibold',
                'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                'min-h-8 -ml-1.5'
              )}
              onClick={() => setNameEditing(true)}
            >
              {savedName || 'Untitled project'}
            </button>
          )}
          {nameError ? <p className="mt-1 text-xs text-destructive">{nameError}</p> : null}
        </div>

        {/* Color picker */}
        <div className="flex items-center gap-2">
          <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="h-8 w-8 shrink-0 rounded-[4px] border transition hover:ring-2 hover:ring-primary hover:ring-offset-2 disabled:opacity-50"
                style={{ backgroundColor: savedColor, borderColor: savedColor }}
                aria-label="Change project color"
                disabled={colorSaveState === 'loading'}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2" align="start">
              <ProjectColorSetter value={savedColor} onSelect={handleSelectColor} />
            </PopoverContent>
          </Popover>
          {colorSaveState === 'loading' ? (
            <span className="text-xs text-muted-foreground">Saving…</span>
          ) : null}
          {colorError ? <span className="text-xs text-destructive">{colorError}</span> : null}
        </div>

        {hasEverhourApiKey ? (
          <div className="flex items-center gap-2">
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
              onClick={handleSyncEverhour}
            />
            {syncMessage ? (
              <span
                className="max-w-[240px] truncate text-xs text-muted-foreground"
                title={syncMessage}
              >
                {syncMessage}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-2 md:max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Local Working Directory
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={workingDirectory}
            onBlur={() => handleSaveWorkingDirectory()}
            onChange={e => setWorkingDirectory(e.target.value)}
            placeholder="/absolute/path/to/your/project"
            className="h-8 min-w-[320px] flex-1"
            disabled={workingDirectorySaveState === 'loading'}
          />
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
          <Button
            className="h-8"
            size="sm"
            variant="outline"
            disabled={workingDirectorySaveState === 'loading'}
            onClick={handleChooseDirectory}
          >
            Choose folder
          </Button>
          <LoadingButton
            buttonState={workingDirectorySaveState}
            setButtonState={setWorkingDirectorySaveState}
            text="Save path"
            loadingText="Saving…"
            successText="Saved"
            errorText="Retry"
            reset
            size="sm"
            variant="outline"
            onClick={() => handleSaveWorkingDirectory()}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          `Run Agent` will open terminal sessions in this directory for tickets in this project.
        </p>
        {workingDirectoryError ? (
          <p className="text-xs text-destructive">{workingDirectoryError}</p>
        ) : null}
      </div>
    </section>
  );
}
