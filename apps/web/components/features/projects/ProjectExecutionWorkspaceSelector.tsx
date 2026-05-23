'use client';

import { Check, ChevronDown, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useElectron } from '@/components/features/terminal/useElectron';
import { WorkspaceConnectionWarningModal } from '@/components/modals/WorkspaceConnectionWarningModal';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  getProjectResourceDirectoriesAction,
  type ProjectResourceDirectory,
  setResourceDirectoryPrimaryAction
} from '@/lib/actions/resource-directories';
import { cn } from '@/lib/utils';
import type { SshConnectionConfig } from '@/lib/workspace/types';

type ProjectExecutionWorkspaceSelectorProps = {
  projectId: string;
};

type RemoteWorkspacePayload = {
  mode: 'remote';
  ssh: SshConnectionConfig;
  remoteDirectory: string;
  projectId: string;
};

type SshFilesystemApi = {
  checkSshConnection?: (options: RemoteWorkspacePayload) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  directoryExists?: (options: RemoteWorkspacePayload) => Promise<boolean>;
};

function normalizeHost(hostname: string | null | undefined): string | null {
  if (!hostname?.trim()) return null;
  return hostname.trim().toLowerCase();
}

function resourceTitle(resource: ProjectResourceDirectory): string {
  if (resource.label?.trim()) return resource.label.trim();
  const path = resource.directoryPath;
  const parts = path.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || path;
}

