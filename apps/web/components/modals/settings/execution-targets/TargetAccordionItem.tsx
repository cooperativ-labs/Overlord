'use client';

import { ArrowRight, ArrowRightLeft, Check, Copy, X } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useElectron } from '@/components/features/terminal/useElectron';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  claimExecutionTargetAction,
  type ExecutionTargetOwnership,
  setExecutionTargetOwnershipAction,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import { type AgentLaunchConfig } from '@/lib/schemas/target-agent-config';

import { AgentNameWithLogo } from './AgentNameWithLogo';
import {
  AGENT_LABELS,
  AGENTS,
  authMethodLabel,
  DEFAULT_TERMINAL_PROFILE,
  DEFAULT_TMUX_COMMAND,
  externalTerminalAppOptions,
  externalTerminalLaunchModeOptions,
  isTmuxLikeProfile,
  PROFILE_FIELDS,
  settingKey,
  type TerminalProfileState,
  tmuxHostTerminalOptions
} from './execution-targets-helpers';

export function TargetAccordionItem({
  target,
  api,
  isElectron,
  ownership,
  onOwnershipChanged,
  onGetAgentConfig,
  onSavePreCommand,
  onPreCommandInput,
  onAddFlag,
  onRemoveFlag,
  onBuildLocalAgentCommand,
  onNavigate
}: {
  target: UserExecutionTargetDetailed;
  api: ReturnType<typeof useElectron>['api'];
  isElectron: boolean;
  ownership?: ExecutionTargetOwnership;
  onOwnershipChanged?: () => void;
  onGetAgentConfig: (args: { targetId: string; agent: string }) => AgentLaunchConfig;
  onSavePreCommand: (args: { targetId: string; agent: string; value: string }) => Promise<void>;
  onPreCommandInput: (args: { targetId: string; agent: string; value: string }) => void;
  onAddFlag: (args: {
    targetId: string;
    selectedLocalAgent: string;
    flagInput: string;
  }) => Promise<void>;
  onRemoveFlag: (args: { targetId: string; agent: string; index: number }) => Promise<void>;
  onBuildLocalAgentCommand: (args: { targetId: string; agent: string }) => string;
  onNavigate?: (section: string) => void;
}) {
  const [profile, setProfile] = useState<TerminalProfileState>(DEFAULT_TERMINAL_PROFILE);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [pendingOrgId, setPendingOrgId] = useState<number | null>(null);
  const [selectedLocalAgent, setSelectedLocalAgent] = useState<string>('claude');
  const [flagInput, setFlagInput] = useState('');

  async function handleClaim(organizationId: number) {
    setPendingOrgId(organizationId);
    try {
      await claimExecutionTargetAction({ targetId: target.id, organizationId });
      toast.success('Target claimed as personal.');
      onOwnershipChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to claim target.');
    } finally {
      setPendingOrgId(null);
    }
  }

  async function handleMakeOrgOwned(organizationId: number) {
    setPendingOrgId(organizationId);
    try {
      await setExecutionTargetOwnershipAction({
        targetId: target.id,
        organizationId,
        ownerUserId: null
      });
      toast.success('Target donated to the organization.');
      onOwnershipChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update target ownership.');
    } finally {
      setPendingOrgId(null);
    }
  }

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
  const localAgentConfig = onGetAgentConfig({ targetId: target.id, agent: selectedLocalAgent });

  async function handleAddFlagToTarget() {
    await onAddFlag({
      targetId: target.id,
      selectedLocalAgent,
      flagInput
    });
    setFlagInput('');
  }

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
        {ownership && ownership.organizations.length > 0 ? (
          <div className="grid gap-3 rounded-md border p-4">
            <div className="grid gap-1">
              <h4 className="text-sm font-medium">Ownership</h4>
              <p className="text-xs text-muted-foreground">
                A personal target is managed only by its owner. An organization-owned target can be
                managed by any project editor. Claiming requires admin permissions in the
                organization.
              </p>
            </div>
            <div className="grid gap-2">
              {ownership.organizations.map(org => {
                const isPending = pendingOrgId === org.organizationId;
                const statusLabel = org.isOwnedByMe
                  ? 'Owned by you'
                  : org.isOrgOwned
                    ? 'Organization-owned'
                    : 'Owned by another member';
                return (
                  <div
                    key={org.organizationId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{org.organizationName}</span>
                      <span className="text-xs text-muted-foreground">{statusLabel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={org.isOrgOwned ? 'outline' : 'secondary'}
                        className="text-[10px] uppercase"
                      >
                        {org.isOrgOwned ? 'Org' : 'Personal'}
                      </Badge>
                      {org.canClaim ? (
                        <LoadingButton
                          type="button"
                          variant="outline"
                          size="sm"
                          buttonState={isPending ? 'loading' : 'default'}
                          text={
                            <span className="flex items-center gap-1.5">
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Claim
                            </span>
                          }
                          onClick={() => void handleClaim(org.organizationId)}
                        />
                      ) : org.canMakeOrgOwned ? (
                        <LoadingButton
                          type="button"
                          variant="outline"
                          size="sm"
                          buttonState={isPending ? 'loading' : 'default'}
                          text={
                            <span className="flex items-center gap-1.5">
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Make org-owned
                            </span>
                          }
                          onClick={() => void handleMakeOrgOwned(org.organizationId)}
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

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

        {isElectron ? (
          <div className="grid gap-4 rounded-md border p-4">
            <div className="grid gap-1">
              <h4 className="text-sm font-medium">Local agent configuration</h4>
              <p className="text-xs text-muted-foreground">
                Customize how Overlord launches each local agent for this execution target.
              </p>
            </div>
            <div className="grid gap-4">
              <Select value={selectedLocalAgent} onValueChange={setSelectedLocalAgent}>
                <SelectTrigger>
                  <SelectValue placeholder="Select agent" />
                </SelectTrigger>
                <SelectContent>
                  {AGENTS.map(agent => (
                    <SelectItem key={agent} value={agent}>
                      <AgentNameWithLogo agent={agent} label={AGENT_LABELS[agent] ?? agent} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Pre-command</label>
                  <input
                    type="text"
                    placeholder="e.g., ollama or agent-pod"
                    value={localAgentConfig.preCommand ?? ''}
                    onChange={e =>
                      onPreCommandInput({
                        targetId: target.id,
                        agent: selectedLocalAgent,
                        value: e.target.value
                      })
                    }
                    onBlur={e =>
                      void onSavePreCommand({
                        targetId: target.id,
                        agent: selectedLocalAgent,
                        value: e.target.value
                      })
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void onSavePreCommand({
                          targetId: target.id,
                          agent: selectedLocalAgent,
                          value: e.currentTarget.value
                        });
                      }
                    }}
                    className="w-full rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Runs in your shell before the agent binary, wrapping it - e.g.{' '}
                    <code className="rounded bg-muted px-1">ollama</code> launches{' '}
                    <code className="rounded bg-muted px-1">ollama {selectedLocalAgent} ...</code>
                  </p>
                  {localAgentConfig.preCommand ? (
                    <div className="rounded-md border border-yellow-500/40 bg-yellow-50/50 p-2.5 dark:bg-yellow-900/10">
                      <p className="text-[11px] text-yellow-800 dark:text-yellow-300">
                        If this command runs inside a container, make sure{' '}
                        <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                          overlord-cli
                        </code>{' '}
                        is installed{' '}
                        <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                          npm install -g overlord-cli
                        </code>{' '}
                        there so agents can communicate with Overlord. We recommend generating a
                        token and using the{' '}
                        <code className="rounded bg-yellow-100 px-1 dark:bg-yellow-900/30">
                          ovld auth login --token {`<oat...>`}
                        </code>{' '}
                        command to persist it in your environment.
                      </p>
                      <LoadingButton
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2 w-fit"
                        buttonState="default"
                        text={
                          <span className="flex items-center gap-1.5">
                            Manage agent tokens
                            <ArrowRight className="h-3.5 w-3.5" />
                          </span>
                        }
                        onClick={() => onNavigate?.('Agent Tokens')}
                      />
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-foreground">Command flags</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g., --enable-auto-mode"
                      value={flagInput}
                      onChange={e => setFlagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleAddFlagToTarget();
                        }
                      }}
                      className="flex-1 rounded border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAddFlagToTarget()}
                      className="rounded border bg-muted px-3 py-2 text-xs font-medium hover:bg-muted/80"
                    >
                      Add
                    </button>
                  </div>
                </div>
                {localAgentConfig.flags.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {localAgentConfig.flags.map((flag, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1"
                        >
                          <code className="text-xs font-medium">{flag}</code>
                          <button
                            type="button"
                            onClick={() =>
                              void onRemoveFlag({
                                targetId: target.id,
                                agent: selectedLocalAgent,
                                index
                              })
                            }
                            className="rounded p-0.5 hover:bg-muted-foreground/20"
                            title="Remove flag"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">Example command</p>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                    {onBuildLocalAgentCommand({ targetId: target.id, agent: selectedLocalAgent })}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ) : null}

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
