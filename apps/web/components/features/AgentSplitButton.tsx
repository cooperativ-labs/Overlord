'use client';

import { Bot, Check, ChevronDown, Copy, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useProjectSettings } from '@/components/features/projects/ProjectSettingsContext';
import { useWorkspacePreference } from '@/components/features/projects/useWorkspacePreference';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getTicketPromptForCopy,
  requestTicketObjectiveExecutionAction,
  updateTicketAssignedAgentAction
} from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import {
  type AgentSelectorValue,
  isAgentIdentifierMatch,
  isLaunchAgentTypeValue,
  type LaunchAgentType
} from '@/lib/helpers/agent-types';
import { buildCustomAgentValues, resolveCustomAgentCommand } from '@/lib/helpers/custom-agent';
import { assignedAgentSelectionToJson } from '@/lib/helpers/ticket-assigned-agent';
import {
  NO_ASSIGNED_AGENT_ERROR,
  parseExecutionAgentFromAssignment
} from '@/lib/overlord/resolve-execution-agent';
import { CUSTOM_AGENTS_CONFIG_KEY } from '@/lib/schemas/agent-config';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';
import type { TicketAssignedAgent } from '@/types/tickets';

import { type TerminalContextValue, useTerminalOptional } from './terminal/TerminalProvider';
import { useLocalDirectoryAccess } from './terminal/useLocalDirectoryAccess';
import { useAgentModelPreference } from './AgentModelSelector';

const DEMO_TERMINAL_CONTEXT: TerminalContextValue = {
  isElectron: true,
  launchAgent: async () => {}
};

type SessionState = Database['public']['Enums']['session_state'];

type AgentSplitButtonSize = 'default' | 'xs' | 'sm' | 'lg';

type AgentSplitButtonProps = {
  selectedAgent: AgentSelectorValue;
  onSelectAgent: (agent: AgentSelectorValue) => void;
  ticketId: string;
  organizationId?: number;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentType, string[]>>;
  agentPreCommands?: Partial<Record<LaunchAgentType, string>>;
  commands?: Record<LaunchAgentType, string>;
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  sshEnabled?: boolean;
  activeAgentIdentifier?: string | null;
  assignedSelection?: TicketAssignedAgent | null;
  hasProjectWorkingDirectory?: boolean;
  agentSessionState?: SessionState | null;
  size?: AgentSplitButtonSize;
  /** When launching from a specific draft card, submit that objective row instead of the latest draft. */
  submitObjectiveId?: string | null;
  /** Marketing/demo surfaces: show Run chrome without launching or copying. */
  demo?: boolean;
};

const sizeStyles: Record<
  AgentSplitButtonSize,
  {
    runButton: string;
    caretButton: string;
    label: string;
    icon: string;
    loader: string;
    chevron: string;
  }
> = {
  default: {
    runButton: 'h-9 px-4 text-sm font-medium',
    caretButton: 'h-9 px-2',
    label: 'text-sm',
    icon: 'h-3.5 w-3.5',
    loader: 'h-3.5 w-3.5',
    chevron: 'h-3.5 w-3.5'
  },
  xs: {
    runButton: 'h-6 px-3 text-xs font-medium',
    caretButton: 'h-6 px-1',
    label: 'text-xs',
    icon: 'h-3.5 w-3.5',
    loader: 'h-3.5 w-3.5',
    chevron: 'h-3 w-3'
  },
  sm: {
    runButton: 'h-8 px-3 text-xs font-medium',
    caretButton: 'h-8 px-2',
    label: 'text-xs',
    icon: 'h-3.5 w-3.5',
    loader: 'h-3.5 w-3.5',
    chevron: 'h-3.5 w-3.5'
  },
  lg: {
    runButton: 'h-10 px-4 text-sm font-medium',
    caretButton: 'h-10 px-2',
    label: 'text-sm',
    icon: 'h-4 w-4',
    loader: 'h-4 w-4',
    chevron: 'h-3.5 w-3.5'
  }
};

const COPY_PROMPT_LABELS = {
  'copy-local': 'For Local',
  'copy-cloud': 'For Cloud'
} as const;

