'use client';

import { type KeyboardEvent, useEffect, useState } from 'react';

import { useTerminal } from '@/components/features/terminal/TerminalProvider';
import { useElectron } from '@/components/features/terminal/useElectron';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

const terminalModeOptions = [
  { value: 'embedded', label: 'Embedded' },
  { value: 'external', label: 'External' }
] as const;

const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'cmux', label: 'cmux' },
  { value: 'custom', label: 'Custom…' }
] as const;

const externalTerminalLaunchModeOptions = [
  { value: 'window', label: 'New window' },
  { value: 'tab', label: 'New tab' },
  { value: 'custom', label: 'Custom' }
] as const;

export function TerminalPage({ open }: { open: boolean }) {
  const { api } = useElectron();
  const { terminalMode, setTerminalMode } = useTerminal();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [terminalCustomHotkey, setTerminalCustomHotkey] = useState('');
  const [customTerminalApp, setCustomTerminalApp] = useState('');

  const supportsLaunchModeSelection =
    terminalApp !== 'ghostty' && terminalApp !== 'alacritty' && terminalApp !== 'kitty';

  const selectedTerminalLabel =
    externalTerminalAppOptions.find(opt => opt.value === terminalApp)?.label ?? 'your terminal';

  useEffect(() => {
    if (!api || !open) return;
    Promise.all([
      api.settings.get<string>('externalTerminalApp'),
      api.settings.get<string>('externalTerminalLaunchMode'),
      api.settings.get<string>('customExternalTerminalApp'),
      api.settings.get<string>('externalTerminalCustomHotkey')
    ]).then(([appValue, launchModeValue, customAppValue, customHotkeyValue]) => {
      if (appValue) setTerminalApp(appValue);
      if (launchModeValue) setTerminalLaunchMode(launchModeValue);
      if (typeof customAppValue === 'string') setCustomTerminalApp(customAppValue);
      if (typeof customHotkeyValue === 'string') setTerminalCustomHotkey(customHotkeyValue);
    });
  }, [api, open]);

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

  async function handleTerminalCustomHotkeyChange(value: string) {
    setTerminalCustomHotkey(value);
    await api?.settings.set('externalTerminalCustomHotkey', value);
  }

  function handleTerminalCustomHotkeyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Tab') return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      void handleTerminalCustomHotkeyChange('');
      return;
    }

    const isMac =
      typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac');

    const parts: string[] = [];
    if (event.metaKey) parts.push(isMac ? 'Cmd' : 'Meta');
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push(isMac ? 'Option' : 'Alt');
    if (event.shiftKey) parts.push('Shift');

    const modifierKeys = ['Meta', 'Control', 'Alt', 'Shift'];
    let key = event.key;

    if (!modifierKeys.includes(key)) {
      if (key.length === 1) {
        key = key.toUpperCase();
      } else if (key === ' ') {
        key = 'Space';
      }
      parts.push(key);
    }

    if (parts.length === 0) return;

    void handleTerminalCustomHotkeyChange(parts.join(' + '));
  }

  async function handleCustomTerminalAppChange(value: string) {
    setCustomTerminalApp(value);
    await api?.settings.set('customExternalTerminalApp', value);
  }

  return (
    <div className="grid gap-6">
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
        <>
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
            {terminalApp === 'custom' && (
              <div className="grid gap-2">
                <Label htmlFor="custom-terminal-app">Custom terminal name or path</Label>
                <Input
                  id="custom-terminal-app"
                  placeholder="Example: cmux or /Applications/cmux.app"
                  value={customTerminalApp}
                  onChange={event => void handleCustomTerminalAppChange(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Overlord will open this app and type the launch command into the active terminal
                  session.
                </p>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            {supportsLaunchModeSelection && (
              <>
                <Label htmlFor="terminal-launch-mode">When opening a terminal</Label>
                <Select value={terminalLaunchMode} onValueChange={handleTerminalLaunchModeChange}>
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
              </>
            )}
            {supportsLaunchModeSelection && terminalLaunchMode === 'custom' && (
              <div className="mt-2 grid gap-2">
                <Label htmlFor="terminal-custom-hotkey">Custom hotkey</Label>
                <Input
                  id="terminal-custom-hotkey"
                  placeholder="Press the key combination to use (e.g. Cmd + D)"
                  value={terminalCustomHotkey}
                  onKeyDown={handleTerminalCustomHotkeyKeyDown}
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  Overlord will activate {selectedTerminalLabel}, send this hotkey to trigger your
                  preferred split or focus behavior, then type the launch command.
                </p>
              </div>
            )}
            {supportsLaunchModeSelection && terminalLaunchMode !== 'custom' && (
              <p className="text-xs text-muted-foreground">
                Choose the app and whether launches open in a new window or tab.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
