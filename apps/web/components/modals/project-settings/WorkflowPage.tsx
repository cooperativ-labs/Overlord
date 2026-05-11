'use client';

import { BookOpen, Download, Folder, Loader2, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ProjectStatusSettings } from '@/components/features/projects/ProjectStatusSettings';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Button } from '@/components/ui/button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { ProjectSshAuthMethod } from '@/lib/actions/project-types';
import {
  useUpdateProjectLocalVersionControlMutation,
  useUpdateProjectSshConfigMutation,
  useUpdateProjectWorkingDirectoryMutation
} from '@/lib/client-data/projects/mutations';
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
  initialLocalVersionControl: 'off' | 'jj';
  initialLocalVersionControlInstalledAt: string | null;
  initialLocalVersionControlError: string | null;
  initialSshCommand: string | null;
  initialRemoteWorkingDirectory: string | null;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
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
  initialLocalVersionControl,
  initialLocalVersionControlInstalledAt,
  initialLocalVersionControlError,
  initialSshCommand: _initialSshCommand,
  initialRemoteWorkingDirectory,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialStatuses
}: WorkflowPageProps) {
  const { api, isElectron } = useElectron();
  const updateWorkingDirectoryMutation = useUpdateProjectWorkingDirectoryMutation();
  const updateLocalVersionControlMutation = useUpdateProjectLocalVersionControlMutation();
  const updateSshConfigMutation = useUpdateProjectSshConfigMutation();
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [workingDirectorySaveState, setWorkingDirectorySaveState] =
    useState<ButtonLoadingState>('default');
  const [workingDirectoryError, setWorkingDirectoryError] = useState<string | null>(null);
  const [localVersionControl, setLocalVersionControl] = useState<'off' | 'jj'>(
    initialLocalVersionControl
  );
  const [localVersionControlInstalledAt, setLocalVersionControlInstalledAt] = useState<
    string | null
  >(initialLocalVersionControlInstalledAt);
  const [localVersionControlError, setLocalVersionControlError] = useState<string | null>(
    initialLocalVersionControlError
  );
  const [installingVersionControl, setInstallingVersionControl] = useState(false);
  const [openingHomebrewJjInstall, setOpeningHomebrewJjInstall] = useState(false);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const hasSavedWorkingDirectory =
    savedWorkingDirectory.trim().length > 0 && !isWorkingDirectoryNone(savedWorkingDirectory);

  // SSH remote workspace state (structured)
  const [sshHost, setSshHost] = useState(initialSshHost ?? '');
  const [sshPort, setSshPort] = useState(
    typeof initialSshPort === 'number' ? String(initialSshPort) : ''
  );
  const [sshUser, setSshUser] = useState(initialSshUser ?? '');
  const [sshAuthMethod, setSshAuthMethod] = useState<ProjectSshAuthMethod>(
    initialSshAuthMethod ?? 'agent'
  );
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState(initialSshPrivateKeyPath ?? '');
  const [remoteWorkingDirectory, setRemoteWorkingDirectory] = useState(
    initialRemoteWorkingDirectory ?? ''
  );

  const [savedSshHost, setSavedSshHost] = useState(initialSshHost ?? '');
  const [savedSshPort, setSavedSshPort] = useState(
    typeof initialSshPort === 'number' ? String(initialSshPort) : ''
  );
  const [savedSshUser, setSavedSshUser] = useState(initialSshUser ?? '');
  const [savedSshAuthMethod, setSavedSshAuthMethod] = useState<ProjectSshAuthMethod>(
    initialSshAuthMethod ?? 'agent'
  );
  const [savedSshPrivateKeyPath, setSavedSshPrivateKeyPath] = useState(
    initialSshPrivateKeyPath ?? ''
  );
  const [savedRemoteWorkingDirectory, setSavedRemoteWorkingDirectory] = useState(
    initialRemoteWorkingDirectory ?? ''
  );
  const [sshSaveState, setSshSaveState] = useState<ButtonLoadingState>('default');
  const [sshError, setSshError] = useState<string | null>(null);
  const hasSshConfig = savedSshHost.trim().length > 0 && savedSshUser.trim().length > 0;

  const isDarwinDesktop = useMemo(
    () =>
      isElectron &&
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent),
    [isElectron]
  );

  // Remote helper state
  const [helperInstalled, setHelperInstalled] = useState<boolean | null>(null);
  const [helperNeedsUpdate, setHelperNeedsUpdate] = useState(false);
  const [helperVersion, setHelperVersion] = useState<string | null>(null);
  const [installingHelper, setInstallingHelper] = useState(false);
  const sshHasUnsavedChanges =
    sshHost.trim() !== savedSshHost ||
    sshPort.trim() !== savedSshPort ||
    sshUser.trim() !== savedSshUser ||
    sshAuthMethod !== savedSshAuthMethod ||
    sshPrivateKeyPath.trim() !== savedSshPrivateKeyPath ||
    remoteWorkingDirectory.trim() !== savedRemoteWorkingDirectory;

  useEffect(() => {
    const next = initialWorkingDirectory ?? '';
    setWorkingDirectory(next);
    setSavedWorkingDirectory(next);
  }, [initialWorkingDirectory]);

  useEffect(() => {
    setLocalVersionControl(initialLocalVersionControl);
    setLocalVersionControlInstalledAt(initialLocalVersionControlInstalledAt);
    setLocalVersionControlError(initialLocalVersionControlError);
  }, [
    initialLocalVersionControl,
    initialLocalVersionControlError,
    initialLocalVersionControlInstalledAt
  ]);

  useEffect(() => {
    const host = initialSshHost ?? '';
    const portStr = typeof initialSshPort === 'number' ? String(initialSshPort) : '';
    const user = initialSshUser ?? '';
    const auth: ProjectSshAuthMethod = initialSshAuthMethod ?? 'agent';
    const key = initialSshPrivateKeyPath ?? '';
    const remote = initialRemoteWorkingDirectory ?? '';
    setSshHost(host);
    setSavedSshHost(host);
    setSshPort(portStr);
    setSavedSshPort(portStr);
    setSshUser(user);
    setSavedSshUser(user);
    setSshAuthMethod(auth);
    setSavedSshAuthMethod(auth);
    setSshPrivateKeyPath(key);
    setSavedSshPrivateKeyPath(key);
    setRemoteWorkingDirectory(remote);
    setSavedRemoteWorkingDirectory(remote);
  }, [
    initialSshAuthMethod,
    initialSshHost,
    initialSshPort,
    initialSshPrivateKeyPath,
    initialSshUser,
    initialRemoteWorkingDirectory
  ]);

  const savedSshConfig = useMemo(
    () =>
      savedSshHost.trim() && savedSshUser.trim()
        ? {
            host: savedSshHost.trim(),
            port: savedSshPort.trim() ? Number.parseInt(savedSshPort.trim(), 10) : undefined,
            user: savedSshUser.trim(),
            authMethod: savedSshAuthMethod,
            privateKeyPath: savedSshPrivateKeyPath.trim() || undefined
          }
        : null,
    [savedSshAuthMethod, savedSshHost, savedSshPort, savedSshPrivateKeyPath, savedSshUser]
  );

  useEffect(() => {
    if (!api?.remoteHelper || !projectId || !savedSshConfig) {
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
  }, [api, projectId, savedSshConfig]);

  async function handleInstallHelper() {
    if (!api?.remoteHelper || !projectId || !savedSshConfig) return;
    setInstallingHelper(true);
    try {
      const result = await api.remoteHelper.install({ projectId, ssh: savedSshConfig });
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

  async function handleSaveWorkingDirectory(nextValue?: string) {
    const normalized = (nextValue ?? workingDirectory).trim();
    if (normalized === savedWorkingDirectory) return;

    setWorkingDirectorySaveState('loading');
    setWorkingDirectoryError(null);
    try {
      await updateWorkingDirectoryMutation.mutateAsync({
        projectId,
        workingDirectory: normalized || null
      });
      setSavedWorkingDirectory(normalized);
      setWorkingDirectory(normalized);
      setWorkingDirectorySaveState('success');
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

  async function handleInstallVersionControl() {
    if (!hasSavedWorkingDirectory || !savedWorkingDirectory.trim()) {
      setLocalVersionControlError('A local working directory is required.');
      return;
    }
    if (!isElectron || !api?.filesystem?.installLocalVersionControl) {
      setLocalVersionControlError('Install version control from the Overlord desktop app.');
      return;
    }

    const confirmed = window.confirm(
      'Initialize Jujutsu (jj) in this folder?\n\nOverlord will run jj in your working directory so agent changes can be checkpointed. This only applies when jj is installed on your Mac.'
    );
    if (!confirmed) return;

    setInstallingVersionControl(true);
    setLocalVersionControlError(null);
    try {
      const result = await api.filesystem.installLocalVersionControl({
        directory: savedWorkingDirectory,
        mode: 'local'
      });
      if (!result.ok) {
        setLocalVersionControlError(result.error);
        await updateLocalVersionControlMutation.mutateAsync({
          projectId,
          mode: 'off',
          installedAt: null,
          error: result.error
        });
        return;
      }
      const installedAt = new Date().toISOString();
      await updateLocalVersionControlMutation.mutateAsync({
        projectId,
        mode: 'jj',
        installedAt,
        error: null
      });
      setLocalVersionControl('jj');
      setLocalVersionControlInstalledAt(installedAt);
      toast.success(
        result.alreadyInstalled ? 'Jujutsu already initialized here.' : 'Jujutsu initialized.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install version control.';
      setLocalVersionControlError(message);
      await updateLocalVersionControlMutation.mutateAsync({
        projectId,
        mode: 'off',
        installedAt: null,
        error: message
      });
    } finally {
      setInstallingVersionControl(false);
    }
  }

  async function handleOpenJjInstallGuide() {
    const url = 'https://docs.jj-vcs.dev/latest/install/';
    if (api?.app?.openExternal) {
      await api.app.openExternal(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function handleOpenHomebrewJjInstall() {
    if (!api?.terminal?.openHomebrewJjInstall) {
      toast.error('Update the Overlord desktop app, or use the install guide.');
      return;
    }
    setOpeningHomebrewJjInstall(true);
    try {
      const result = await api.terminal.openHomebrewJjInstall();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.message(
        'A terminal window should open. When jj is installed, click Initialize in this folder.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open terminal.');
    } finally {
      setOpeningHomebrewJjInstall(false);
    }
  }

  async function handleSaveSshConfig() {
    const host = sshHost.trim();
    const user = sshUser.trim();
    const portValue = sshPort.trim();
    const portNumber = portValue ? Number.parseInt(portValue, 10) : null;
    const privateKeyPath = sshPrivateKeyPath.trim();
    const remote = remoteWorkingDirectory.trim();

    if (host && !user) {
      setSshError('SSH user is required when a host is set.');
      return;
    }
    if (portValue && !Number.isFinite(portNumber)) {
      setSshError('SSH port must be a number.');
      return;
    }

    setSshSaveState('loading');
    setSshError(null);
    try {
      await updateSshConfigMutation.mutateAsync({
        projectId,
        sshHost: host || null,
        sshPort: portNumber,
        sshUser: user || null,
        sshAuthMethod: host ? sshAuthMethod : null,
        sshPrivateKeyPath: sshAuthMethod === 'key' ? privateKeyPath || null : null,
        remoteWorkingDirectory: remote || null
      });
      setSavedSshHost(host);
      setSavedSshPort(portValue);
      setSavedSshUser(user);
      setSavedSshAuthMethod(host ? sshAuthMethod : 'agent');
      setSavedSshPrivateKeyPath(sshAuthMethod === 'key' ? privateKeyPath : '');
      setSavedRemoteWorkingDirectory(remote);
      setSshSaveState('success');
    } catch (error) {
      setSshSaveState('error');
      setSshError(error instanceof Error ? error.message : 'Failed to update SSH configuration.');
    }
  }

  async function handleClearSshConfig() {
    setSshSaveState('loading');
    setSshError(null);
    try {
      await updateSshConfigMutation.mutateAsync({
        projectId,
        sshHost: null,
        sshPort: null,
        sshUser: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
        remoteWorkingDirectory: null
      });
      setSshHost('');
      setSavedSshHost('');
      setSshPort('');
      setSavedSshPort('');
      setSshUser('');
      setSavedSshUser('');
      setSshAuthMethod('agent');
      setSavedSshAuthMethod('agent');
      setSshPrivateKeyPath('');
      setSavedSshPrivateKeyPath('');
      setRemoteWorkingDirectory('');
      setSavedRemoteWorkingDirectory('');
      setSshSaveState('success');
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
          <div className="mt-2 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-col gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium">Local checkpoints (Jujutsu / jj)</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This stays{' '}
                  <span className="font-medium text-foreground">off unless you turn it on</span>.
                  Overlord does not run jj against your folder until you initialize it here, so copied
                  or imported repos are not tracked in the background. When enabled, Overlord uses{' '}
                  <a
                    className="underline underline-offset-2"
                    href="/docs/workflow/file-changes"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Jujutsu
                  </a>{' '}
                  in the working directory above for checkpoints and clearer file-change metadata.
                </p>
                <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>
                    Install the <code className="rounded bg-muted px-1">jj</code> CLI on this
                    machine (the desktop app uses the same PATH as other GUI apps; Homebrew installs
                    usually land in <code className="rounded bg-muted px-1">/opt/homebrew/bin</code>
                    ).
                  </li>
                  <li>
                    Choose <span className="font-medium text-foreground">Initialize in this folder</span>{' '}
                    so jj metadata exists directly in that directory (or adopt an existing jj repo
                    there).
                  </li>
                </ol>
                {localVersionControl === 'jj' ? (
                  <p className="mt-2 text-xs text-emerald-600">
                    Jujutsu active for this project
                    {localVersionControlInstalledAt
                      ? ` · ${new Date(localVersionControlInstalledAt).toLocaleString()}`
                      : ''}
                  </p>
                ) : null}
                {localVersionControlError ? (
                  <p className="mt-2 text-xs text-destructive">{localVersionControlError}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isDarwinDesktop ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void handleOpenHomebrewJjInstall()}
                    disabled={openingHomebrewJjInstall}
                  >
                    {openingHomebrewJjInstall ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Opening…
                      </>
                    ) : (
                      <>
                        <Terminal className="h-3.5 w-3.5" />
                        Install jj (Homebrew)
                      </>
                    )}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void handleOpenJjInstallGuide()}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Install guide
                </Button>
                <Button
                  type="button"
                  variant={localVersionControl === 'jj' ? 'outline' : 'default'}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleInstallVersionControl}
                  disabled={
                    installingVersionControl ||
                    !hasSavedWorkingDirectory ||
                    localVersionControl === 'jj'
                  }
                >
                  {installingVersionControl ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Initializing…
                    </>
                  ) : localVersionControl === 'jj' ? (
                    'Initialized'
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      Initialize in this folder
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
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
          <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
            <input
              type="text"
              value={sshHost}
              onChange={e => setSshHost(e.target.value)}
              placeholder="Host, e.g. 10.0.0.5 or host.tailnet.ts.net"
              className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <input
              type="text"
              value={sshPort}
              onChange={e => setSshPort(e.target.value)}
              placeholder="Port (22)"
              inputMode="numeric"
              className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <input
              type="text"
              value={sshUser}
              onChange={e => setSshUser(e.target.value)}
              placeholder="User, e.g. jake"
              className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <Select
              value={sshAuthMethod}
              onValueChange={value => setSshAuthMethod(value as ProjectSshAuthMethod)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Auth method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">ssh-agent</SelectItem>
                <SelectItem value="key">Private key</SelectItem>
                <SelectItem value="tailscale">Tailscale SSH</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sshAuthMethod === 'key' ? (
            <input
              type="text"
              value={sshPrivateKeyPath}
              onChange={e => setSshPrivateKeyPath(e.target.value)}
              placeholder="Private key path, e.g. ~/.ssh/id_ed25519"
              className="h-8 w-full rounded-md border bg-background px-2.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          ) : null}
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
        {hasSshConfig && helperInstalled !== null ? (
          <div className="flex items-center gap-2 pt-1">
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
            ) : helperNeedsUpdate ? (
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
            ) : (
              <span
                className="inline-flex h-7 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-muted-foreground"
                title={
                  helperVersion ? `Remote helper v${helperVersion}` : 'Remote helper installed'
                }
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Helper ready
              </span>
            )}
          </div>
        ) : null}
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