type CopyPromptOption = keyof typeof COPY_PROMPT_LABELS;

const COPY_PROMPT_OPTIONS: CopyPromptOption[] = ['copy-local', 'copy-cloud'];

const updateTicketAssignedAgentActionWithRetry = withElectronActionRetry(
  updateTicketAssignedAgentAction
);

export function AgentSplitButton({
  selectedAgent,
  onSelectAgent,
  ticketId,
  projectId,
  agentFlags,
  agentPreCommands,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  sshEnabled,
  activeAgentIdentifier,
  assignedSelection,
  hasProjectWorkingDirectory,
  agentSessionState,
  size = 'default',
  submitObjectiveId,
  demo = false
}: AgentSplitButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [showRunningConfirm, setShowRunningConfirm] = useState(false);
  const { selection, configs, loaded: selectionLoaded } = useAgentModelPreference();
  const projectSettingsCtx = useProjectSettings();
  const terminalContext = useTerminalOptional();
  if (!demo && !terminalContext) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  const { isElectron } = demo ? DEMO_TERMINAL_CONTEXT : (terminalContext as TerminalContextValue);
  const workspace = useWorkspacePreference({
    projectId,
    workingDirectory,
    sshCommand,
    remoteWorkingDirectory,
    isElectron: demo ? true : isElectron,
    sshEnabled
  });
  const ACTIVE_SESSION_STATES: SessionState[] = ['attached', 'blocked', 'idle'];
  const effectiveSelection: AgentModelSelection = assignedSelection ?? selection;
  const hasResolvedSelection = assignedSelection !== null || selectionLoaded;
  const effectiveWorkingDirectory = workspace.effectiveWorkingDirectory;
  const effectiveSshCommand = workspace.effectiveSshCommand;
  const effectiveRemoteWorkingDirectory = workspace.effectiveRemoteWorkingDirectory;
  const isRunning = agentSessionState === 'attached';

  const isActive =
    !isRunning &&
    isAgentIdentifierMatch(effectiveSelection.agent, activeAgentIdentifier) &&
    agentSessionState !== null &&
    ACTIVE_SESSION_STATES.includes(agentSessionState ?? 'idle');
  const hasSshConfig = Boolean(effectiveSshCommand?.trim());
  const localDirAccessResolved = useLocalDirectoryAccess({
    workingDirectory: effectiveWorkingDirectory,
    hasProjectWorkingDirectory:
      workspace.executionWorkspace === 'local'
        ? Boolean(workspace.hasLocalDirectory)
        : (hasProjectWorkingDirectory ?? false)
  });
  const localDirAccess = demo ? true : localDirAccessResolved;
  const canRunAgent = hasSshConfig || localDirAccess;
  const canRequestExecution = canRunAgent || Boolean(projectId);
  const isCopySelectedAgent = selectedAgent === 'copy-local' || selectedAgent === 'copy-cloud';
  const isDisabled = demo
    ? false
    : (!canRequestExecution && !isCopySelectedAgent) ||
      (!isCopySelectedAgent && !hasResolvedSelection);
  const styles = sizeStyles[size];
  const defaultActionLabel = 'Run';
  const primaryActionLabel = isCopySelectedAgent
    ? COPY_PROMPT_LABELS[selectedAgent as CopyPromptOption]
    : defaultActionLabel;
  const PrimaryActionIcon = isCopySelectedAgent ? Copy : Bot;

  const appliedStoredDefaultRef = useRef(false);
  const pendingLaunchRef = useRef<{
    agentValue: AgentSelectorValue;
    options?: { useStoredModelPreference?: boolean };
  } | null>(null);

  useEffect(() => {
    if (demo) return;
    if (appliedStoredDefaultRef.current) return;
    appliedStoredDefaultRef.current = true;
    if (activeAgentIdentifier) return;
    if (selectedAgent !== 'claude') return;

    const configuredDefault = readDefaultAgentTriggerFromStorage();
    if (configuredDefault !== selectedAgent) {
      onSelectAgent(configuredDefault);
    }
  }, [activeAgentIdentifier, demo, onSelectAgent, selectedAgent]);

  async function handleLaunch(
    agentValue: AgentSelectorValue = effectiveSelection.agent,
    options?: {
      useStoredModelPreference?: boolean;
      force?: boolean;
      skipRunningConfirm?: boolean;
    }
  ): Promise<void> {
    if (demo) return;

    const isCopyLocalValue = agentValue === 'copy-local';
    const isCopyCloudValue = agentValue === 'copy-cloud';
    const isCopyValue = isCopyLocalValue || isCopyCloudValue;

    if (!isCopyValue && (!canRequestExecution || !hasResolvedSelection)) return;

    if (isRunning && !options?.force && !options?.skipRunningConfirm) {
      pendingLaunchRef.current = { agentValue, options };
      setShowRunningConfirm(true);
      return;
    }

    if (isCopyValue) {
      const { error, prompt } = await getTicketPromptForCopy(
        ticketId,
        'run',
        isCopyLocalValue ? 'cli' : 'web',
        submitObjectiveId ?? undefined
      );
      if (error || !prompt) return;
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (!isLaunchAgentTypeValue(agentValue)) return;

    const persistedAssignment = parseExecutionAgentFromAssignment(
      assignedAgentSelectionToJson(effectiveSelection)
    );
    if (!persistedAssignment) {
      toast.error('No agent assigned', { description: NO_ASSIGNED_AGENT_ERROR });
      return;
    }

    try {
      await updateTicketAssignedAgentActionWithRetry(
        ticketId,
        effectiveSelection,
        submitObjectiveId ?? null
      );
    } catch (error) {
      console.error('Failed to save agent assignment:', error);
      toast.error('Failed to save agent assignment', {
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Select an agent and try again.'
      });
      return;
    }

    // When the active selection targets a user-defined custom agent, resolve its
    // launch-command template (placeholders filled from the model/thinking choice)
    // and queue it as a custom execution. The runner launches it via the generic
    // PTY path (desktop) or `ovld launch-custom` (CLI).
    const customAgentId = effectiveSelection.customAgentId ?? null;
    let customCommand: string | undefined;
    let resolvedAgentIdentifier: string = agentValue;
    if (customAgentId) {
      const customAgents = configs[CUSTOM_AGENTS_CONFIG_KEY]?.customAgents ?? [];
      const customAgent = customAgents.find(agent => agent.id === customAgentId);
      if (!customAgent) {
        toast.error('Custom agent not found', {
          description: 'Re-select an agent in the model selector and try again.'
        });
        return;
      }
      customCommand = resolveCustomAgentCommand(
        customAgent.commandTemplate,
        buildCustomAgentValues(
          customAgent,
          effectiveSelection.model ?? null,
          effectiveSelection.thinking ?? null
        )
      );
      resolvedAgentIdentifier = customAgent.id;
    }

    setIsLaunching(true);
    try {
      const result = await requestTicketObjectiveExecutionAction({
        ticketId,
        objectiveId: submitObjectiveId ?? undefined,
        customCommand,
        workingDirectory:
          workspace.executionWorkspace === 'local'
            ? (effectiveWorkingDirectory ?? undefined)
            : null,
        sshCommand:
          workspace.executionWorkspace === 'ssh' ? (effectiveSshCommand ?? undefined) : null,
        remoteWorkingDirectory:
          workspace.executionWorkspace === 'ssh'
            ? (effectiveRemoteWorkingDirectory ?? undefined)
            : null,
        flags: customAgentId ? undefined : agentFlags?.[agentValue],
        preCommand: customAgentId ? undefined : agentPreCommands?.[agentValue],
        targetExecutionTargetId: projectSettingsCtx?.selectedDeviceId ?? undefined
      });
      if ('error' in result) {
        toast.error('Failed to queue execution', { description: result.error });
      }
    } catch (error) {
      console.error('Failed to queue execution:', error);
      toast.error('Failed to queue execution', {
        description:
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : 'Check your connection and sign in again, then try again.'
      });
    } finally {
      setIsLaunching(false);
    }
  }

  const runButton = (
    <button
      type="button"
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-l-md transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        styles.runButton,
        isDisabled && 'cursor-not-allowed opacity-60'
      )}
      onClick={() =>
        void handleLaunch(isCopySelectedAgent ? selectedAgent : effectiveSelection.agent, {
          useStoredModelPreference: !isCopySelectedAgent
        })
      }
      disabled={isDisabled}
    >
      {isLaunching ? (
        <Loader2 className={cn(styles.loader, 'animate-spin')} />
      ) : (
        <PrimaryActionIcon className={styles.icon} />
      )}
      <span
        className={cn(
          'transition-colors whitespace-nowrap',
          styles.label,
          isActive && 'text-emerald-600 animate-pulse'
        )}
      >
        {copied ? `${primaryActionLabel} ✓` : primaryActionLabel}
      </span>
    </button>
  );

  const runButtonWithTooltip = isRunning ? (
    <Popover open={showRunningConfirm} onOpenChange={setShowRunningConfirm}>
      <PopoverTrigger asChild>
        <span className="inline-flex">{runButton}</span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-80 p-3 text-sm">
        <p className="mb-3 text-foreground">
          It appears an agent is still working on this ticket. Queue this objective to launch after
          the current one completes?
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            onClick={() => {
              setShowRunningConfirm(false);
              pendingLaunchRef.current = null;
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent"
            onClick={() => {
              setShowRunningConfirm(false);
              const pending = pendingLaunchRef.current;
              void handleLaunch(
                pending?.agentValue ??
                  (isCopySelectedAgent ? selectedAgent : effectiveSelection.agent),
                {
                  ...(pending?.options ?? { useStoredModelPreference: !isCopySelectedAgent }),
                  force: true
                }
              );
              pendingLaunchRef.current = null;
            }}
          >
            Launch now
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={() => {
              setShowRunningConfirm(false);
              const pending = pendingLaunchRef.current;
              void handleLaunch(
                pending?.agentValue ??
                  (isCopySelectedAgent ? selectedAgent : effectiveSelection.agent),
                {
                  ...(pending?.options ?? { useStoredModelPreference: !isCopySelectedAgent }),
                  skipRunningConfirm: true
                }
              );
              pendingLaunchRef.current = null;
            }}
          >
            Queue
          </button>
        </div>
      </PopoverContent>
    </Popover>
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>{runButton}</span>
      </TooltipTrigger>
      <TooltipContent side="top" hidden={!isDisabled}>
        {!canRunAgent && !isCopySelectedAgent
          ? 'Set a project directory or register a runner resource for this project.'
          : 'Loading your agent model selection.'}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-md border border-input bg-background text-sm shadow-sm transition-all',
        !isDisabled && 'hover:bg-accent hover:text-accent-foreground',
        isActive &&
          'animate-pulse border-emerald-600/80 ring-1 ring-emerald-600/70 shadow-[0_0_10px_3px_hsl(var(--emerald-600)/0.4)]'
      )}
    >
      {runButtonWithTooltip}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center rounded-r-md border-l transition-colors',
              !isDisabled && 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
              isDisabled && 'cursor-not-allowed',
              styles.caretButton
            )}
            disabled={isDisabled}
          >
            <ChevronDown className={cn(styles.chevron, 'text-muted-foreground')} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          <DropdownMenuItem
            className="gap-2 text-xs"
            onClick={() => {
              onSelectAgent(effectiveSelection.agent);
              void handleLaunch(effectiveSelection.agent, {
                useStoredModelPreference: true
              });
            }}
          >
            {isElectron ? <Bot className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{defaultActionLabel}</span>
            {!isCopySelectedAgent && <Check className="ml-auto h-3 w-3 text-muted-foreground" />}
          </DropdownMenuItem>
          {COPY_PROMPT_OPTIONS.map(value => (
            <DropdownMenuItem
              key={value}
              className="gap-2 text-xs"
              onClick={() => {
                onSelectAgent(value);
                void handleLaunch(value);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              <span>{COPY_PROMPT_LABELS[value]}</span>
              {value === selectedAgent && (
                <Check className="ml-auto h-3 w-3 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
