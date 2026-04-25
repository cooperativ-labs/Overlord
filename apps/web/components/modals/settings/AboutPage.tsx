'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  getRunningAgentSessionsAction,
  type RunningAgentSession,
  stopRunningAgentSessionAction
} from '@/lib/actions/agent-sessions';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import { getAgentTypeByIdentifier } from '@/lib/helpers/agent-types';

type ElectronAppUpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

const getRunningAgentSessionsActionWithRetry = withElectronActionRetry(
  getRunningAgentSessionsAction
);
const stopRunningAgentSessionActionWithRetry = withElectronActionRetry(
  stopRunningAgentSessionAction
);

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
  const [runningAgentSessions, setRunningAgentSessions] = useState<RunningAgentSession[]>([]);
  const [loadingRunningAgentSessions, setLoadingRunningAgentSessions] = useState(false);
  const [stopAgentButtonStates, setStopAgentButtonStates] = useState<
    Record<string, ButtonLoadingState>
  >({});
  const [connectorUrl, setConnectorUrl] = useState<string | null>(null);
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
    if (!open || !api) return;

    let cancelled = false;

    void Promise.all([
      api.app.getConnectorUrl().catch(() => null),
      api.app.getPlatformUrl().catch(() => null)
    ]).then(([nextConnectorUrl, nextPlatformUrl]) => {
      if (cancelled) return;
      setConnectorUrl(nextConnectorUrl);
      setPlatformUrl(nextPlatformUrl);
    });

    return () => {
      cancelled = true;
    };
  }, [api, open]);

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

  async function loadRunningAgentSessions() {
    setLoadingRunningAgentSessions(true);
    try {
      const sessions = await getRunningAgentSessionsActionWithRetry();
      setRunningAgentSessions(sessions);
      setRunningAgentCount(sessions.length);
      return sessions;
    } catch (error) {
      console.error('Failed to load running agent sessions:', error);
      toast.error('Failed to load running agents.');
      throw error;
    } finally {
      setLoadingRunningAgentSessions(false);
    }
  }

  async function handleStopRunningAgentSession(sessionId: string) {
    setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'loading' }));
    try {
      await stopRunningAgentSessionActionWithRetry(sessionId);
      setRunningAgentSessions(previous => previous.filter(session => session.id !== sessionId));
      setRunningAgentCount(previous => Math.max(0, previous - 1));
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'success' }));
    } catch (error) {
      console.error('Failed to stop running agent session:', error);
      setStopAgentButtonStates(previous => ({ ...previous, [sessionId]: 'error' }));
      toast.error('Failed to stop the running agent.');
    }
  }

  async function handleRestartToInstallUpdate() {
    if (!api) return;
    setRestartToUpdateButtonState('loading');
    try {
      const runningSessions = await loadRunningAgentSessions();
      if (runningSessions.length > 0) {
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

  const resolvedConnectorUrl = connectorUrl ?? platformUrl;
  const showPlatformUrl = Boolean(
    platformUrl && resolvedConnectorUrl && platformUrl !== resolvedConnectorUrl
  );
  const installWarningDescription =
    runningAgentCount === 0
      ? 'No running agents remain. You can install the update now.'
      : runningAgentCount === 1
        ? '1 agent is currently running. Any currently running agents may become detached from Overlord. Please wait until all agents are finished before installing.'
        : `${runningAgentCount} agents are currently running. Any currently running agents may become detached from Overlord. Please wait until all agents are finished before installing.`;

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
          {resolvedConnectorUrl ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Connector URL: {resolvedConnectorUrl}
            </p>
          ) : null}
          {showPlatformUrl ? (
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
              <AlertDialogDescription>{installWarningDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <ScrollArea className="max-h-72">
              <div className="grid gap-2 pr-4">
                {loadingRunningAgentSessions ? (
                  <p className="text-sm text-muted-foreground">Loading running agents...</p>
                ) : runningAgentSessions.length > 0 ? (
                  runningAgentSessions.map(session => {
                    const agentType = getAgentTypeByIdentifier(session.agentIdentifier);
                    return (
                      <div
                        key={session.id}
                        className="flex items-start justify-between gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium">
                            {session.ticketTitle?.trim() || 'Untitled ticket'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {agentType?.label ?? session.agentIdentifier} • Started{' '}
                            {new Date(session.attachedAt).toLocaleString()}
                          </p>
                        </div>
                        <LoadingButton
                          buttonState={stopAgentButtonStates[session.id] ?? 'default'}
                          setButtonState={state =>
                            setStopAgentButtonStates(previous => ({
                              ...previous,
                              [session.id]: state
                            }))
                          }
                          text="Stop"
                          loadingText="Stopping..."
                          successText="Stopped"
                          errorText="Try again"
                          reset
                          size="sm"
                          variant="outline"
                          onClick={() => handleStopRunningAgentSession(session.id)}
                        />
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-muted-foreground">No running agents found.</p>
                )}
              </div>
            </ScrollArea>
            <AlertDialogFooter>
              <AlertDialogCancel>I&apos;ll wait</AlertDialogCancel>
              <AlertDialogAction
                onClick={event => {
                  event.preventDefault();
                  setInstallWarningOpen(false);
                  void restartToInstallUpdate();
                }}
              >
                {runningAgentCount > 0 ? 'Continue anyway' : 'Install update'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}
