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

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const { isElectron, api } = useElectron();
  const { terminalMode, setTerminalMode } = useTerminal();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [everhourConnected, setEverhourConnected] = useState(false);
  const [everhourUpdatedAt, setEverhourUpdatedAt] = useState<string | null>(null);
  const [everhourStatusLoaded, setEverhourStatusLoaded] = useState(false);

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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
