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
import { Textarea } from '@/components/ui/textarea';
import {
  getEditorSchemeAction,
  getRunnerTerminalProfileAction,
  saveEditorSchemeAction,
  saveRunnerTerminalProfileAction
} from '@/lib/actions/profile-settings';
import {
  DEFAULT_EDITOR_SCHEME,
  EDITOR_SCHEME_OPTIONS,
  getEditorSchemeLabel
} from '@/lib/helpers/editor-scheme';
import {
  DEFAULT_RUNNER_TERMINAL_PROFILE,
  type RunnerTerminalProfile
} from '@/lib/helpers/runner-terminal-settings';

type TerminalProfileState = RunnerTerminalProfile;

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

const tmuxHostTerminalOptions = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm2' },
  { value: 'warp', label: 'Warp' },
  { value: 'ghostty', label: 'Ghostty' },
  { value: 'alacritty', label: 'Alacritty' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'hyper', label: 'Hyper' },
  { value: 'custom', label: 'Custom…' }
] as const;

const DEFAULT_TMUX_COMMAND = 'tmux new-session bash {script}';

const PROFILE_KEYS = {
  app: 'externalTerminalApp',
  launchMode: 'externalTerminalLaunchMode',
  customHotkey: 'externalTerminalCustomHotkey',
  customApp: 'customExternalTerminalApp',
  tmuxHostApp: 'externalTerminalTmuxHostApp',
  customTmuxHostApp: 'customExternalTerminalTmuxHostApp',
  tmuxCommand: 'externalTerminalTmuxCommand'
} as const;

const DEFAULT_TERMINAL_PROFILE: TerminalProfileState = DEFAULT_RUNNER_TERMINAL_PROFILE;

