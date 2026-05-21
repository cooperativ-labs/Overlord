'use client';

import { useEffect, useState } from 'react';

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
import { useUpdateProjectSshConfigMutation } from '@/lib/client-data/projects/mutations';

type SshWorkspaceSectionProps = {
  projectId: string;
  initialSshHost: string | null;
  initialSshPort: number | null;
  initialSshUser: string | null;
  initialSshAuthMethod: ProjectSshAuthMethod | null;
  initialSshPrivateKeyPath: string | null;
  initialRemoteWorkingDirectory: string | null;
};

export function SshWorkspaceSection({
  projectId,
  initialSshHost,
  initialSshPort,
  initialSshUser,
  initialSshAuthMethod,
  initialSshPrivateKeyPath,
  initialRemoteWorkingDirectory
}: SshWorkspaceSectionProps) {
  const updateSshConfigMutation = useUpdateProjectSshConfigMutation();

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
  const sshHasUnsavedChanges =
    sshHost.trim() !== savedSshHost ||
    sshPort.trim() !== savedSshPort ||
    sshUser.trim() !== savedSshUser ||
    sshAuthMethod !== savedSshAuthMethod ||
    sshPrivateKeyPath.trim() !== savedSshPrivateKeyPath ||
    remoteWorkingDirectory.trim() !== savedRemoteWorkingDirectory;

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

  const hasSshConfig = savedSshHost.trim().length > 0 && savedSshUser.trim().length > 0;

  return (
    <div className="grid gap-2">
      <label className="text-xs font-medium text-muted-foreground">SSH / Remote workspace</label>
      <p className="text-xs text-muted-foreground">
        Saves SSH preferences for CLI and mobile. The Overlord desktop app uses a local folder only;
        use <code className="rounded bg-muted px-1">ovld</code> on the remote host for agent runs.
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
              <SelectItem value="agent">On-Device Key</SelectItem>
              {/* <SelectItem value="key">Private key</SelectItem>
              <SelectItem value="tailscale">Tailscale SSH</SelectItem> */}
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
  );
}
