'use client';

import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
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
import {
  getUserExecutionTargetsWithDetailsAction,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';

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

const PROFILE_FIELDS: (keyof TerminalProfileState)[] = [
  'terminalApp',
  'terminalLaunchMode',
  'terminalCustomHotkey',
  'customTerminalApp',
  'terminalTmuxHostApp',
  'customTerminalTmuxHostApp',
  'terminalTmuxCommand'
];

function settingKey(targetId: string, field: keyof TerminalProfileState): string {
  return `executionTarget.${targetId}.${field}`;
}

function isTmuxLikeProfile(profile: TerminalProfileState) {
  if (profile.terminalApp === 'tmux' || profile.terminalApp === 'cmux') return true;
  if (profile.terminalApp !== 'custom') return false;
  const normalized = profile.customTerminalApp.trim().toLowerCase();
  return normalized.includes('tmux') || normalized.includes('cmux');
}

function authMethodLabel(method: string): string {
  switch (method) {
    case 'agent':
      return 'SSH Agent';
    case 'key':
      return 'Private Key';
    case 'tailscale':
      return 'Tailscale SSH';
    default:
      return method;
  }
}

export function ExecutionTargetsPage({ open }: { open: boolean }) {
  const { api, isElectron } = useElectron();
  const [targets, setTargets] = useState<UserExecutionTargetDetailed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getUserExecutionTargetsWithDetailsAction()
      .then(rows => {
        if (cancelled) return;
        setTargets(rows);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load execution targets', err);
        setError(err instanceof Error ? err.message : 'Failed to load execution targets.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
          Per-target terminal launch settings only apply when running the Overlord desktop app.
        </div>
      )}

      <div className="grid gap-1">
        <h3 className="text-sm font-medium">Execution targets</h3>
        <p className="text-xs text-muted-foreground">
          Configure how Overlord opens each execution target. Settings are saved per target and per
          machine.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading execution targets…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : targets.length === 0 ? (
        <div className="rounded-md border bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
          You don&apos;t have any execution targets yet. Targets are created automatically when you
          launch an agent locally or add a remote SSH target to a project.
        </div>
      ) : (
        <Accordion type="multiple" className="rounded-md border">
          {targets.map(target => (
            <TargetAccordionItem
              key={target.id}
              target={target}
              api={api}
              isElectron={isElectron}
            />
          ))}
        </Accordion>
      )}
    </div>
  );
}

