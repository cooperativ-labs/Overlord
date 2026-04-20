'use client';

import { Folder } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
import type { ProjectSshAuthMethod } from '@/lib/actions/projects';
import {
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
  const updateSshConfigMutation = useUpdateProjectSshConfigMutation();
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState(initialWorkingDirectory ?? '');
  const [workingDirectorySaveState, setWorkingDirectorySaveState] =
    useState<ButtonLoadingState>('default');
  const [workingDirectoryError, setWorkingDirectoryError] = useState<string | null>(null);
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
