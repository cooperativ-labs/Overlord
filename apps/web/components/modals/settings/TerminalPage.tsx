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

type TerminalSettingsProfileId = 'local' | 'server';
type TerminalProfileState = {
  terminalApp: string;
  terminalLaunchMode: string;
  terminalCustomHotkey: string;
  customTerminalApp: string;
};

const externalTerminalAppOptions = [
  { value: 'default', label: 'System Default' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'tmux', label: 'tmux' },
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

const DEFAULT_TERMINAL_PROFILE: TerminalProfileState = {
  terminalApp: 'default',
  terminalLaunchMode: 'tab',
  terminalCustomHotkey: '',
  customTerminalApp: ''
};

const TERMINAL_PROFILE_KEYS: Record<
  TerminalSettingsProfileId,
  {
    app: string;
    launchMode: string;
    customHotkey: string;
    customApp: string;
  }
> = {
  local: {
    app: 'externalTerminalApp',
    launchMode: 'externalTerminalLaunchMode',
    customHotkey: 'externalTerminalCustomHotkey',
    customApp: 'customExternalTerminalApp'
  },
  server: {
    app: 'serverExternalTerminalApp',
    launchMode: 'serverExternalTerminalLaunchMode',
    customHotkey: 'serverExternalTerminalCustomHotkey',
    customApp: 'customServerExternalTerminalApp'
  }
};

export function TerminalPage({ open }: { open: boolean }) {
  const { api, isElectron } = useElectron();
  const [terminalProfiles, setTerminalProfiles] = useState<
    Record<TerminalSettingsProfileId, TerminalProfileState>
  >({
    local: DEFAULT_TERMINAL_PROFILE,
    server: DEFAULT_TERMINAL_PROFILE
  });
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

  useEffect(() => {
    if (!api || !open) return;
    Promise.all([
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.app),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.launchMode),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.customApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.customHotkey),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.app),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.launchMode),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.customApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.customHotkey)
    ]).then(
      ([
        localAppValue,
        localLaunchModeValue,
        localCustomAppValue,
        localCustomHotkeyValue,
        serverAppValue,
        serverLaunchModeValue,
        serverCustomAppValue,
        serverCustomHotkeyValue
      ]) => {
        setTerminalProfiles({
          local: {
            terminalApp: localAppValue || DEFAULT_TERMINAL_PROFILE.terminalApp,
            terminalLaunchMode: localLaunchModeValue || DEFAULT_TERMINAL_PROFILE.terminalLaunchMode,
            customTerminalApp:
              typeof localCustomAppValue === 'string'
                ? localCustomAppValue
                : DEFAULT_TERMINAL_PROFILE.customTerminalApp,
            terminalCustomHotkey:
              typeof localCustomHotkeyValue === 'string'
                ? localCustomHotkeyValue
                : DEFAULT_TERMINAL_PROFILE.terminalCustomHotkey
          },
          server: {
            terminalApp: serverAppValue || localAppValue || DEFAULT_TERMINAL_PROFILE.terminalApp,
            terminalLaunchMode:
              serverLaunchModeValue ||
              localLaunchModeValue ||
              DEFAULT_TERMINAL_PROFILE.terminalLaunchMode,
            customTerminalApp:
              typeof serverCustomAppValue === 'string'
                ? serverCustomAppValue
                : typeof localCustomAppValue === 'string'
                  ? localCustomAppValue
                  : DEFAULT_TERMINAL_PROFILE.customTerminalApp,
            terminalCustomHotkey:
              typeof serverCustomHotkeyValue === 'string'
                ? serverCustomHotkeyValue
                : typeof localCustomHotkeyValue === 'string'
                  ? localCustomHotkeyValue
                  : DEFAULT_TERMINAL_PROFILE.terminalCustomHotkey
          }
        });
      }
    );
  }, [api, open]);

  async function updateTerminalProfile(
    profileId: TerminalSettingsProfileId,
    field: keyof TerminalProfileState,
    value: string
  ) {
    setTerminalProfiles(current => ({
      ...current,
      [profileId]: {
        ...current[profileId],
        [field]: value
      }
    }));
    const profileKeys = TERMINAL_PROFILE_KEYS[profileId];
    const settingKey =
      field === 'terminalApp'
        ? profileKeys.app
        : field === 'terminalLaunchMode'
          ? profileKeys.launchMode
          : field === 'terminalCustomHotkey'
            ? profileKeys.customHotkey
            : profileKeys.customApp;
    await api?.settings.set(settingKey, value);
  }

  function handleTerminalCustomHotkeyKeyDown(
    profileId: TerminalSettingsProfileId,
    event: KeyboardEvent<HTMLInputElement>
  ) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Tab') return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      void updateTerminalProfile(profileId, 'terminalCustomHotkey', '');
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

    void updateTerminalProfile(profileId, 'terminalCustomHotkey', parts.join(' + '));
  }

  function isTmuxLikeProfile(profile: TerminalProfileState) {
    if (profile.terminalApp === 'tmux' || profile.terminalApp === 'cmux') return true;
    if (profile.terminalApp !== 'custom') return false;
    const normalized = profile.customTerminalApp.trim().toLowerCase();
    return normalized.includes('tmux') || normalized.includes('cmux');
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
      {(['local', 'server'] as const).map(profileId => {
        const profile = terminalProfiles[profileId];
        const isTmuxLike = isTmuxLikeProfile(profile);
        const supportsLaunchModeSelection =
          !isTmuxLike &&
          profile.terminalApp !== 'ghostty' &&
          profile.terminalApp !== 'alacritty' &&
          profile.terminalApp !== 'kitty';
        const selectedTerminalLabel =
          externalTerminalAppOptions.find(opt => opt.value === profile.terminalApp)?.label ??
          'your terminal';
        const prefix = profileId === 'local' ? 'local' : 'server';

        return (
          <div key={profileId} className="grid gap-4 rounded-lg border p-4">
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">
                {profileId === 'local' ? 'Local terminal settings' : 'Server terminal settings'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {profileId === 'local'
                  ? 'Used when the project runs in a local working directory.'
                  : 'Used when the project runs through SSH on a server workspace.'}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`${prefix}-terminal-app`}>External terminal application</Label>
              <Select
                value={profile.terminalApp}
                onValueChange={value => void updateTerminalProfile(profileId, 'terminalApp', value)}
                disabled={!isElectron}
              >
                <SelectTrigger id={`${prefix}-terminal-app`}>
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
              {profile.terminalApp === 'custom' && (
                <div className="grid gap-2">
                  <Label htmlFor={`${prefix}-custom-terminal-app`}>
                    Custom terminal name or path
                  </Label>
                  <Input
                    id={`${prefix}-custom-terminal-app`}
                    placeholder="Example: cmux or /Applications/cmux.app"
                    value={profile.customTerminalApp}
                    onChange={event =>
                      void updateTerminalProfile(profileId, 'customTerminalApp', event.target.value)
                    }
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
                  <Label htmlFor={`${prefix}-terminal-launch-mode`}>When opening a terminal</Label>
                  <Select
                    value={profile.terminalLaunchMode}
                    onValueChange={value =>
                      void updateTerminalProfile(profileId, 'terminalLaunchMode', value)
                    }
                    disabled={!isElectron}
                  >
                    <SelectTrigger id={`${prefix}-terminal-launch-mode`}>
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
              {supportsLaunchModeSelection && profile.terminalLaunchMode === 'custom' && (
                <div className="mt-2 grid gap-2">
                  <Label htmlFor={`${prefix}-terminal-custom-hotkey`}>Custom hotkey</Label>
                  <Input
                    id={`${prefix}-terminal-custom-hotkey`}
                    placeholder="Press the key combination to use (e.g. Cmd + D)"
                    value={profile.terminalCustomHotkey}
                    onKeyDown={event => handleTerminalCustomHotkeyKeyDown(profileId, event)}
                    readOnly
                    disabled={!isElectron}
                  />
                  <p className="text-xs text-muted-foreground">
                    Overlord will activate {selectedTerminalLabel}, send this hotkey to trigger your
                    preferred split or focus behavior, then type the launch command.
                  </p>
                </div>
              )}
              {!supportsLaunchModeSelection && (
                <p className="text-xs text-muted-foreground">
                  {isTmuxLike
                    ? 'tmux-based terminals always open a fresh instance so multiple agent runs can coexist.'
                    : 'This terminal opens directly into a new session for each launch.'}
                </p>
              )}
              {supportsLaunchModeSelection && profile.terminalLaunchMode !== 'custom' && (
                <p className="text-xs text-muted-foreground">
                  Choose the app and whether launches open in a new window or tab.
                </p>
              )}
            </div>
          </div>
        );
      })}
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
