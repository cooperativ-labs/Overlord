'use client';

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { Input } from '@/components/ui/input';
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
import { getEditorSchemeAction, saveEditorSchemeAction } from '@/lib/actions/profile-settings';
import {
  DEFAULT_EDITOR_SCHEME,
  EDITOR_SCHEME_OPTIONS,
  getEditorSchemeLabel
} from '@/lib/helpers/editor-scheme';

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
  const { api, isElectron } = useElectron();
  const [terminalApp, setTerminalApp] = useState('default');
  const [terminalLaunchMode, setTerminalLaunchMode] = useState('window');
  const [terminalCustomHotkey, setTerminalCustomHotkey] = useState('');
  const [customTerminalApp, setCustomTerminalApp] = useState('');
  const [editorScheme, setEditorScheme] = useState(DEFAULT_EDITOR_SCHEME);
  const [editorSchemeLoading, setEditorSchemeLoading] = useState(false);
  const [editorSchemeError, setEditorSchemeError] = useState<string | null>(null);
  const [editorSchemeSaveState, setEditorSchemeSaveState] = useState<ButtonLoadingState>('default');

  const loadEditorScheme = useCallback(async () => {
    setEditorSchemeLoading(true);
    setEditorSchemeError(null);
    try {
      const savedScheme = await getEditorSchemeAction();
      if (savedScheme) {
        setEditorScheme(savedScheme);
      }
    } catch (error) {
      console.error('Failed to load editor scheme:', error);
      setEditorSchemeError(
        error instanceof Error ? error.message : 'Failed to load editor scheme.'
      );
    } finally {
      setEditorSchemeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEditorScheme();
  }, [loadEditorScheme]);

  async function handleSaveEditorScheme() {
    setEditorSchemeSaveState('loading');
    setEditorSchemeError(null);
    try {
      const saved = await saveEditorSchemeAction(editorScheme);
      setEditorScheme(saved);
      setEditorSchemeSaveState('success');
    } catch (error) {
      console.error('Failed to save editor scheme:', error);
      setEditorSchemeSaveState('error');
      setEditorSchemeError(
        error instanceof Error ? error.message : 'Failed to save editor scheme.'
      );
    }
  }

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
      {!isElectron && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="size-4 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          Terminal agent controls are only available in the Overlord desktop app.
        </div>
      )}
      <div className="grid gap-2">
        <Label>Where to run terminal commands</Label>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-foreground">
          External terminal
        </div>
        <p className="text-xs text-muted-foreground">
          Overlord now launches agents in your system terminal instead of an in-app terminal.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="terminal-app">External terminal application</Label>
        <Select value={terminalApp} onValueChange={handleTerminalAppChange} disabled={!isElectron}>
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
              disabled={!isElectron}
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
            <Select
              value={terminalLaunchMode}
              onValueChange={handleTerminalLaunchModeChange}
              disabled={!isElectron}
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
              disabled={!isElectron}
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
      <div className="grid gap-2">
        <Label htmlFor="editor-scheme-select">File links</Label>
        <Select value={editorScheme} onValueChange={setEditorScheme} disabled={editorSchemeLoading}>
          <SelectTrigger id="editor-scheme-select">
            <SelectValue placeholder="Select an editor" />
          </SelectTrigger>
          <SelectContent>
            {EDITOR_SCHEME_OPTIONS.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          File links in ticket artifacts will open in {getEditorSchemeLabel(editorScheme)}.
        </p>
        {editorSchemeLoading ? (
          <p className="text-xs text-muted-foreground">Loading saved editor preference…</p>
        ) : null}
        {editorSchemeError ? <p className="text-sm text-destructive">{editorSchemeError}</p> : null}
        <div className="flex justify-end">
          <LoadingButton
            buttonState={editorSchemeSaveState}
            setButtonState={setEditorSchemeSaveState}
            text="Save editor"
            loadingText="Saving..."
            successText="Saved"
            errorText="Retry"
            reset
            variant="outline"
            onClick={handleSaveEditorScheme}
          />
        </div>
      </div>
    </div>
  );
}
