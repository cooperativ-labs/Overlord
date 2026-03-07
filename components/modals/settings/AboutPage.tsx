'use client';

import { useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import { getRunningAgentSessionCountAction } from '@/lib/actions/agent-sessions';

type ElectronAppUpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

export function AboutPage({ open }: { open: boolean }) {
  const { api, isElectron } = useElectron();

  const [updateStatus, setUpdateStatus] = useState<ElectronAppUpdateStatus | null>(null);
  const [checkUpdateButtonState, setCheckUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [downloadUpdateButtonState, setDownloadUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [restartToUpdateButtonState, setRestartToUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [installWarningOpen, setInstallWarningOpen] = useState(false);
  const [runningAgentCount, setRunningAgentCount] = useState(0);
  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  const canShowDownloadUpdate = updateStatus?.phase === 'available';
  const canShowInstallUpdate = updateStatus?.phase === 'downloaded';
  const updateStatusMessage =
    updateStatus?.message ?? 'Use Check for updates to look for a newer release.';

  useEffect(() => {
    if (!open || !api) return;

    api.appUpdate
      .getStatus()
      .then(status => setUpdateStatus(status))
      .catch(() => setUpdateStatus(null));

    const unsubscribe = api.appUpdate.onStatus(status => {
      setUpdateStatus(status);
      if (status.phase === 'available') setDownloadUpdateButtonState('default');
      if (status.phase === 'downloaded') setRestartToUpdateButtonState('default');
    });

    return unsubscribe;
  }, [api, open]);

  useEffect(() => {
    if (!open) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
  }, [open]);

  async function handleCheckForUpdates() {
    if (!api) return;
    setCheckUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.checkForUpdates();
      setCheckUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to check for updates:', error);
      setCheckUpdateButtonState('error');
    }
  }

  async function handleDownloadUpdate() {
    if (!api) return;
    setDownloadUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.downloadUpdate();
      setDownloadUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to download update:', error);
      setDownloadUpdateButtonState('error');
    }
  }

  async function restartToInstallUpdate() {
    if (!api) return;
    setRestartToUpdateButtonState('loading');
    try {
      const started = await api.appUpdate.quitAndInstall();
      setRestartToUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to restart and install update:', error);
      setRestartToUpdateButtonState('error');
    }
  }

  async function handleRestartToInstallUpdate() {
    if (!api) return;
    setRestartToUpdateButtonState('loading');
    try {
      const runningCount = await getRunningAgentSessionCountAction();
      if (runningCount > 0) {
        setRunningAgentCount(runningCount);
        setInstallWarningOpen(true);
        setRestartToUpdateButtonState('default');
        return;
      }
      const started = await api.appUpdate.quitAndInstall();
      setRestartToUpdateButtonState(started ? 'success' : 'error');
    } catch (error) {
      console.error('Failed to restart and install update:', error);
      setRestartToUpdateButtonState('error');
    }
  }

  return (
    <>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <p className="text-sm font-medium">About</p>
          <p className="text-xs text-muted-foreground">
            Overlord helps you coordinate agent and human execution from one shared ticket workflow.
          </p>
        </div>

        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            Version {updateStatus?.currentVersion ?? 'unknown'}
            {updateStatus?.availableVersion ? ` • Latest ${updateStatus.availableVersion}` : ''}
          </p>
          {platformUrl ? (
            <p className="mt-1 text-xs text-muted-foreground">Platform URL: {platformUrl}</p>
          ) : null}
        </div>

        {isElectron ? (
          <div className="grid gap-2">
            <p className="text-xs text-muted-foreground">{updateStatusMessage}</p>
            <div className="flex flex-wrap gap-2">
              <LoadingButton
                buttonState={checkUpdateButtonState}
                setButtonState={setCheckUpdateButtonState}
                text="Check for updates"
                loadingText="Checking..."
                successText="Check started"
                errorText="Try again"
                reset
                variant="outline"
                onClick={handleCheckForUpdates}
              />
              {canShowDownloadUpdate ? (
                <LoadingButton
                  buttonState={downloadUpdateButtonState}
                  setButtonState={setDownloadUpdateButtonState}
                  text="Download update"
                  loadingText="Starting download..."
                  successText="Download started"
                  errorText="Unavailable"
                  reset
                  variant="outline"
                  onClick={handleDownloadUpdate}
                />
              ) : null}
              {canShowInstallUpdate ? (
                <LoadingButton
                  buttonState={restartToUpdateButtonState}
                  setButtonState={setRestartToUpdateButtonState}
                  text="Install update"
                  loadingText="Installing..."
                  successText="Installing..."
                  errorText="Unavailable"
                  variant="default"
                  onClick={handleRestartToInstallUpdate}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Update controls are available in the desktop app.
          </p>
        )}
      </div>

      {isElectron ? (
        <AlertDialog open={installWarningOpen} onOpenChange={setInstallWarningOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Install update now?</AlertDialogTitle>
              <AlertDialogDescription>
                {runningAgentCount === 1
                  ? '1 agent is currently running.'
                  : `${runningAgentCount} agents are currently running.`}{' '}
                Any currently running agents may become detached from Overlord. Please wait until
                all agents are finished before installing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>I&apos;ll wait</AlertDialogCancel>
              <AlertDialogAction
                onClick={event => {
                  event.preventDefault();
                  setInstallWarningOpen(false);
                  void restartToInstallUpdate();
                }}
              >
                Continue anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
