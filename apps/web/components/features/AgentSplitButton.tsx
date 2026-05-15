'use client';

import { Bot, Check, ChevronDown, Copy, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useWorkspacePreference } from '@/components/features/projects/useWorkspacePreference';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getTicketPromptForCopy, submitTicketObjectiveAction } from '@/lib/actions/tickets';
import { withElectronActionRetry } from '@/lib/electron-auth/action-retry';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import {
  type AgentSelectorValue,
  isAgentIdentifierMatch,
  isLaunchAgentTypeValue,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import type { TicketAssignedAgent } from '@/lib/helpers/ticket-assigned-agent';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import { useTerminal } from './terminal/TerminalProvider';
import { useLocalDirectoryAccess } from './terminal/useLocalDirectoryAccess';
import { useAgentModelPreference } from './AgentModelSelector';

type SessionState = Database['public']['Enums']['session_state'];

type AgentSplitButtonSize = 'default' | 'xs' | 'sm' | 'lg';

type AgentSplitButtonProps = {
  selectedAgent: AgentSelectorValue;
  onSelectAgent: (agent: AgentSelectorValue) => void;
  ticketId: string;
  organizationId?: number;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  commands?: Record<LaunchAgentTypeValue, string>;
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  activeAgentIdentifier?: string | null;
  assignedSelection?: TicketAssignedAgent | null;
  hasProjectWorkingDirectory?: boolean;
  agentSessionState?: SessionState | null;
  size?: AgentSplitButtonSize;
  /** When launching from a specific draft card, submit that objective row instead of the latest draft. */
  submitObjectiveId?: string | null;
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

const submitTicketObjectiveActionWithRetry = withElectronActionRetry(submitTicketObjectiveAction);

const COPY_PROMPT_LABELS = {
  'copy-local': 'For Local',
  'copy-cloud': 'For Cloud'
} as const;

type CopyPromptOption = keyof typeof COPY_PROMPT_LABELS;

const COPY_PROMPT_OPTIONS: CopyPromptOption[] = ['copy-local', 'copy-cloud'];

export function AgentSplitButton({
  selectedAgent,
  onSelectAgent,
  ticketId,
  organizationId,
  projectId,
  agentFlags,
  commands,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  activeAgentIdentifier,
  assignedSelection,
  hasProjectWorkingDirectory,
  agentSessionState,
  size = 'default',
  submitObjectiveId
}: AgentSplitButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const { selection, loaded: selectionLoaded } = useAgentModelPreference();
  const { isElectron, launchAgent } = useTerminal();
  const workspace = useWorkspacePreference({
    projectId,
    workingDirectory,
    sshCommand,
    remoteWorkingDirectory
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
  const localDirAccess = useLocalDirectoryAccess({
    workingDirectory: effectiveWorkingDirectory,
    hasProjectWorkingDirectory:
      workspace.executionWorkspace === 'local'
        ? Boolean(workspace.hasLocalDirectory)
        : (hasProjectWorkingDirectory ?? false)
  });
  const canRunAgent = hasSshConfig || localDirAccess;
  const isCopySelectedAgent = selectedAgent === 'copy-local' || selectedAgent === 'copy-cloud';
  const isDisabled =
    isRunning ||
    (!canRunAgent && !isCopySelectedAgent) ||
    (!isCopySelectedAgent && !hasResolvedSelection);
  const styles = sizeStyles[size];
  const defaultActionLabel = isElectron ? 'Run' : 'For CLI';
  const primaryActionLabel = isCopySelectedAgent
    ? COPY_PROMPT_LABELS[selectedAgent as CopyPromptOption]
    : defaultActionLabel;
  const PrimaryActionIcon = isCopySelectedAgent || !isElectron ? Copy : Bot;

  const appliedStoredDefaultRef = useRef(false);

  useEffect(() => {
    if (appliedStoredDefaultRef.current) return;
    appliedStoredDefaultRef.current = true;
    if (activeAgentIdentifier) return;
    if (selectedAgent !== 'claude') return;

    const configuredDefault = readDefaultAgentTriggerFromStorage();
    if (configuredDefault !== selectedAgent) {
      onSelectAgent(configuredDefault);
    }
  }, [activeAgentIdentifier, onSelectAgent, selectedAgent]);

  async function handleLaunch(
    agentValue: AgentSelectorValue = effectiveSelection.agent,
    options?: { useStoredModelPreference?: boolean }
  ): Promise<void> {
    const isCopyLocalValue = agentValue === 'copy-local';
    const isCopyCloudValue = agentValue === 'copy-cloud';
    const isCopyValue = isCopyLocalValue || isCopyCloudValue;

    if (!isCopyValue && (!canRunAgent || !hasResolvedSelection)) return;

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

    if (isElectron) {
      setIsLaunching(true);
      try {
        await submitTicketObjectiveActionWithRetry(ticketId, submitObjectiveId ?? undefined);
        await launchAgent({
          ticketId,
          agent: agentValue,
          organizationId,
          cwd: effectiveWorkingDirectory ?? undefined,
          launchMode: 'run',
          flags: agentFlags?.[agentValue],
          model: options?.useStoredModelPreference
            ? (effectiveSelection.model ?? undefined)
            : undefined,
          thinking: options?.useStoredModelPreference
            ? (effectiveSelection.thinking ?? undefined)
            : undefined,
          sshCommand: effectiveSshCommand ?? undefined,
          remoteWorkingDirectory: effectiveRemoteWorkingDirectory ?? undefined,
          projectId: projectId ?? undefined
        });
      } catch (error) {
        console.error('Failed to launch agent:', error);
        toast.error('Failed to open terminal', {
          description:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Check your terminal settings and sign in again, then try again.'
        });
      } finally {
        setIsLaunching(false);
      }
    } else {
      const command = commands?.[agentValue];
      if (command) {
        await submitTicketObjectiveAction(ticketId, submitObjectiveId ?? undefined);
        await navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
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

  const runButtonWithTooltip = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>{runButton}</span>
      </TooltipTrigger>
      <TooltipContent side="top" hidden={!isDisabled}>
        {isRunning
          ? 'An agent is already running on this ticket.'
          : !canRunAgent && !isCopySelectedAgent
            ? 'First set a project directory in the project settings.'
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
