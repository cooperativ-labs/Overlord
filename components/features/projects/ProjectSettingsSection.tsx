'use client';

import { Folder, GitCompareArrows, Settings } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  isWorkingDirectoryNone,
  updateProjectColorAction,
  updateProjectNameAction,
  updateProjectWorkingDirectoryAction
} from '@/lib/actions/projects';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

type ProjectSettingsSectionProps = {
  projectId: string;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
};

export function ProjectSettingsSection({
  projectId,
  initialName,
  initialColor,
  initialWorkingDirectory
}: ProjectSettingsSectionProps) {
  const { api, isElectron } = useElectron();
  const router = useRouter();
  const pathname = usePathname();
  const projectSettings = useProjectSettings();
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
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasSavedWorkingDirectory =
    savedWorkingDirectory.trim().length > 0 && !isWorkingDirectoryNone(savedWorkingDirectory);
  const isCurrentChangesView = pathname.startsWith(`/projects/${projectId}/current-changes`);
  const currentChangesToggleLabel = isCurrentChangesView ? 'Work Board' : 'Current Changes';
  const currentChangesToggleHref = isCurrentChangesView
    ? buildProjectPath({ projectId })
    : `/projects/${projectId}/current-changes`;
  const currentChangesToggleDisabled = !isCurrentChangesView && !hasSavedWorkingDirectory;
  const currentChangesToggleTitle = currentChangesToggleDisabled
    ? 'Link a project directory to inspect current changes'
    : isCurrentChangesView
      ? 'Open Work Board'
      : 'Open Current Changes';

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

  async function handleSaveWorkingDirectory(nextValue?: string) {
    const normalized = (nextValue ?? workingDirectory).trim();
    if (normalized === savedWorkingDirectory) {
      return;
    }

    setWorkingDirectorySaveState('loading');
    try {
      await updateProjectWorkingDirectoryAction({
        projectId,
        workingDirectory: normalized || null
      });
      setSavedWorkingDirectory(normalized);
      setWorkingDirectory(normalized);
      setWorkingDirectorySaveState('success');
      router.refresh();
    } catch {
      setWorkingDirectorySaveState('error');
    }
  }

  async function handleChooseDirectory() {
    if (!isElectron || !api) return;
    const chosenPath = await api.terminal.chooseDirectory();
    if (!chosenPath) return;
    setWorkingDirectory(chosenPath);
    await handleSaveWorkingDirectory(chosenPath);
  }

  return (
    <section className="px-5 py-5 border-b">
      {/* Name + color + optional sync */}
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={colorPopoverOpen} onOpenChange={setColorPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="h-5 w-5 shrink-0 rounded border transition hover:ring-2 hover:ring-primary hover:ring-offset-2 disabled:opacity-50"
              style={{ backgroundColor: savedColor, borderColor: savedColor }}
              aria-label="Change project color"
              disabled={colorSaveState === 'loading'}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <ProjectColorSetter value={savedColor} onSelect={handleSelectColor} />
          </PopoverContent>
        </Popover>

        <div className="min-w-0 flex-1 items-center gap-3 md:flex">
          {nameEditing ? (
            <Input
              ref={nameInputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Mobile App"
              className="h-7 max-w-xs font-semibold"
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
                'rounded px-1.5 py-0.5 text-left text-base font-semibold',
                'hover:bg-muted/60',
                '-ml-1.5'
              )}
              onClick={() => setNameEditing(true)}
            >
              {savedName || 'Untitled project'}
            </button>
          )}

          {isElectron ? (
            <>
              <button
                type="button"
                className={cn(
                  'mt-1 inline-flex max-w-xs items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
                  hasSavedWorkingDirectory
                    ? 'border-border'
                    : 'border-dashed border-muted-foreground/60 italic'
                )}
                onClick={handleChooseDirectory}
                disabled={workingDirectorySaveState === 'loading'}
                title={hasSavedWorkingDirectory ? savedWorkingDirectory : 'Add a project directory'}
              >
                <Folder className="h-3 w-3" />
                <span className="truncate">
                  {hasSavedWorkingDirectory ? savedWorkingDirectory : 'Add a project directory'}
                </span>
              </button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1 h-7 gap-1.5 text-xs md:mt-0"
                onClick={() => router.push(currentChangesToggleHref)}
                disabled={currentChangesToggleDisabled}
                title={currentChangesToggleTitle}
              >
                <GitCompareArrows className="h-3.5 w-3.5" />
                {currentChangesToggleLabel}
              </Button>
            </>
          ) : null}

          {projectSettings ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={projectSettings.openProjectSettings}
              aria-label="Project settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
    </section>
  );
}
