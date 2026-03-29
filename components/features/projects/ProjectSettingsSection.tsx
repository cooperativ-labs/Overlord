'use client';

import { ChevronDown, Folder, GitCompareArrows, Server, Settings } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ProjectColorSetter } from '@/components/features/projects/ProjectColorSetter';
import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { updateProjectColorAction, updateProjectNameAction } from '@/lib/actions/projects';
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
  const localDirectoryLabel = hasSavedWorkingDirectory ? savedWorkingDirectory : 'configure';
  const hasSshDirectory = Boolean(initialSshCommand?.trim());
  const sshDirectoryLabel = initialRemoteWorkingDirectory?.trim() || 'configure';
  const activeExecutionWorkspace = projectSettings?.executionWorkspace ?? 'local';
  const executionWorkspaceLabel =
    activeExecutionWorkspace === 'ssh' ? 'SSH directory' : 'Local directory';
  const ExecutionWorkspaceIcon = activeExecutionWorkspace === 'ssh' ? Server : Folder;

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
                onClick={projectSettings.openProjectSettings}
                aria-label="Project settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          {isElectron ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
                      projectSettings?.hasLocalDirectory || projectSettings?.hasSshDirectory
                        ? 'border-border'
                        : 'border-dashed border-muted-foreground/60'
                    )}
                    aria-label="Select project execution workspace"
                    title="Choose where project jobs should execute"
                  >
                    <ExecutionWorkspaceIcon className="h-3 w-3" />
                    <span>{executionWorkspaceLabel}</span>
                    <ChevronDown className="h-3 w-3 text-muted-foreground/80" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                  <DropdownMenuItem
                    className="items-start gap-3"
                    onClick={() => {
                      if (!projectSettings) return;
                      if (!projectSettings.hasLocalDirectory) {
                        projectSettings.openProjectSettings();
                        return;
                      }
                      projectSettings.setExecutionWorkspace('local');
                    }}
                  >
                    <Folder className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">Local directory</span>
                        {activeExecutionWorkspace === 'local' ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          'truncate text-xs',
                          projectSettings?.hasLocalDirectory
                            ? 'text-muted-foreground'
                            : 'italic text-muted-foreground/80'
                        )}
                      >
                        {localDirectoryLabel}
                      </p>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="items-start gap-3"
                    onClick={() => {
                      if (!projectSettings) return;
                      if (!projectSettings.hasSshDirectory) {
                        projectSettings.openProjectSettings();
                        return;
                      }
                      projectSettings.setExecutionWorkspace('ssh');
                    }}
                  >
                    <Server className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">SSH directory</span>
                        {activeExecutionWorkspace === 'ssh' ? (
                          <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                            Active
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={cn(
                          'truncate text-xs',
                          hasSshDirectory ? 'text-muted-foreground' : 'italic text-muted-foreground/80'
                        )}
                        title={
                          hasSshDirectory
                            ? `${initialSshCommand}${initialRemoteWorkingDirectory ? ` → ${initialRemoteWorkingDirectory}` : ''}`
                            : 'Configure SSH workspace'
                        }
                      >
                        {sshDirectoryLabel}
                      </p>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

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
        </div>
      </div>

      {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      {colorError ? <p className="text-xs text-destructive">{colorError}</p> : null}
    </section>
  );
}