function TargetAccordionItem({
  target,
  api,
  isElectron
}: {
  target: UserExecutionTargetDetailed;
  api: ReturnType<typeof useElectron>['api'];
  isElectron: boolean;
}) {
  const [profile, setProfile] = useState<TerminalProfileState>(DEFAULT_TERMINAL_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (!api) {
      setProfileLoaded(true);
      return;
    }
    let cancelled = false;
    Promise.all(
      PROFILE_FIELDS.map(field => api.settings.get<string>(settingKey(target.id, field)))
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
  }, [api, target.id]);

  const updateProfile = useCallback(
    async (field: keyof TerminalProfileState, value: string) => {
      setProfile(current => ({ ...current, [field]: value }));
      await api?.settings.set(settingKey(target.id, field), value);
    },
    [api, target.id]
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

  const isSsh = target.transport === 'ssh' || target.transport === 'tailscale_ssh';
  const transportLabel = isSsh
    ? target.transport === 'tailscale_ssh'
      ? 'Tailscale SSH'
      : 'SSH'
    : 'Local';

  const inputsDisabled = !isElectron || !profileLoaded;

  return (
    <AccordionItem value={target.id} className="px-4">
      <AccordionTrigger>
        <div className="flex flex-1 flex-col gap-1 pr-2">
          <div className="flex items-center gap-2">
            <span className="font-medium">{target.label}</span>
            <Badge variant="secondary" className="text-[10px] uppercase">
              {transportLabel}
            </Badge>
            {target.isPlaceholder && (
              <Badge variant="outline" className="text-[10px] uppercase">
                Pending
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {target.hostname || 'No hostname'}
            {target.platform ? ` · ${target.platform}` : ''}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="grid gap-4">
        <div className="grid gap-4 rounded-md border p-4">
          <div className="grid gap-1">
            <h4 className="text-sm font-medium">Terminal settings</h4>
            <p className="text-xs text-muted-foreground">
              Overlord opens this terminal application when launching an agent on this target.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`target-${target.id}-app`}>External terminal application</Label>
            <Select
              value={profile.terminalApp}
              onValueChange={value => void updateProfile('terminalApp', value)}
              disabled={inputsDisabled}
            >
              <SelectTrigger id={`target-${target.id}-app`}>
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
                <Label htmlFor={`target-${target.id}-custom-app`}>
                  Custom terminal name or path
                </Label>
                <Input
                  id={`target-${target.id}-custom-app`}
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
                  <Label htmlFor={`target-${target.id}-tmux-host`}>Run tmux in</Label>
                  <Select
                    value={profile.terminalTmuxHostApp}
                    onValueChange={value => void updateProfile('terminalTmuxHostApp', value)}
                    disabled={inputsDisabled}
                  >
                    <SelectTrigger id={`target-${target.id}-tmux-host`}>
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
                    <Label htmlFor={`target-${target.id}-custom-tmux-host`}>
                      Custom host terminal name or path
                    </Label>
                    <Input
                      id={`target-${target.id}-custom-tmux-host`}
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
                  <Label htmlFor={`target-${target.id}-tmux-command`}>tmux launch command</Label>
                  <Textarea
                    id={`target-${target.id}-tmux-command`}
                    placeholder={DEFAULT_TMUX_COMMAND}
                    value={profile.terminalTmuxCommand}
                    onChange={event =>
                      void updateProfile('terminalTmuxCommand', event.target.value)
                    }
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
          <div className="grid gap-2">
            {supportsLaunchModeSelection && (
              <>
                <Label htmlFor={`target-${target.id}-launch-mode`}>When opening a terminal</Label>
                <Select
                  value={profile.terminalLaunchMode}
                  onValueChange={value => void updateProfile('terminalLaunchMode', value)}
                  disabled={inputsDisabled}
                >
                  <SelectTrigger id={`target-${target.id}-launch-mode`}>
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
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Custom mode sends a keystroke to your terminal; verify it triggers the intended
                    layout before launching real work.
                  </p>
                )}
              </>
            )}
            {!supportsLaunchModeSelection && (
              <p className="text-xs text-muted-foreground">
                {isTmux
                  ? 'tmux runs the launch command inside a fresh host terminal so multiple agent runs can coexist.'
                  : isTmuxLike
                    ? 'tmux-like terminals open a fresh instance for each launch.'
                    : 'This terminal opens directly into a new session for each launch.'}
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor={`target-${target.id}-hotkey`}>Custom hotkey</Label>
              <Input
                id={`target-${target.id}-hotkey`}
                placeholder="Press the key combination to use (e.g. Cmd + D)"
                value={profile.terminalCustomHotkey}
                onKeyDown={handleHotkeyKeyDown}
                readOnly
                disabled={inputsDisabled}
              />
              <p className="text-xs text-muted-foreground">
                Overlord activates {selectedTerminalLabel}, sends this hotkey, then types the launch
                command.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 rounded-md border p-4">
          <div className="grid gap-1">
            <h4 className="text-sm font-medium">SSH settings</h4>
            <p className="text-xs text-muted-foreground">
              {isSsh
                ? 'Stored credentials Overlord can use to connect to this target.'
                : 'This is a local execution target, so no SSH credentials are stored.'}
            </p>
          </div>
          {isSsh && (
            <div className="grid gap-2 text-sm">
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono text-xs">{target.hostname || '—'}</span>
              </div>
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <span className="text-muted-foreground">Port</span>
                <span className="font-mono text-xs">{target.port ?? 22}</span>
              </div>
              {target.sshCredentials.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  No SSH credentials are saved for your user on this target yet.
                </p>
              ) : (
                <div className="mt-1 grid gap-2">
                  {target.sshCredentials.map((cred, index) => (
                    <div
                      key={`${cred.username}-${cred.authMethod}-${index}`}
                      className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs"
                    >
                      <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="text-muted-foreground">Username</span>
                        <span className="font-mono">{cred.username}</span>
                      </div>
                      <div className="grid grid-cols-[120px_1fr] gap-2">
                        <span className="text-muted-foreground">Auth method</span>
                        <span>{authMethodLabel(cred.authMethod)}</span>
                      </div>
                      {cred.privateKeyPath && (
                        <div className="grid grid-cols-[120px_1fr] gap-2">
                          <span className="text-muted-foreground">Private key</span>
                          <span className="font-mono break-all">{cred.privateKeyPath}</span>
                        </div>
                      )}
                      {cred.hostKeyFingerprint && (
                        <div className="grid grid-cols-[120px_1fr] gap-2">
                          <span className="text-muted-foreground">Host fingerprint</span>
                          <span className="font-mono break-all">{cred.hostKeyFingerprint}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
