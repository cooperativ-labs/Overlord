'use client';

import { ChevronDown, Download, Folder, Loader2, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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
};

export function ProjectExecutionWorkspaceSelector({
  localDirectoryLabel,
  sshDirectoryLabel,
  sshTitle
}: ProjectExecutionWorkspaceSelectorProps) {
  const projectSettings = useProjectSettings();
  const { api } = useElectron();
  const [checking, setChecking] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [warningType, setWarningType] = useState<'local' | 'ssh'>('local');
  const [warningPath, setWarningPath] = useState('');
  const [warningError, setWarningError] = useState<string | null>(null);
  const [tailscaleActive, setTailscaleActive] = useState(false);
  const [helperInstalled, setHelperInstalled] = useState<boolean | null>(null);
  const [helperNeedsUpdate, setHelperNeedsUpdate] = useState(false);
  const [helperVersion, setHelperVersion] = useState<string | null>(null);
  const [installingHelper, setInstallingHelper] = useState(false);

  const sshConfig = projectSettings?.sshConnectionConfig ?? null;
  const projectId = projectSettings?.projectId ?? null;

  useEffect(() => {
    if (!api?.tailscale) return;
    let cancelled = false;
    void api.tailscale
      .getStatus()
      .then(status => {
        if (!cancelled) setTailscaleActive(status.running && status.loggedIn);
      })
      .catch(() => {
        if (!cancelled) setTailscaleActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!api?.remoteHelper || !projectId || !sshConfig) {
      setHelperInstalled(null);
      return;
    }
    let cancelled = false;
    void api.remoteHelper
      .status({ projectId })
      .then(result => {
        if (cancelled) return;
        setHelperInstalled(result.installed);
        setHelperVersion(result.version ?? null);
        setHelperNeedsUpdate(Boolean(result.needsUpdate));
      })
      .catch(() => {
        if (!cancelled) setHelperInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, sshConfig]);

  async function handleInstallHelper() {
    if (!api?.remoteHelper || !projectId || !sshConfig) return;
    setInstallingHelper(true);
    try {
      const result = await api.remoteHelper.install({ projectId, ssh: sshConfig });
      if (!result.ok) {
        toast.error(result.error ?? 'Failed to install remote helper.');
        return;
      }
      toast.success('Remote helper installed.');
      setHelperInstalled(true);
      setHelperVersion(result.version ?? null);
      setHelperNeedsUpdate(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to install remote helper.');
    } finally {
      setInstallingHelper(false);
    }
  }

  if (!projectSettings) return null;

  const activeExecutionWorkspace = projectSettings.executionWorkspace;
  const executionWorkspaceLabel =
    activeExecutionWorkspace === 'ssh' ? 'Execute over SSH' : 'Execute locally';
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

  const showSshAffordances =
    activeExecutionWorkspace === 'ssh' && projectSettings.hasSshDirectory && Boolean(sshConfig);

  return (
    <>
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
                <span className="text-sm font-medium text-foreground">Execute locally</span>
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
              void checkConnection('ssh');
            }}
          >
            <Server className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">Execute over SSH</span>
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

      {showSshAffordances ? (
        <div className="mt-1 flex items-center gap-1.5 md:mt-0">
          {tailscaleActive ? (
            <span
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted-foreground"
              title="Tailscale is running on this machine"
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Tailscale
            </span>
          ) : null}
          {helperInstalled === false ? (
            <button
              type="button"
              onClick={handleInstallHelper}
              disabled={installingHelper}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-muted-foreground/60 px-2 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              title="Install the Overlord remote helper on this host"
            >
              {installingHelper ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Install helper
            </button>
          ) : null}
          {helperInstalled === true && helperNeedsUpdate ? (
            <button
              type="button"
              onClick={handleInstallHelper}
              disabled={installingHelper}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-amber-500/60 px-2 text-[11px] text-amber-600 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-60"
              title={`Helper v${helperVersion ?? 'unknown'} installed; bundled version is newer. Click to update.`}
            >
              {installingHelper ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              Update helper
            </button>
          ) : helperInstalled === true ? (
            <span
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted-foreground"
              title={helperVersion ? `Remote helper v${helperVersion}` : 'Remote helper installed'}
            >
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Helper ready
            </span>
          ) : null}
        </div>
      ) : null}

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
