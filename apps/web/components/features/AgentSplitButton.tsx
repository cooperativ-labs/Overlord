'use client';

import { Bot, Check, ChevronDown, Copy, Loader2 } from 'lucide-react';
import Image from 'next/image';
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
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import {
  AGENT_SELECTOR_VALUES,
  type AgentSelectorValue,
  getAgentTypeByValue,
  isAgentIdentifierMatch,
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
  allowedAgents?: readonly AgentSelectorValue[];
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

export function AgentSplitButton({
  selectedAgent,
  onSelectAgent,
  ticketId,
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
  allowedAgents
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

  const isActive =
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
    (!canRunAgent && !isCopySelectedAgent) || (!isCopySelectedAgent && !hasResolvedSelection);
  const styles = sizeStyles[size];
  const visibleAgents = allowedAgents
    ? AGENT_SELECTOR_VALUES.filter(v => allowedAgents.includes(v))
    : AGENT_SELECTOR_VALUES;

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
        isCopyLocalValue ? 'cli' : 'web'
      );
      if (error || !prompt) return;
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (isElectron) {
      setIsLaunching(true);
      try {
        await submitTicketObjectiveAction(ticketId);
        await launchAgent(
          ticketId,
          agentValue,
          effectiveWorkingDirectory ?? undefined,
          undefined,
          'run',
          agentFlags?.[agentValue],
          options?.useStoredModelPreference ? (effectiveSelection.model ?? undefined) : undefined,
          options?.useStoredModelPreference
            ? (effectiveSelection.thinking ?? undefined)
            : undefined,
          effectiveSshCommand ?? undefined,
          effectiveRemoteWorkingDirectory ?? undefined
        );
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
      const command = commands?.[agentValue as LaunchAgentTypeValue];
      if (command) {
        await submitTicketObjectiveAction(ticketId);
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
      ) : isCopySelectedAgent ? (
        <Copy className={styles.icon} />
      ) : (
        <Bot className={styles.icon} />
      )}
      <span
        className={cn(
          'transition-colors whitespace-nowrap',
          styles.label,
          isActive && 'text-emerald-600 animate-pulse'
        )}
      >
        {copied
          ? `${isCopySelectedAgent ? (selectedAgent === 'copy-local' ? 'Copy Local' : 'Copy Cloud') : 'Run'} ✓`
          : isCopySelectedAgent
            ? selectedAgent === 'copy-local'
              ? 'Copy Local'
              : 'Copy Cloud'
            : 'Run'}
      </span>
    </button>
  );

  const runButtonWithTooltip = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>{runButton}</span>
      </TooltipTrigger>
      <TooltipContent side="top" hidden={!isDisabled}>
        {!canRunAgent && !isCopySelectedAgent
          ? 'First set a project directory in the project settings.'
          : 'Loading your agent model selection.'}
      </TooltipContent>
    </Tooltip>
  );

  const activeDropdownAgent =
    activeAgentIdentifier !== null
      ? (AGENT_SELECTOR_VALUES.find(
          agentValue =>
            agentValue !== 'copy-local' &&
            agentValue !== 'copy-cloud' &&
            isAgentIdentifierMatch(agentValue, activeAgentIdentifier)
        ) ?? null)
      : null;

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-md border border-input bg-background text-sm shadow-sm transition-all hover:bg-accent hover:text-accent-foreground',
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
              'inline-flex cursor-pointer items-center rounded-r-md border-l transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              styles.caretButton
            )}
          >
            <ChevronDown className={cn(styles.chevron, 'text-muted-foreground')} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[170px]">
          {visibleAgents.map(agentValue => {
            const isCopyValue = agentValue === 'copy-local' || agentValue === 'copy-cloud';
            const agent = isCopyValue ? null : getAgentTypeByValue(agentValue);
            const agentIsActive = activeDropdownAgent === agentValue;
            const label = agent
              ? agent.label
              : agentValue === 'copy-local'
                ? 'Copy Local'
                : 'Copy Cloud';

            return (
              <DropdownMenuItem
                key={agentValue}
                className="gap-2 text-xs"
                onClick={() => {
                  onSelectAgent(agentValue);
                  void handleLaunch(agentValue);
                }}
              >
                {agent ? (
                  <Image
                    src={agent.icon}
                    alt={`${agent.label} icon`}
                    width={14}
                    height={14}
                    className="h-3.5 w-3.5"
                  />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                <span className={cn(agentIsActive && 'text-emerald-600')}>{label}</span>
                {agentValue === selectedAgent && (
                  <Check className="ml-auto h-3 w-3 text-muted-foreground" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