export function TerminalPage({ open }: { open: boolean }) {
  const { api, isElectron } = useElectron();
  const [terminalProfile, setTerminalProfile] =
    useState<TerminalProfileState>(DEFAULT_TERMINAL_PROFILE);
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
    if (!open) return;
    let cancelled = false;
    async function loadTerminalProfile() {
      if (api) {
        const [
          appValue,
          launchModeValue,
          customAppValue,
          customHotkeyValue,
          tmuxHostAppValue,
          customTmuxHostAppValue,
          tmuxCommandValue
        ] = await Promise.all([
          api.settings.get<string>(PROFILE_KEYS.app),
          api.settings.get<string>(PROFILE_KEYS.launchMode),
          api.settings.get<string>(PROFILE_KEYS.customApp),
          api.settings.get<string>(PROFILE_KEYS.customHotkey),
          api.settings.get<string>(PROFILE_KEYS.tmuxHostApp),
          api.settings.get<string>(PROFILE_KEYS.customTmuxHostApp),
          api.settings.get<string>(PROFILE_KEYS.tmuxCommand)
        ]);
        if (cancelled) return;
        setTerminalProfile({
          terminalApp: appValue || DEFAULT_TERMINAL_PROFILE.terminalApp,
          terminalLaunchMode: launchModeValue || DEFAULT_TERMINAL_PROFILE.terminalLaunchMode,
          customTerminalApp:
            typeof customAppValue === 'string'
              ? customAppValue
              : DEFAULT_TERMINAL_PROFILE.customTerminalApp,
          terminalCustomHotkey:
            typeof customHotkeyValue === 'string'
              ? customHotkeyValue
              : DEFAULT_TERMINAL_PROFILE.terminalCustomHotkey,
          terminalTmuxHostApp: tmuxHostAppValue || DEFAULT_TERMINAL_PROFILE.terminalTmuxHostApp,
          customTerminalTmuxHostApp:
            typeof customTmuxHostAppValue === 'string'
              ? customTmuxHostAppValue
              : DEFAULT_TERMINAL_PROFILE.customTerminalTmuxHostApp,
          terminalTmuxCommand:
            typeof tmuxCommandValue === 'string' && tmuxCommandValue.trim().length > 0
              ? tmuxCommandValue
              : DEFAULT_TERMINAL_PROFILE.terminalTmuxCommand
        });
        return;
      }

      const savedProfile = await getRunnerTerminalProfileAction();
      if (!cancelled) setTerminalProfile(savedProfile);
    }
    void loadTerminalProfile();
    return () => {
      cancelled = true;
    };
  }, [api, open]);

  async function updateTerminalProfile(field: keyof TerminalProfileState, value: string) {
    const nextProfile = {
      ...terminalProfile,
      [field]: value
    };
    setTerminalProfile(nextProfile);

    if (api) {
      const settingKeyByField: Record<keyof TerminalProfileState, string> = {
        terminalApp: PROFILE_KEYS.app,
        terminalLaunchMode: PROFILE_KEYS.launchMode,
        terminalCustomHotkey: PROFILE_KEYS.customHotkey,
        customTerminalApp: PROFILE_KEYS.customApp,
        terminalTmuxHostApp: PROFILE_KEYS.tmuxHostApp,
        customTerminalTmuxHostApp: PROFILE_KEYS.customTmuxHostApp,
        terminalTmuxCommand: PROFILE_KEYS.tmuxCommand
      };
      await api.settings.set(settingKeyByField[field], value);
      return;
    }

    const saved = await saveRunnerTerminalProfileAction(nextProfile);
    setTerminalProfile(saved);
  }

  function handleTerminalCustomHotkeyKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Tab') return;

    if (event.key === 'Backspace' || event.key === 'Delete') {
      void updateTerminalProfile('terminalCustomHotkey', '');
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

    void updateTerminalProfile('terminalCustomHotkey', parts.join(' + '));
  }

  function isTmuxLikeProfile(profile: TerminalProfileState) {
    if (profile.terminalApp === 'tmux' || profile.terminalApp === 'cmux') return true;
    if (profile.terminalApp !== 'custom') return false;
    const normalized = profile.customTerminalApp.trim().toLowerCase();
    return normalized.includes('tmux') || normalized.includes('cmux');
  }

  const profile = terminalProfile;
  const isTmuxLike = isTmuxLikeProfile(profile);
  const isTmux = profile.terminalApp === 'tmux';
  const supportsLaunchModeSelection =
    !isTmuxLike &&
    profile.terminalApp !== 'ghostty' &&
    profile.terminalApp !== 'alacritty' &&
    profile.terminalApp !== 'kitty';
  const usesCustomLaunchMode = profile.terminalLaunchMode === 'custom';
  const selectedTerminalLabel =
    externalTerminalAppOptions.find(opt => opt.value === profile.terminalApp)?.label ??
    'your terminal';

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
          These settings are saved for your local runner.
        </div>
      )}
      <div className="grid gap-4 rounded-lg border p-4">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">Terminal settings</h3>
          <p className="text-xs text-muted-foreground">
            Overlord opens this terminal application when launching an agent locally.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="local-terminal-app">External terminal application</Label>
          <Select
            value={profile.terminalApp}
            onValueChange={value => void updateTerminalProfile('terminalApp', value)}
          >
            <SelectTrigger id="local-terminal-app">
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
              <Label htmlFor="local-custom-terminal-app">Custom terminal name or path</Label>
              <Input
                id="local-custom-terminal-app"
                placeholder="Example: cmux or /Applications/cmux.app"
                value={profile.customTerminalApp}
                onChange={event =>
                  void updateTerminalProfile('customTerminalApp', event.target.value)
                }
              />
              <p className="text-xs text-muted-foreground">
                Overlord will open this app and type the launch command into the active terminal
                session.
              </p>
            </div>
          )}
          {isTmux && (
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-2">
                <Label htmlFor="local-tmux-host-app">Run tmux in</Label>
                <Select
                  value={profile.terminalTmuxHostApp}
                  onValueChange={value => void updateTerminalProfile('terminalTmuxHostApp', value)}
                >
                  <SelectTrigger id="local-tmux-host-app">
                    <SelectValue placeholder="Select terminal" />
                  </SelectTrigger>
                  <SelectContent>
                    {tmuxHostTerminalOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {profile.terminalTmuxHostApp === 'custom' && (
                <div className="grid gap-2">
                  <Label htmlFor="local-custom-tmux-host-app">
                    Custom host terminal name or path
                  </Label>
                  <Input
                    id="local-custom-tmux-host-app"
                    placeholder="Example: WezTerm or /Applications/WezTerm.app"
                    value={profile.customTerminalTmuxHostApp}
                    onChange={event =>
                      void updateTerminalProfile('customTerminalTmuxHostApp', event.target.value)
                    }
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="local-tmux-command">tmux launch command</Label>
                <Textarea
                  id="local-tmux-command"
                  placeholder={DEFAULT_TMUX_COMMAND}
                  value={profile.terminalTmuxCommand}
                  onChange={event =>
                    void updateTerminalProfile('terminalTmuxCommand', event.target.value)
                  }
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Use {'{script}'} where Overlord should insert the generated launch script.
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-2">
          {supportsLaunchModeSelection && (
            <>
              <Label htmlFor="local-terminal-launch-mode">When opening a terminal</Label>
              <Select
                value={profile.terminalLaunchMode}
                onValueChange={value => void updateTerminalProfile('terminalLaunchMode', value)}
              >
                <SelectTrigger id="local-terminal-launch-mode">
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
              {usesCustomLaunchMode && (
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
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
                  This mode uses a custom keystroke to trigger your terminal layout, which may
                  sometimes cause Overlord to launch the agent incorrectly.
                </div>
              )}
            </>
          )}
          {!supportsLaunchModeSelection && (
            <p className="text-xs text-muted-foreground">
              {isTmux
                ? 'tmux-based terminals run your launch command in a fresh host terminal so multiple agent runs can coexist.'
                : isTmuxLike
                  ? 'tmux-like terminals open a fresh instance so multiple agent runs can coexist.'
                  : 'This terminal opens directly into a new session for each launch.'}
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="local-terminal-custom-hotkey">Custom hotkey</Label>
            <Input
              id="local-terminal-custom-hotkey"
              placeholder="Press the key combination to use (e.g. Cmd + D)"
              value={profile.terminalCustomHotkey}
              onKeyDown={event => handleTerminalCustomHotkeyKeyDown(event)}
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              Overlord will activate {selectedTerminalLabel}, send this hotkey to trigger your
              preferred split or focus behavior, then type the launch command.
            </p>
          </div>
        </div>
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
