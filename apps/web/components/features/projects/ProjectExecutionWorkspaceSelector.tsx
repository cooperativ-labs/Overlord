'use client';

import { ChevronDown, Folder, Loader2, Server } from 'lucide-react';
import { useState } from 'react';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import { WorkspaceConnectionWarningModal } from '@/components/modals/WorkspaceConnectionWarningModal';
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
  sshFeatureEnabled: boolean;
};

export function ProjectExecutionWorkspaceSelector({
  localDirectoryLabel,
  sshDirectoryLabel,
  sshTitle,
  sshFeatureEnabled
}: ProjectExecutionWorkspaceSelectorProps) {
  const projectSettings = useProjectSettings();
  const { api } = useElectron();
  const [checking, setChecking] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningType, setWarningType] = useState<'local' | 'ssh'>('local');
  const [warningPath, setWarningPath] = useState('');
  const [warningError, setWarningError] = useState<string | null>(null);

  const sshConfig = projectSettings?.sshConnectionConfig ?? null;
  const projectId = projectSettings?.projectId ?? null;

  if (!projectSettings) return null;

  const activeExecutionWorkspace = projectSettings.executionWorkspace;
  const executionWorkspaceLabel =
    activeExecutionWorkspace === 'ssh' ? 'Remote directory' : 'Local directory';
  const ExecutionWorkspaceIcon = activeExecutionWorkspace === 'ssh' ? Server : Folder;

  async function checkConnection(workspace: 'local' | 'ssh') {
    if (!api?.filesystem) return;

    setChecking(true);
    try {
      if (workspace === 'local') {
        const dir = projectSettings!.localWorkingDirectory;
        if (!dir) return;
        const exists = await api.filesystem.directoryExists({ directory: dir });
        if (!exists) {
          setWarningType('local');
          setWarningPath(dir);
          setWarningError('Directory does not exist or is not accessible.');
          setWarningOpen(true);
        }
      } else {
        const ssh = projectSettings!.sshConnectionConfig;
        const sshLabel = projectSettings!.sshCommand;
        const remoteDir = projectSettings!.remoteWorkingDirectory;
        if (!ssh || !sshLabel) return;
        const result = await api.filesystem.checkSshConnection({
          mode: 'remote',
          ssh,
          remoteDirectory: remoteDir ?? '/',
          projectId: projectSettings!.projectId
        });
        if (!result.ok) {
          setWarningType('ssh');
          setWarningPath(remoteDir ? `${sshLabel} → ${remoteDir}` : sshLabel);
          setWarningError(result.error ?? 'SSH connection failed.');
          setWarningOpen(true);
        } else if (remoteDir) {
          const dirExists = await api.filesystem.directoryExists({
            mode: 'remote',
            ssh,
            remoteDirectory: remoteDir,
            projectId: projectSettings!.projectId
          });
          if (!dirExists) {
            setWarningType('ssh');
            setWarningPath(`${sshLabel} → ${remoteDir}`);
            setWarningError('Remote directory does not exist.');
            setWarningOpen(true);
          }
        }
      }
    } catch {
      // Silently ignore — the check is best-effort
    } finally {
      setChecking(false);
    }
  }

  const sshWorkspaceAvailable =
    sshFeatureEnabled && (projectSettings.hasSshDirectory || Boolean(sshConfig));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
              projectSettings.hasLocalDirectory || sshWorkspaceAvailable
                ? 'border-border'
                : 'border-dashed border-muted-foreground/60'
            )}
            aria-label="Select project execution workspace"
            title="Choose where project jobs should execute"
          >
            {checking ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ExecutionWorkspaceIcon className="h-3 w-3" />
            )}
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
              void checkConnection('local');
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
          {sshFeatureEnabled ? (
            <DropdownMenuItem
              className="items-start gap-3"
              onSelect={() => {
                if (!sshWorkspaceAvailable) {
                  projectSettings.openProjectSettings();
                  return;
                }
                projectSettings.setExecutionWorkspace('ssh');
                void checkConnection('ssh');
              }}
            >
              <Server className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">Remote directory</span>
                  {activeExecutionWorkspace === 'ssh' ? (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-primary">
                      Active
                    </span>
                  ) : null}
                </div>
                <p
                  className={cn(
                    'truncate text-xs',
                    sshWorkspaceAvailable
                      ? 'text-muted-foreground'
                      : 'italic text-muted-foreground/80'
                  )}
                  title={sshTitle}
                >
                  {sshDirectoryLabel}
                </p>
              </div>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceConnectionWarningModal
        open={warningOpen}
        onOpenChange={setWarningOpen}
        workspaceType={warningType}
        path={warningPath}
        error={warningError}
        onOpenSettings={projectSettings.openProjectSettings}
      />
    </>
  );
}
