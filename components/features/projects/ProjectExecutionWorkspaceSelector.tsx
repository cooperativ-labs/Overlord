'use client';

import { ChevronDown, Folder, Server } from 'lucide-react';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

type ProjectExecutionWorkspaceSelectorProps = {
  localDirectoryLabel: string;
  sshDirectoryLabel: string;
  sshTitle?: string;
};

export function ProjectExecutionWorkspaceSelector({
  localDirectoryLabel,
  sshDirectoryLabel,
  sshTitle
}: ProjectExecutionWorkspaceSelectorProps) {
  const projectSettings = useProjectSettings();

  if (!projectSettings) return null;

  const activeExecutionWorkspace = projectSettings.executionWorkspace;
  const executionWorkspaceLabel =
    activeExecutionWorkspace === 'ssh' ? 'SSH directory' : 'Local directory';
  const ExecutionWorkspaceIcon = activeExecutionWorkspace === 'ssh' ? Server : Folder;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
            projectSettings.hasLocalDirectory || projectSettings.hasSshDirectory
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
          onSelect={() => {
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
                projectSettings.hasLocalDirectory
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
          onSelect={() => {
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
                projectSettings.hasSshDirectory
                  ? 'text-muted-foreground'
                  : 'italic text-muted-foreground/80'
              )}
              title={sshTitle}
            >
              {sshDirectoryLabel}
            </p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
