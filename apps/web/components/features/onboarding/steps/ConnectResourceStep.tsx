'use client';

import * as Sentry from '@sentry/nextjs';
import { FolderOpen, FolderSearch } from 'lucide-react';
import { useRef, useState } from 'react';

import { DEFAULT_PROJECT_COLOR } from '@/components/features/projects/ProjectColorSetter';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { createFirstOrganization, createFirstProjectWithDirectory } from '@/lib/actions/onboarding';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';

const createFirstProjectWithDirectoryWithRetry = withElectronActionRetry(
  createFirstProjectWithDirectory
);
const createFirstOrganizationWithRetry = withElectronActionRetry(createFirstOrganization);

function extractDirectoryName(path: string): string {
  const trimmed = path.replace(/\/+$/, '').trim();
  const lastSegment = trimmed.split('/').pop() || trimmed.split('\\').pop() || trimmed;
  return lastSegment || 'My Project';
}

type Props = {
  organizationId: number | null;
  onConnected: (result: {
    projectId: string;
    organizationId: number;
    executionTargetId: string | null;
    workingDirectory: string;
  }) => void;
};

export function ConnectResourceStep({ organizationId, onConnected }: Props) {
  const { api, isElectron } = useElectron();
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
  const directoryInputRef = useRef<HTMLInputElement>(null);

  async function handleChooseDirectory() {
    setError(null);
    if (isElectron && api) {
      try {
        const chosenPath = await api.terminal.chooseDirectory();
        if (!chosenPath) return;
        setWorkingDirectory(chosenPath);
        return;
      } catch (err) {
        Sentry.captureException(err);
        console.error('handleChooseDirectory', err);
      }
    }
    const w =
      typeof window !== 'undefined'
        ? (window as Window & { showDirectoryPicker?(): Promise<{ name: string }> })
        : null;
    if (w?.showDirectoryPicker) {
      try {
        const handle = await w.showDirectoryPicker();
        setWorkingDirectory(handle.name);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setError('Could not access the selected folder.');
        }
      }
      return;
    }
    directoryInputRef.current?.click();
  }

  function handleWebDirectoryInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    const folderName = firstPath ? firstPath.split('/')[0] : '';
    e.target.value = '';
    if (folderName) setWorkingDirectory(folderName);
  }

  async function handleConnect() {
    const trimmedDir = workingDirectory.trim();
    if (!trimmedDir) {
      setError('Please select or enter a directory path.');
      return;
    }

    setButtonState('loading');
    setError(null);

    try {
      let orgId = organizationId;
      if (!orgId) {
        const orgResult = await createFirstOrganizationWithRetry({ name: 'My organization' });
        orgId = orgResult.organizationId;
      }

      const projectName = extractDirectoryName(trimmedDir);

      let deviceIdentity: {
        deviceFingerprint: string;
        hostname: string;
        platform: string;
      } | null = null;
      if (isElectron && api?.app?.getDeviceIdentity) {
        try {
          deviceIdentity = await api.app.getDeviceIdentity();
        } catch (err) {
          Sentry.captureException(err);
        }
      }

      const result = await createFirstProjectWithDirectoryWithRetry({
        organizationId: orgId,
        name: projectName,
        color: DEFAULT_PROJECT_COLOR,
        workingDirectory: trimmedDir,
        ...(deviceIdentity
          ? {
              deviceFingerprint: deviceIdentity.deviceFingerprint,
              deviceHostname: deviceIdentity.hostname,
              devicePlatform: deviceIdentity.platform
            }
          : {})
      });

      if (isElectron && api?.filesystem?.writeOverlordConfig) {
        try {
          await api.filesystem.writeOverlordConfig({
            directory: trimmedDir,
            projectId: result.projectId,
            projectName
          });
        } catch (err) {
          Sentry.captureException(err);
        }
      }

      setButtonState('success');
      onConnected({
        projectId: result.projectId,
        organizationId: result.organizationId,
        executionTargetId: result.executionTargetId,
        workingDirectory: trimmedDir
      });
    } catch (err) {
      setButtonState('error');
      setError(err instanceof Error ? err.message : 'Failed to connect resource.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Connect your first repository</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose a project directory. Overlord will create a project from this folder and use it as
          the working directory for agent runs.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
            <FolderSearch className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">One folder, one project</p>
            <p className="text-muted-foreground text-sm">
              The folder name becomes the project name. Agents will open terminals in this directory
              when working on tickets.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={workingDirectory}
            onChange={event => {
              setWorkingDirectory(event.target.value);
              if (error) setError(null);
            }}
            placeholder={
              isElectron ? '/absolute/path/to/your/project' : 'Select a folder or type a path'
            }
            className="min-w-[260px] flex-1"
            aria-invalid={!!error}
          />
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
          <Button type="button" variant="outline" size="sm" onClick={handleChooseDirectory}>
            <FolderOpen className="h-4 w-4" />
            Browse
          </Button>
        </div>
        {workingDirectory.trim() && (
          <p className="text-muted-foreground text-xs">
            Project name:{' '}
            <span className="font-medium">{extractDirectoryName(workingDirectory)}</span>
          </p>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <LoadingButton
        buttonState={buttonState}
        setButtonState={setButtonState}
        text="Connect & create project"
        loadingText="Connecting…"
        successText="Connected"
        errorText="Retry"
        onClick={handleConnect}
        disabled={!workingDirectory.trim()}
      />
    </div>
  );
}
