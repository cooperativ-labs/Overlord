'use client';

import { Settings } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { ProjectExecutionWorkspaceSelector } from '@/components/features/projects/ProjectExecutionWorkspaceSelector';
import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  useUpdateProjectColorMutation,
  useUpdateProjectNameMutation
} from '@/lib/client-data/projects/mutations';
import { isWorkingDirectoryNone } from '@/lib/helpers/project-working-directory';
import { buildProjectPath } from '@/lib/helpers/ticket-path';
import { cn } from '@/lib/utils';

type ProjectSettingsSectionProps = {
  projectId: string;
  initialName: string;
  initialColor: string;
  initialWorkingDirectory: string | null;
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
};

export function ProjectSettingsSection({
  projectId,
  initialName,
  initialColor,
  initialWorkingDirectory,
  initialSshCommand,
  initialRemoteWorkingDirectory
}: ProjectSettingsSectionProps) {
  const { isElectron } = useElectron();
  const router = useRouter();
  const updateProjectNameMutation = useUpdateProjectNameMutation();
  const updateProjectColorMutation = useUpdateProjectColorMutation();
  const pathname = usePathname();
  const projectSettings = useProjectSettings();
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [nameEditing, setNameEditing] = useState(false);
  const [savedColor, setSavedColor] = useState(initialColor);
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [nameSaveState, setNameSaveState] = useState<ButtonLoadingState>('default');
  const [colorSaveState, setColorSaveState] = useState<ButtonLoadingState>('default');
  const [nameError, setNameError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const hasSavedWorkingDirectory =
    savedWorkingDirectory.trim().length > 0 && !isWorkingDirectoryNone(savedWorkingDirectory);
  const isCurrentChangesView = pathname.startsWith(`/projects/${projectId}/current-changes`);
  const workBoardHref = buildProjectPath({ projectId });
  const currentChangesHref = `/projects/${projectId}/current-changes`;
  const currentChangesToggleDisabled = !isCurrentChangesView && !hasSavedWorkingDirectory;
  const currentChangesToggleTitle = currentChangesToggleDisabled
    ? 'Link a project directory to inspect current changes'
    : 'Open Current Changes';
  const localDirectoryLabel = hasSavedWorkingDirectory ? savedWorkingDirectory : 'configure';
  const hasSshDirectory = Boolean(initialSshCommand?.trim());
  const sshDirectoryLabel = initialRemoteWorkingDirectory?.trim() || 'configure';
  const sshTitle = hasSshDirectory
    ? `${initialSshCommand}${initialRemoteWorkingDirectory ? ` → ${initialRemoteWorkingDirectory}` : ''}`
    : 'Configure SSH workspace';

  useEffect(() => {
    setSavedColor(initialColor);
  }, [initialColor]);

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
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
      await updateProjectNameMutation.mutateAsync({ projectId, name: trimmed });
      setSavedName(trimmed);
      setNameSaveState('success');
      setNameEditing(false);
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
      await updateProjectColorMutation.mutateAsync({ projectId, color: color.toLowerCase() });
      setSavedColor(color.toLowerCase());
      setColorSaveState('success');
      setColorPopoverOpen(false);
    } catch (error) {
      setColorSaveState('error');
      setColorError(error instanceof Error ? error.message : 'Failed to update color.');
    }
  }

  return (
    <section className="px-5 py-2 border-b">
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
          <div className="flex items-center gap-2">
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
            {projectSettings ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => projectSettings.openProjectSettings()}
                aria-label="Project settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {isElectron ? (
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <ProjectExecutionWorkspaceSelector
                localDirectoryLabel={localDirectoryLabel}
                sshDirectoryLabel={sshDirectoryLabel}
                sshTitle={sshTitle}
              />

              <div className="flex items-center rounded-lg border bg-muted/40 p-1">
                <button
                  type="button"
                  className={cn(
                    'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    !isCurrentChangesView
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => router.push(workBoardHref)}
                  aria-pressed={!isCurrentChangesView}
                  title="Open Work Board"
                >
                  Work Board
                </button>
                <button
                  type="button"
                  className={cn(
                    'relative overflow-hidden rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                    isCurrentChangesView
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => router.push(currentChangesHref)}
                  disabled={currentChangesToggleDisabled}
                  aria-pressed={isCurrentChangesView}
                  title={currentChangesToggleTitle}
                >
                  {!isCurrentChangesView && !currentChangesToggleDisabled ? (
                    <span className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_6s_ease-in-out_infinite] bg-linear-to-r from-transparent via-sky-500/20 to-transparent" />
                  ) : null}
                  <span className="relative z-10">Current Changes</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
    </section>
  );
}