export function ProjectExecutionWorkspaceSelector({
  projectId
}: ProjectExecutionWorkspaceSelectorProps) {
  const projectSettings = useProjectSettings();
  const { api, isElectron } = useElectron();
  const [resources, setResources] = useState<ProjectResourceDirectory[]>([]);
  const [matchedDeviceId, setMatchedDeviceId] = useState<string | null>(null);
  const [localHostname, setLocalHostname] = useState<string | null>(null);
  const [pathReachableById, setPathReachableById] = useState<Record<string, boolean>>({});
  const [sshWarningOpen, setSshWarningOpen] = useState(false);
  const [sshWarningPath, setSshWarningPath] = useState('');
  const [sshWarningError, setSshWarningError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHostHint() {
      try {
        const meta = await api?.app?.getHostMetadata?.();
        if (!cancelled && meta?.hostname) setLocalHostname(meta.hostname);
      } catch {
        // optional
      }
    }
    void loadHostHint();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function loadResources() {
      setLoading(true);
      try {
        let deviceFingerprint: string | null = null;
        if (api?.app?.getDeviceIdentity) {
          try {
            const identity = await api.app.getDeviceIdentity();
            deviceFingerprint = identity.deviceFingerprint?.trim()
              ? identity.deviceFingerprint.trim()
              : null;
          } catch {
            deviceFingerprint = null;
          }
        }
        const { resources: rows, matchedDeviceId: matchedId } =
          await getProjectResourceDirectoriesAction({
            projectId,
            deviceFingerprint
          });
        if (!cancelled) {
          setResources(rows);
          setMatchedDeviceId(matchedId);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadResources();
    return () => {
      cancelled = true;
    };
  }, [projectId, api]);

  const localNorm = normalizeHost(localHostname);

  function matchesThisDesktop(resource: ProjectResourceDirectory): boolean {
    if (matchedDeviceId && resource.deviceId) {
      return resource.deviceId === matchedDeviceId;
    }
    if (!localNorm || !resource.deviceId) return false;
    const dn = normalizeHost(resource.deviceHostname);
    return Boolean(dn && dn === localNorm);
  }

  useEffect(() => {
    const filesystem = api?.filesystem;
    if (!filesystem?.directoryExists || !resources.length) return;
    const { directoryExists } = filesystem;

    function resourceOnThisDesktop(resource: ProjectResourceDirectory): boolean {
      if (matchedDeviceId && resource.deviceId) {
        return resource.deviceId === matchedDeviceId;
      }
      const norm = normalizeHost(localHostname);
      if (!norm || !resource.deviceId) return false;
      return normalizeHost(resource.deviceHostname) === norm;
    }

    let cancelled = false;

    async function verifyLocalPaths() {
      const updates: Record<string, boolean> = {};
      await Promise.all(
        resources.map(async resource => {
          if (!resourceOnThisDesktop(resource)) return;
          try {
            const ok = await directoryExists({ directory: resource.directoryPath });
            if (!cancelled) updates[resource.id] = ok;
          } catch {
            if (!cancelled) updates[resource.id] = false;
          }
        })
      );
      if (!cancelled && Object.keys(updates).length) {
        setPathReachableById(prev => ({ ...prev, ...updates }));
      }
    }

    void verifyLocalPaths();

    return () => {
      cancelled = true;
    };
  }, [api, resources, matchedDeviceId, localHostname]);

  useEffect(() => {
    let cancelled = false;

    async function verifySsh() {
      const filesystem = api?.filesystem as
        | (NonNullable<Window['electronAPI']>['filesystem'] & SshFilesystemApi)
        | undefined;
      const checkSshConnection = filesystem?.checkSshConnection;
      const directoryExists = filesystem?.directoryExists;
      if (!checkSshConnection || !directoryExists) return;

      const sshCfg = projectSettings?.sshConnectionConfig;
      const sshLabel = projectSettings?.sshCommand;
      const remoteDir = projectSettings?.remoteWorkingDirectory ?? '/';

      if (!sshCfg || !sshLabel) return;

      try {
        const result = await checkSshConnection({
          mode: 'remote',
          ssh: sshCfg,
          remoteDirectory: remoteDir,
          projectId
        });

        if (cancelled) return;

        if (!result.ok) {
          setSshWarningPath(remoteDir !== '/' ? `${sshLabel} → ${remoteDir}` : sshLabel);
          setSshWarningError(result.error ?? 'SSH connection failed.');
          setSshWarningOpen(true);
          return;
        }

        const dirExists = await directoryExists({
          mode: 'remote',
          ssh: sshCfg,
          remoteDirectory: remoteDir,
          projectId
        });

        if (cancelled) return;

        if (!dirExists) {
          setSshWarningPath(`${sshLabel} → ${remoteDir}`);
          setSshWarningError('Remote directory does not exist.');
          setSshWarningOpen(true);
        }
      } catch {
        /* best-effort */
      }
    }

    void verifySsh();

    return () => {
      cancelled = true;
    };
  }, [
    api,
    projectSettings?.sshConnectionConfig,
    projectSettings?.sshCommand,
    projectSettings?.remoteWorkingDirectory,
    projectId
  ]);

  async function handleSetPrimary(resource: ProjectResourceDirectory) {
    if (resource.isPrimary || switchingId) return;
    setSwitchingId(resource.id);
    try {
      await setResourceDirectoryPrimaryAction({
        directoryId: resource.id,
        projectId
      });
      setResources(prev =>
        prev.map(r => ({
          ...r,
          isPrimary:
            r.executionTargetId === resource.executionTargetId ? r.id === resource.id : r.isPrimary
        }))
      );
      toast.success(`Switched execution to ${resourceTitle(resource)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch execution location.');
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleRevealInFinder(directoryPath: string) {
    if (!api?.app?.revealFile) return;

    try {
      await api.app.revealFile(directoryPath);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open in Finder.');
    }
  }

  if (!projectSettings) return null;
  const ps = projectSettings;

  const primaryResource = resources.find(r => r.isPrimary);
  const primaryLabel = primaryResource ? resourceTitle(primaryResource) : null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'mt-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] text-muted-foreground transition hover:bg-muted/60 hover:text-foreground md:mt-0',
              resources.length > 0 || ps.hasLocalDirectory
                ? 'border-border'
                : 'border-dashed border-muted-foreground/60'
            )}
            aria-label="Execution location"
            title="Switch execution location for this project"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Folder className="h-3 w-3" />
            )}
            <span className="max-w-[12rem] truncate sm:max-w-[16rem]">
              {loading
                ? 'Resources'
                : primaryLabel
                  ? primaryLabel
                  : resources.length === 0
                    ? 'No workspace'
                    : `${resources.length} resource${resources.length === 1 ? '' : 's'}`}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/80" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-96 max-h-[min(24rem,70vh)] overflow-y-auto p-0"
        >
          <div className="border-b px-3 py-2">
            <p className="text-xs font-medium text-foreground">Execution location</p>
            <p className="text-[11px] text-muted-foreground">
              Select which resource directory to use as the primary execution location for this
              project.
            </p>
          </div>
          {loading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Loading...</div>
          ) : resources.length === 0 ? (
            <div className="px-3 py-4 text-xs italic text-muted-foreground">
              No resource directories yet. Add one in project settings.
            </div>
          ) : (
            <ul className="py-1">
              {resources.map(resource => {
                const onThisDevice = matchesThisDesktop(resource);
                const pathOk =
                  onThisDevice && resource.id in pathReachableById
                    ? pathReachableById[resource.id]
                    : undefined;
                const otherLabel =
                  resource.deviceLabel?.trim() || resource.deviceHostname?.trim() || 'Other device';
                const isSwitching = switchingId === resource.id;
                return (
                  <li key={resource.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full gap-2 border-b border-border/60 px-3 py-2 text-left text-xs last:border-b-0 transition-colors',
                        resource.isPrimary ? 'bg-primary/5' : 'hover:bg-muted/60 cursor-pointer',
                        isSwitching && 'opacity-60'
                      )}
                      onClick={() => void handleSetPrimary(resource)}
                      disabled={resource.isPrimary || isSwitching}
                      title={
                        resource.isPrimary
                          ? 'Current execution location'
                          : `Switch execution to ${resourceTitle(resource)}`
                      }
                    >
                      <div className="flex shrink-0 items-start pt-0.5">
                        {isSwitching ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : resource.isPrimary ? (
                          <Check className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <span className="h-3.5 w-3.5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="truncate font-medium text-foreground"
                            title={resource.directoryPath}
                          >
                            {resourceTitle(resource)}
                          </span>
                          {resource.isPrimary ? (
                            <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                              Active
                            </span>
                          ) : null}
                          {onThisDevice && pathOk === false ? (
                            <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-400">
                              Path missing
                            </span>
                          ) : null}
                        </div>
                        <p
                          className="truncate font-mono text-[11px] text-muted-foreground"
                          title={resource.directoryPath}
                        >
                          {resource.directoryPath}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                        {onThisDevice && isElectron && api?.app?.revealFile ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground"
                            onClick={e => {
                              e.stopPropagation();
                              void handleRevealInFinder(resource.directoryPath);
                            }}
                            title="See in finder"
                          >
                            <FolderOpen className="h-3 w-3" />
                          </Button>
                        ) : null}
                        {onThisDevice ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
                            This device
                          </span>
                        ) : resource.deviceId ? (
                          <span
                            className="inline-flex max-w-[9rem] items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            title={otherLabel}
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/80"
                              aria-hidden
                            />
                            <span className="truncate">{otherLabel}</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                            <span
                              className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50"
                              aria-hidden
                            />
                            Unassigned device
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <DropdownMenuSeparator className="my-0" />
          <button
            type="button"
            className="w-full cursor-pointer px-3 py-2 text-left text-xs hover:bg-muted/60 transition-colors"
            onClick={() => ps.openProjectSettings('Resources')}
          >
            Manage resources...
          </button>
        </DropdownMenuContent>
      </DropdownMenu>

      <WorkspaceConnectionWarningModal
        open={sshWarningOpen}
        onOpenChange={setSshWarningOpen}
        workspaceType="ssh"
        path={sshWarningPath}
        error={sshWarningError}
        onOpenSettings={() => ps.openProjectSettings()}
      />
    </>
  );
}
