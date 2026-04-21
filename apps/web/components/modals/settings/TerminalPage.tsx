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
  terminalTmuxHostApp: string;
  customTerminalTmuxHostApp: string;
  terminalTmuxCommand: string;
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

const DEFAULT_TERMINAL_PROFILE: TerminalProfileState = {
  terminalApp: 'default',
  terminalLaunchMode: 'tab',
  terminalCustomHotkey: '',
  customTerminalApp: '',
  terminalTmuxHostApp: 'terminal',
  customTerminalTmuxHostApp: '',
  terminalTmuxCommand: DEFAULT_TMUX_COMMAND
};

const TERMINAL_PROFILE_KEYS: Record<
  TerminalSettingsProfileId,
  {
    app: string;
    launchMode: string;
    customHotkey: string;
    customApp: string;
    tmuxHostApp: string;
    customTmuxHostApp: string;
    tmuxCommand: string;
  }
> = {
  local: {
    app: 'externalTerminalApp',
    launchMode: 'externalTerminalLaunchMode',
    customHotkey: 'externalTerminalCustomHotkey',
    customApp: 'customExternalTerminalApp',
    tmuxHostApp: 'externalTerminalTmuxHostApp',
    customTmuxHostApp: 'customExternalTerminalTmuxHostApp',
    tmuxCommand: 'externalTerminalTmuxCommand'
  },
  server: {
    app: 'serverExternalTerminalApp',
    launchMode: 'serverExternalTerminalLaunchMode',
    customHotkey: 'serverExternalTerminalCustomHotkey',
    customApp: 'customServerExternalTerminalApp',
    tmuxHostApp: 'serverExternalTerminalTmuxHostApp',
    customTmuxHostApp: 'customServerExternalTerminalTmuxHostApp',
    tmuxCommand: 'serverExternalTerminalTmuxCommand'
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
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.tmuxHostApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.customTmuxHostApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.local.tmuxCommand),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.app),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.launchMode),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.customApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.customHotkey),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.tmuxHostApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.customTmuxHostApp),
      api.settings.get<string>(TERMINAL_PROFILE_KEYS.server.tmuxCommand)
    ]).then(
      ([
        localAppValue,
        localLaunchModeValue,
        localCustomAppValue,
        localCustomHotkeyValue,
        localTmuxHostAppValue,
        localCustomTmuxHostAppValue,
        localTmuxCommandValue,
        serverAppValue,
        serverLaunchModeValue,
        serverCustomAppValue,
        serverCustomHotkeyValue,
        serverTmuxHostAppValue,
        serverCustomTmuxHostAppValue,
        serverTmuxCommandValue
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
                : DEFAULT_TERMINAL_PROFILE.terminalCustomHotkey,
            terminalTmuxHostApp:
              localTmuxHostAppValue || DEFAULT_TERMINAL_PROFILE.terminalTmuxHostApp,
            customTerminalTmuxHostApp:
              typeof localCustomTmuxHostAppValue === 'string'
                ? localCustomTmuxHostAppValue
                : DEFAULT_TERMINAL_PROFILE.customTerminalTmuxHostApp,
            terminalTmuxCommand:
              typeof localTmuxCommandValue === 'string' && localTmuxCommandValue.trim().length > 0
                ? localTmuxCommandValue
                : DEFAULT_TERMINAL_PROFILE.terminalTmuxCommand
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
                  : DEFAULT_TERMINAL_PROFILE.terminalCustomHotkey,
            terminalTmuxHostApp:
              serverTmuxHostAppValue ||
              localTmuxHostAppValue ||
              DEFAULT_TERMINAL_PROFILE.terminalTmuxHostApp,
            customTerminalTmuxHostApp:
              typeof serverCustomTmuxHostAppValue === 'string'
                ? serverCustomTmuxHostAppValue
                : typeof localCustomTmuxHostAppValue === 'string'
                  ? localCustomTmuxHostAppValue
                  : DEFAULT_TERMINAL_PROFILE.customTerminalTmuxHostApp,
            terminalTmuxCommand:
              typeof serverTmuxCommandValue === 'string' && serverTmuxCommandValue.trim().length > 0
                ? serverTmuxCommandValue
                : typeof localTmuxCommandValue === 'string' &&
                    localTmuxCommandValue.trim().length > 0
                  ? localTmuxCommandValue
                  : DEFAULT_TERMINAL_PROFILE.terminalTmuxCommand
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
    const settingKeyByField: Record<keyof TerminalProfileState, string> = {
      terminalApp: profileKeys.app,
      terminalLaunchMode: profileKeys.launchMode,
      terminalCustomHotkey: profileKeys.customHotkey,
      customTerminalApp: profileKeys.customApp,
      terminalTmuxHostApp: profileKeys.tmuxHostApp,
      customTerminalTmuxHostApp: profileKeys.customTmuxHostApp,
      terminalTmuxCommand: profileKeys.tmuxCommand
    };
    const settingKey = settingKeyByField[field];
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
      {(['local'] as const).map(profileId => {
        const profile = terminalProfiles[profileId];
        const isTmuxLike = isTmuxLikeProfile(profile);
        const isTmux = profile.terminalApp === 'tmux';
        const supportsLaunchModeSelection =
          !isTmuxLike &&
          profile.terminalApp !== 'ghostty' &&
          profile.terminalApp !== 'alacritty' &&
          profile.terminalApp !== 'kitty';
        const selectedTerminalLabel =
          externalTerminalAppOptions.find(opt => opt.value === profile.terminalApp)?.label ??
          'your terminal';
        const prefix = 'local';

        return (
          <div key={profileId} className="grid gap-4 rounded-lg border p-4">
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Local terminal settings</h3>
              <p className="text-xs text-muted-foreground">
                Overlord opens this terminal on your machine for every agent launch — including SSH
                launches, where this terminal is the one that runs the ssh command.
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
              {isTmux && (
                <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
                  <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-tmux-host-app`}>Run tmux in</Label>
                    <Select
                      value={profile.terminalTmuxHostApp}
                      onValueChange={value =>
                        void updateTerminalProfile(profileId, 'terminalTmuxHostApp', value)
                      }
                      disabled={!isElectron}
                    >
                      <SelectTrigger id={`${prefix}-tmux-host-app`}>
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
                      <Label htmlFor={`${prefix}-custom-tmux-host-app`}>
                        Custom host terminal name or path
                      </Label>
                      <Input
                        id={`${prefix}-custom-tmux-host-app`}
                        placeholder="Example: WezTerm or /Applications/WezTerm.app"
                        value={profile.customTerminalTmuxHostApp}
                        onChange={event =>
                          void updateTerminalProfile(
                            profileId,
                            'customTerminalTmuxHostApp',
                            event.target.value
                          )
                        }
                        disabled={!isElectron}
                      />
                    </div>
                  )}
                  <div className="grid gap-2">
                    <Label htmlFor={`${prefix}-tmux-command`}>tmux launch command</Label>
                    <Textarea
                      id={`${prefix}-tmux-command`}
                      placeholder={DEFAULT_TMUX_COMMAND}
                      value={profile.terminalTmuxCommand}
                      onChange={event =>
                        void updateTerminalProfile(
                          profileId,
                          'terminalTmuxCommand',
                          event.target.value
                        )
                      }
                      disabled={!isElectron}
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
            </div>
          </div>
        );
      })}
      {(() => {
        const serverProfile = terminalProfiles.server;
        const serverUsesTmux = isTmuxLikeProfile(serverProfile);
        return (
          <div className="grid gap-4 rounded-lg border p-4">
            <div className="grid gap-1">
              <h3 className="text-sm font-medium">Server terminal settings</h3>
              <p className="text-xs text-muted-foreground">
                Controls how the agent runs on the remote host after Overlord connects via SSH from
                your local terminal. The local terminal app above is still the one that opens.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="server-remote-multiplexer">Remote multiplexer</Label>
              <Select
                value={serverUsesTmux ? 'tmux' : 'none'}
                onValueChange={value =>
                  void updateTerminalProfile(
                    'server',
                    'terminalApp',
                    value === 'tmux' ? 'tmux' : 'default'
                  )
                }
                disabled={!isElectron}
              >
                <SelectTrigger id="server-remote-multiplexer">
                  <SelectValue placeholder="Select behavior" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Run the agent directly</SelectItem>
                  <SelectItem value="tmux">Run the agent inside tmux</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                tmux keeps the agent alive on the server if your SSH session drops and lets you
                re-attach from another terminal.
              </p>
            </div>
            {serverUsesTmux && (
              <div className="grid gap-2">
                <Label htmlFor="server-tmux-command">Remote tmux launch command</Label>
                <Textarea
                  id="server-tmux-command"
                  placeholder={DEFAULT_TMUX_COMMAND}
                  value={serverProfile.terminalTmuxCommand}
                  onChange={event =>
                    void updateTerminalProfile('server', 'terminalTmuxCommand', event.target.value)
                  }
                  disabled={!isElectron}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Runs on the remote host. Use {'{script}'} where Overlord should insert the path of
                  the generated agent launch script on the server.
                </p>
              </div>
            )}
          </div>
        );
      })()}
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
