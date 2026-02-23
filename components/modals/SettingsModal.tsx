'use client';

import { useEffect, useState } from 'react';

import { EverhourSettings } from '@/components/features/everhour/EverhourSettings';
import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { getEverhourConnectionStatus } from '@/lib/actions/everhour';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const terminalModeOptions = [
  { value: 'embedded', label: 'Embedded' },
  { value: 'external', label: 'External' }
] as const;

const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm' },
  { value: 'warp', label: 'Warp' }
] as const;

const externalTerminalLaunchModeOptions = [
  { value: 'window', label: 'New window' },
  { value: 'tab', label: 'New tab' }
] as const;

type ElectronAppUpdateStatus = Awaited<
  ReturnType<NonNullable<Window['electronAPI']>['appUpdate']['getStatus']>
>;

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { isElectron, api } = useElectron();
  const { terminalMode, setTerminalMode } = useTerminal();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [everhourConnected, setEverhourConnected] = useState(false);
  const [everhourUpdatedAt, setEverhourUpdatedAt] = useState<string | null>(null);
  const [everhourStatusLoaded, setEverhourStatusLoaded] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ElectronAppUpdateStatus | null>(null);
  const [checkUpdateButtonState, setCheckUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [downloadUpdateButtonState, setDownloadUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [restartToUpdateButtonState, setRestartToUpdateButtonState] =
    useState<ButtonLoadingState>('default');
  const [platformUrl, setPlatformUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !open) return;
    Promise.all([
      api.settings.get<string>('externalTerminalApp'),
      api.settings.get<string>('externalTerminalLaunchMode')
    ]).then(([appValue, launchModeValue]) => {
      if (appValue) setTerminalApp(appValue);
      if (launchModeValue) setTerminalLaunchMode(launchModeValue);
    });
  }, [api, open]);

  useEffect(() => {
    if (!open) return;
    setEverhourStatusLoaded(false);
    getEverhourConnectionStatus()
      .then(({ connected, updatedAt }) => {
        setEverhourConnected(connected);
        setEverhourUpdatedAt(updatedAt);
      })
      .catch(() => {
        setEverhourConnected(false);
        setEverhourUpdatedAt(null);
      })
      .finally(() => setEverhourStatusLoaded(true));
  }, [open]);

  useEffect(() => {
    if (!open || !isElectron || !api) return;

    api.appUpdate
      .getStatus()
      .then(status => {
        setUpdateStatus(status);
      })
      .catch(() => {
        setUpdateStatus(null);
      });

    const unsubscribe = api.appUpdate.onStatus(status => {
      setUpdateStatus(status);
      if (status.phase === 'available') {
        setDownloadUpdateButtonState('default');
      }
      if (status.phase === 'downloaded') {
        setRestartToUpdateButtonState('default');
      }
    });

    return unsubscribe;
  }, [api, isElectron, open]);

  useEffect(() => {
    if (!open || !isElectron) return;
    if (typeof window !== 'undefined' && window.electronAPI?.app?.getPlatformUrl) {
      void window.electronAPI.app.getPlatformUrl().then(url => {
        if (url) setPlatformUrl(url);
      });
    }
  }, [isElectron, open]);

  function handleTerminalModeChange(value: string) {
    const mode = value === 'embedded' ? 'embedded' : 'external';
    setTerminalMode(mode);
  }

  async function handleTerminalAppChange(value: string) {
    setTerminalApp(value);
    await api?.settings.set('externalTerminalApp', value);
  }

  async function handleTerminalLaunchModeChange(value: string) {
    setTerminalLaunchMode(value);
    await api?.settings.set('externalTerminalLaunchMode', value);
  }

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

  async function handleRestartToInstallUpdate() {
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

  const canDownloadUpdate = updateStatus?.phase === 'available';
  const canRestartToInstallUpdate = updateStatus?.phase === 'downloaded';
  const updateStatusMessage =
    updateStatus?.message ?? 'Use Check for updates to look for a newer release.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your preferences and account settings.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          {everhourStatusLoaded && (
            <EverhourSettings
              initiallyConnected={everhourConnected}
              lastUpdatedAt={everhourUpdatedAt}
              compact
            />
          )}
          {isElectron && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="terminal-mode">Where to run terminal commands</Label>
                <Select value={terminalMode} onValueChange={handleTerminalModeChange}>
                  <SelectTrigger id="terminal-mode">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    {terminalModeOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Embedded runs inside the app; External opens your system terminal.
                </p>
              </div>
              {terminalMode === 'external' && (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="terminal-app">External terminal application</Label>
                    <Select value={terminalApp} onValueChange={handleTerminalAppChange}>
                      <SelectTrigger id="terminal-app">
                        <SelectValue placeholder="Select terminal" />
                      </SelectTrigger>
                      <SelectContent>
                        {externalTerminalAppOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="terminal-launch-mode">When opening a terminal</Label>
                    <Select
                      value={terminalLaunchMode}
                      onValueChange={handleTerminalLaunchModeChange}
                    >
                      <SelectTrigger id="terminal-launch-mode">
                        <SelectValue placeholder="Select behavior" />
                      </SelectTrigger>
                      <SelectContent>
                        {externalTerminalLaunchModeOptions.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Choose the app and whether launches open in a new window or tab.
                  </p>
                </div>
              )}
              <div className="grid gap-3 rounded-md border p-4">
                <div className="grid gap-1">
                  <Label>App updates</Label>
                  <p className="text-xs text-muted-foreground">
                    Version {updateStatus?.currentVersion ?? 'unknown'}
                    {updateStatus?.availableVersion
                      ? ` • Latest ${updateStatus.availableVersion}`
                      : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">{updateStatusMessage}</p>
                  {updateStatus?.phase === 'downloading' && (
                    <p className="text-xs text-muted-foreground">
                      Download progress: {updateStatus.progressPercent ?? 0}%
                    </p>
                  )}
                </div>
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
                  <LoadingButton
                    buttonState={downloadUpdateButtonState}
                    setButtonState={setDownloadUpdateButtonState}
                    text="Download update"
                    loadingText="Starting download..."
                    successText="Download started"
                    errorText="Unavailable"
                    reset
                    variant="outline"
                    disabled={!canDownloadUpdate}
                    onClick={handleDownloadUpdate}
                  />
                  <LoadingButton
                    buttonState={restartToUpdateButtonState}
                    setButtonState={setRestartToUpdateButtonState}
                    text="Restart to install"
                    loadingText="Restarting..."
                    successText="Restarting..."
                    errorText="Unavailable"
                    variant="default"
                    disabled={!canRestartToInstallUpdate}
                    onClick={handleRestartToInstallUpdate}
                  />
                </div>
              </div>
              {platformUrl && (
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground text-xs">
                    PLATFORM_URL: {platformUrl}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
