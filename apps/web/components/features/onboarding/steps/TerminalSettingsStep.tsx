'use client';

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  DEFAULT_TERMINAL_PROFILE,
  DEFAULT_TMUX_COMMAND,
  externalTerminalAppOptions,
  externalTerminalLaunchModeOptions,
  isTmuxLikeProfile,
  PROFILE_FIELDS,
  settingKey,
  type TerminalProfileState,
  tmuxHostTerminalOptions
} from '@/components/modals/settings/execution-targets/execution-targets-helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  executionTargetId: string;
  onContinue: () => void;
};

export function TerminalSettingsStep({ executionTargetId, onContinue }: Props) {
  const { api, isElectron } = useElectron();
  const [profile, setProfile] = useState<TerminalProfileState>(DEFAULT_TERMINAL_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!api) {
      setProfileLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.all(
      PROFILE_FIELDS.map(field => api.settings.get<string>(settingKey(executionTargetId, field)))
    ).then(values => {
      if (cancelled) return;
      const next: TerminalProfileState = { ...DEFAULT_TERMINAL_PROFILE };
      PROFILE_FIELDS.forEach((field, index) => {
        const value = values[index];
        if (typeof value === 'string' && value.length > 0) {
          (next as Record<string, string>)[field] = value;
        }
      });
      setProfile(next);
      setProfileLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [api, executionTargetId]);

  const updateProfile = useCallback(
    async (field: keyof TerminalProfileState, value: string) => {
      setProfile(current => ({ ...current, [field]: value }));
      await api?.settings.set(settingKey(executionTargetId, field), value);
    },
    [api, executionTargetId]
  );

  const handleHotkeyKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Tab') return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        void updateProfile('terminalCustomHotkey', '');
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
      void updateProfile('terminalCustomHotkey', parts.join(' + '));
    },
    [updateProfile]
  );

  if (!isElectron) return null;

  const isTmuxLike = isTmuxLikeProfile(profile);
  const isTmux = profile.terminalApp === 'tmux';
  const supportsLaunchModeSelection =
    !isTmuxLike &&
    profile.terminalApp !== 'ghostty' &&
    profile.terminalApp !== 'alacritty' &&
    profile.terminalApp !== 'kitty';

  const inputsDisabled = !profileLoaded;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Choose your terminal</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Overlord opens this terminal application when launching an agent on your machine.
        </p>
      </div>

      <div className="grid gap-4 rounded-lg border p-4">
        <div className="grid gap-2">
          <Label htmlFor="onboarding-terminal-app">Terminal application</Label>
          <Select
            value={profile.terminalApp}
            onValueChange={value => void updateProfile('terminalApp', value)}
            disabled={inputsDisabled}
          >
            <SelectTrigger id="onboarding-terminal-app">
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
              <Label htmlFor="onboarding-custom-app">Custom terminal name or path</Label>
              <Input
                id="onboarding-custom-app"
                placeholder="Example: cmux or /Applications/cmux.app"
                value={profile.customTerminalApp}
                onChange={event => void updateProfile('customTerminalApp', event.target.value)}
                disabled={inputsDisabled}
              />
            </div>
          )}
          {isTmux && (
            <div className="grid gap-3 rounded-md border bg-muted/30 p-3">
              <div className="grid gap-2">
                <Label htmlFor="onboarding-tmux-host">Run tmux in</Label>
                <Select
                  value={profile.terminalTmuxHostApp}
                  onValueChange={value => void updateProfile('terminalTmuxHostApp', value)}
                  disabled={inputsDisabled}
                >
                  <SelectTrigger id="onboarding-tmux-host">
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
                  <Label htmlFor="onboarding-custom-tmux-host">
                    Custom host terminal name or path
                  </Label>
                  <Input
                    id="onboarding-custom-tmux-host"
                    placeholder="Example: WezTerm or /Applications/WezTerm.app"
                    value={profile.customTerminalTmuxHostApp}
                    onChange={event =>
                      void updateProfile('customTerminalTmuxHostApp', event.target.value)
                    }
                    disabled={inputsDisabled}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="onboarding-tmux-command">tmux launch command</Label>
                <Textarea
                  id="onboarding-tmux-command"
                  placeholder={DEFAULT_TMUX_COMMAND}
                  value={profile.terminalTmuxCommand}
                  onChange={event => void updateProfile('terminalTmuxCommand', event.target.value)}
                  disabled={inputsDisabled}
                  rows={2}
                />
                <p className="text-xs text-muted-foreground">
                  Use {'{script}'} where Overlord should insert the generated launch script.
                </p>
              </div>
            </div>
          )}
        </div>

        {supportsLaunchModeSelection && (
          <div className="grid gap-2">
            <Label htmlFor="onboarding-launch-mode">When opening a terminal</Label>
            <Select
              value={profile.terminalLaunchMode}
              onValueChange={value => void updateProfile('terminalLaunchMode', value)}
              disabled={inputsDisabled}
            >
              <SelectTrigger id="onboarding-launch-mode">
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
        )}

        <div className="grid gap-2">
          <Label htmlFor="onboarding-hotkey">Custom hotkey (optional)</Label>
          <Input
            id="onboarding-hotkey"
            placeholder="Press a key combination (e.g. Cmd + D)"
            value={profile.terminalCustomHotkey}
            onKeyDown={handleHotkeyKeyDown}
            readOnly
            disabled={inputsDisabled}
          />
          <p className="text-xs text-muted-foreground">
            Overlord activates your terminal, sends this hotkey, then types the launch command.
          </p>
        </div>
      </div>

      <Button onClick={onContinue} className="self-start">
        Continue
      </Button>
    </div>
  );
}
