'use client';

import { ArrowRight, ArrowRightLeft, Check, Copy, Trash2, X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
import { deleteOrganizationExecutionTargetAction } from '@/lib/actions/devices';
import {
  claimExecutionTargetAction,
  type ExecutionTargetOwnership,
  setExecutionTargetOwnershipAction,
  updateExecutionTargetLabelAction,
  type UserExecutionTargetDetailed
} from '@/lib/actions/resource-directories';
import { type RunnerTerminalProfile } from '@/lib/helpers/runner-terminal-settings';
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import { type AgentLaunchConfig } from '@/lib/schemas/target-agent-config';
import { cn } from '@/lib/utils';

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
  type TerminalProfileState,
  tmuxHostTerminalOptions
} from './execution-targets-helpers';

export function TargetAccordionItem({
  target,
  isElectron,
  ownership,
  terminalProfile,
  onTerminalProfileChange,
  onOwnershipChanged,
  onGetAgentConfig,
  onSavePreCommand,
  onPreCommandInput,
  onAddFlag,
  onRemoveFlag,
  onBuildLocalAgentCommand,
  onLabelChanged,
  onDeleted,
  onNavigate
}: {
  target: UserExecutionTargetDetailed;
  isElectron: boolean;
  ownership?: ExecutionTargetOwnership;
  terminalProfile: RunnerTerminalProfile;
  onTerminalProfileChange: (profile: RunnerTerminalProfile) => Promise<void> | void;
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
  onLabelChanged?: (targetId: string, newLabel: string) => void;
  onDeleted?: (targetId: string, organizationId: number) => void;
  onNavigate?: (section: string) => void;
}) {
  const [profile, setProfile] = useState<TerminalProfileState>(DEFAULT_TERMINAL_PROFILE);
  const [pendingOrgId, setPendingOrgId] = useState<number | null>(null);
  const [selectedLocalAgent, setSelectedLocalAgent] = useState<string>('claude');
  const [flagInput, setFlagInput] = useState('');

  const [labelInput, setLabelInput] = useState(target.label);
  const [labelEditing, setLabelEditing] = useState(false);
  const [pendingDeleteOrgId, setPendingDeleteOrgId] = useState<number | null>(null);
  const [confirmDeleteOrgId, setConfirmDeleteOrgId] = useState<number | null>(null);
  const [deleteDialogOrgId, setDeleteDialogOrgId] = useState<number | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const LABEL_REGEX = /^[a-z0-9][a-z0-9-]*$/;

  function validateLabel(value: string): string | null {
    if (!value.trim()) return 'Label cannot be empty.';
    if (!LABEL_REGEX.test(value))
      return 'Only lowercase letters, digits, and hyphens allowed. Must start with a letter or digit.';
    return null;
  }

  async function handleLabelBlur() {
    setLabelEditing(false);
    const trimmed = labelInput.trim();
    const error = validateLabel(trimmed);
    if (error) {
      setLabelInput(target.label);
      toast.error(error);
      return;
    }
    if (trimmed === target.label) {
      setLabelInput(target.label);
      return;
    }

    const previousLabel = target.label;
    onLabelChanged?.(target.id, trimmed);
    setLabelInput(trimmed);

    try {
      await updateExecutionTargetLabelAction({ targetId: target.id, label: trimmed });
    } catch (err) {
      onLabelChanged?.(target.id, previousLabel);
      setLabelInput(previousLabel);
      toast.error(err instanceof Error ? err.message : 'Failed to update label.');
    }
  }

  function handleCancelLabelEdit() {
    setLabelInput(target.label);
    setLabelEditing(false);
  }

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

  async function handleDeleteTarget(organizationId: number) {
    setPendingDeleteOrgId(organizationId);
    try {
      await deleteOrganizationExecutionTargetAction({
        organizationId,
        executionTargetId: target.id
      });
      toast.success('Target removed from the organization.');
      setConfirmDeleteOrgId(null);
      setDeleteDialogOrgId(null);
      onDeleted?.(target.id, organizationId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove execution target.');
    } finally {
      setPendingDeleteOrgId(null);
    }
  }

  useEffect(() => {
    if (!labelEditing) {
      setLabelInput(target.label);
    }
  }, [target.label, labelEditing]);

  useEffect(() => {
    const next: TerminalProfileState = { ...DEFAULT_TERMINAL_PROFILE };
    PROFILE_FIELDS.forEach(field => {
      const value = terminalProfile[field];
      if (typeof value === 'string' && value.length > 0) {
        (next as Record<string, string>)[field] = value;
      }
    });
    setProfile(next);
  }, [terminalProfile]);

  const updateProfile = useCallback(
    async (field: keyof TerminalProfileState, value: string) => {
      const next = { ...profile, [field]: value };
      setProfile(next);
      await onTerminalProfileChange(next);
    },
    [onTerminalProfileChange, profile]
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
    'System Default';
  const launchModeLabel = externalTerminalLaunchModeOptions.find(
    opt => opt.value === profile.terminalLaunchMode
  )?.label;

  const isSsh = target.transport === 'ssh' || target.transport === 'tailscale_ssh';
  const transportLabel = isSsh
    ? target.transport === 'tailscale_ssh'
      ? 'Tailscale SSH'
      : 'SSH'
    : 'Local';

  const inputsDisabled = false;
  const localAgentConfig = onGetAgentConfig({ targetId: target.id, agent: selectedLocalAgent });
  const selectedLocalAgentLabel = AGENT_LABELS[selectedLocalAgent] ?? selectedLocalAgent;
  const localAgentPreCommand = localAgentConfig.preCommand?.trim();
  const localAgentFlags = localAgentConfig.flags;
  const executionTargetSuffix = target.id.slice(-4);
  const deletableOrgs = ownership?.organizations.filter(org => org.isAdmin) ?? [];
  const deleteDialogOrg = deletableOrgs.find(org => org.organizationId === deleteDialogOrgId);

  // Derive terminal label from the prop directly for the outer trigger
  const triggerTerminalLabel =
    externalTerminalAppOptions.find(opt => opt.value === terminalProfile.terminalApp)?.label ??
    'System Default';

  async function handleCopyExecutionTargetId(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const didCopy = await copy(target.id);
    if (didCopy) {
      toast.success('Execution target ID copied.');
      return;
    }
    toast.error('Could not copy execution target ID.');
  }

  async function handleAddFlagToTarget() {
    await onAddFlag({
      targetId: target.id,
      selectedLocalAgent,
      flagInput
    });
    setFlagInput('');
  }

  return (
    <AccordionItem
      value={target.id}
      className="rounded-lg border border-border bg-card px-4 shadow-sm"
    >
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex flex-1 items-start gap-2 pr-2">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {/* Row 1: Name + ID badge + status badges */}
            <div className="flex items-center gap-2">
              {labelEditing ? (
                <Input
                  id={`target-${target.id}-label`}
                  value={labelInput}
                  onChange={e => setLabelInput(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelLabelEdit();
                    }
                  }}
                  onBlur={() => void handleLabelBlur()}
                  autoFocus
                  className="h-7 w-auto min-w-32 max-w-[16rem] font-medium"
                />
              ) : (
                <button
                  type="button"
                  className="font-medium text-left hover:underline"
                  title="Click to edit label"
                  onClick={e => {
                    e.stopPropagation();
                    setLabelInput(target.label);
                    setLabelEditing(true);
                  }}
                >
                  {target.label}
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyExecutionTargetId}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full',
                  copied && 'text-green-700 dark:text-green-300'
                )}
                aria-label={`Copy execution target ID ${target.id}`}
                title={copied ? 'Copied execution target ID' : 'Copy execution target ID'}
              >
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {executionTargetSuffix}
                </Badge>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              </button>
              {target.isPlaceholder && (
                <Badge variant="outline" className="text-[10px] uppercase">
                  Pending
                </Badge>
              )}
            </div>
            {/* Row 2: Machine info */}
            {(target.hostname || target.platform) && (
              <span className="text-xs text-muted-foreground">
                {target.hostname || 'No hostname'}
                {target.platform ? ` · ${target.platform}` : ''}
              </span>
            )}
            {/* Row 3: Config summary */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={isSsh ? 'default' : 'secondary'} className="text-[10px]">
                {transportLabel}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {triggerTerminalLabel}
              </Badge>
              {isSsh && target.sshCredentials.length > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  {target.sshCredentials.length} credential
                  {target.sshCredentials.length !== 1 ? 's' : ''}
                </Badge>
              )}
              {isSsh && target.sshCredentials.length === 0 && (
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  No credentials
                </Badge>
              )}
            </div>
          </div>
          {deletableOrgs.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label="Delete execution target from organization"
                  title="Delete from organization"
                  onClick={e => e.stopPropagation()}
                  onPointerDown={e => e.stopPropagation()}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                <DropdownMenuLabel>Remove from organization</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {deletableOrgs.map(org => (
                  <DropdownMenuItem
                    key={org.organizationId}
                    className="text-destructive focus:text-destructive"
                    disabled={pendingDeleteOrgId !== null}
                    onSelect={() => setDeleteDialogOrgId(org.organizationId)}
                  >
                    {org.organizationName}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </AccordionTrigger>

      <AlertDialog
        open={deleteDialogOrgId !== null}
        onOpenChange={open => {
          if (!open) setDeleteDialogOrgId(null);
        }}
      >
        <AlertDialogContent onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove execution target?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{target.label}</strong> from{' '}
              <strong>{deleteDialogOrg?.organizationName}</strong>. The target will no longer be
              available in that organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingDeleteOrgId !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pendingDeleteOrgId !== null || deleteDialogOrgId === null}
              onClick={e => {
                e.preventDefault();
                if (deleteDialogOrgId !== null) {
                  void handleDeleteTarget(deleteDialogOrgId);
                }
              }}
            >
              {pendingDeleteOrgId !== null ? 'Removing…' : 'Remove target'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AccordionContent className="grid gap-4 pb-4">
        <Accordion type="multiple" className="grid gap-3">
          {/* Ownership */}
          {ownership && ownership.organizations.length > 0 ? (
            <AccordionItem
              value={`${target.id}-ownership`}
              className="rounded-md border border-border bg-background px-4"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 flex-col gap-1.5 pr-2">
                  <h4 className="text-sm font-medium">Ownership</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {ownership.organizations.map(org => (
                      <Badge
                        key={org.organizationId}
                        variant={org.isOrgOwned ? 'outline' : 'secondary'}
                        className="text-[10px]"
                      >
                        {org.organizationName} ·{' '}
                        {org.isOwnedByMe ? 'Personal' : org.isOrgOwned ? 'Org-owned' : 'Shared'}
                      </Badge>
                    ))}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-3">
                  <p className="text-xs text-muted-foreground">
                    A personal target is managed only by its owner. An organization-owned target can
                    be managed by any project editor. Claiming requires admin permissions in the
                    organization.
                  </p>
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
                            <span className="truncate text-sm font-medium">
                              {org.organizationName}
                            </span>
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
                            {org.isAdmin ? (
                              confirmDeleteOrgId === org.organizationId ? (
                                <div className="flex items-center gap-1">
                                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                                    Delete?
                                  </span>
                                  <LoadingButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    buttonState={
                                      pendingDeleteOrgId === org.organizationId
                                        ? 'loading'
                                        : 'default'
                                    }
                                    text={<Check className="h-3.5 w-3.5" />}
                                    onClick={() => void handleDeleteTarget(org.organizationId)}
                                  />
                                  <LoadingButton
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    buttonState="default"
                                    text={<X className="h-3.5 w-3.5" />}
                                    onClick={() => setConfirmDeleteOrgId(null)}
                                    disabled={pendingDeleteOrgId === org.organizationId}
                                  />
                                </div>
                              ) : (
                                <LoadingButton
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  buttonState="default"
                                  text={
                                    <span className="flex items-center gap-1.5">
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Delete
                                    </span>
                                  }
                                  onClick={() => setConfirmDeleteOrgId(org.organizationId)}
                                  disabled={pendingDeleteOrgId !== null}
                                />
                              )
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ) : null}

          {/* Terminal settings */}
          <AccordionItem
            value={`${target.id}-terminal`}
            className="rounded-md border border-border bg-background px-4 last:border-b"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex flex-1 flex-col gap-1.5 pr-2">
                <h4 className="text-sm font-medium">Terminal</h4>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="secondary" className="text-[10px]">
                    {selectedTerminalLabel}
                  </Badge>
                  {supportsLaunchModeSelection && launchModeLabel && (
                    <Badge variant="outline" className="text-[10px]">
                      {launchModeLabel}
                    </Badge>
                  )}
                  {profile.terminalCustomHotkey && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {profile.terminalCustomHotkey}
                    </Badge>
                  )}
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={`target-${target.id}-app`}>Terminal application</Label>
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
                        onChange={event =>
                          void updateProfile('customTerminalApp', event.target.value)
                        }
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
                        <Label htmlFor={`target-${target.id}-tmux-command`}>
                          tmux launch command
                        </Label>
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
                      <Label htmlFor={`target-${target.id}-launch-mode`}>
                        When opening a terminal
                      </Label>
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
                          Custom mode sends a keystroke to your terminal; verify it triggers the
                          intended layout before launching real work.
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
                      Overlord activates {selectedTerminalLabel}, sends this hotkey, then types the
                      launch command.
                    </p>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Local agent configuration (Electron only) */}
          {isElectron ? (
            <AccordionItem
              value={`${target.id}-local-agent`}
              className="rounded-md border border-border bg-background px-4 last:border-b"
            >
              <AccordionTrigger className="hover:no-underline">
                <div className="flex flex-1 flex-col gap-1.5 pr-2">
                  <h4 className="text-sm font-medium">Agent overrides</h4>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {localAgentPreCommand ? (
                      <Badge
                        variant="secondary"
                        className="max-w-full truncate font-mono text-[10px]"
                      >
                        pre: {localAgentPreCommand}
                      </Badge>
                    ) : null}
                    {localAgentFlags.length > 0
                      ? localAgentFlags.map((flag, index) => (
                          <Badge
                            key={`${flag}-${index}`}
                            variant="outline"
                            className="max-w-full truncate font-mono text-[10px]"
                          >
                            {flag}
                          </Badge>
                        ))
                      : null}
                    {!localAgentPreCommand && localAgentFlags.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        No overrides for {selectedLocalAgentLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Agent</Label>
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
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`target-${target.id}-pre-command`}>Pre-command</Label>
                    <Input
                      id={`target-${target.id}-pre-command`}
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
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Runs in your shell before the agent binary, wrapping it — e.g.{' '}
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
                  <div className="grid gap-2">
                    <Label>Command flags</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="e.g., --enable-auto-mode"
                        value={flagInput}
                        onChange={e => setFlagInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void handleAddFlagToTarget();
                          }
                        }}
                      />
                      <LoadingButton
                        type="button"
                        variant="outline"
                        size="sm"
                        buttonState="default"
                        text="Add"
                        onClick={() => void handleAddFlagToTarget()}
                      />
                    </div>
                    {localAgentConfig.flags.length > 0 ? (
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
                    ) : null}
                  </div>
                  <div className="grid gap-2 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-foreground">Example command</p>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">
                      {onBuildLocalAgentCommand({
                        targetId: target.id,
                        agent: selectedLocalAgent
                      })}
                    </pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ) : null}

          {/* SSH settings */}
          {/* <AccordionItem value={`${target.id}-ssh`} className="rounded-md border px-4 bg-background">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex flex-1 flex-col gap-1.5 pr-2">
                <h4 className="text-sm font-medium">SSH</h4>
                {isSsh ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {target.hostname || 'no host'}:{target.port ?? 22}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {target.sshCredentials.length} credential
                      {target.sshCredentials.length !== 1 ? 's' : ''}
                    </Badge>
                    {target.transport === 'tailscale_ssh' && (
                      <Badge variant="outline" className="text-[10px]">
                        Tailscale
                      </Badge>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Local target — no SSH credentials
                  </span>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-3">
                {isSsh ? (
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
                                <span className="break-all font-mono">{cred.privateKeyPath}</span>
                              </div>
                            )}
                            {cred.hostKeyFingerprint && (
                              <div className="grid grid-cols-[120px_1fr] gap-2">
                                <span className="text-muted-foreground">Host fingerprint</span>
                                <span className="break-all font-mono">
                                  {cred.hostKeyFingerprint}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This is a local execution target, so no SSH credentials are stored.
                  </p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem> */}
        </Accordion>
      </AccordionContent>
    </AccordionItem>
  );
}
