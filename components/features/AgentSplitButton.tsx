'use client';

import { Bot, Check, ChevronDown, Copy, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ensureAgentTokenAction } from '@/lib/actions/agent-tokens';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';
import type { AgentModelSelection } from '@/lib/helpers/agent-model-preference';
import { normalizeAgentToken } from '@/lib/helpers/agent-token';
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
  organizationId?: number;
  agentToken?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  commands: Record<LaunchAgentTypeValue, string>;
  workingDirectory?: string | null;
  activeAgentIdentifier?: string | null;
  assignedSelection?: TicketAssignedAgent | null;
  hasProjectWorkingDirectory?: boolean;
  agentSessionState?: SessionState | null;
  size?: AgentSplitButtonSize;
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
  organizationId,
  agentToken,
  agentFlags,
  commands,
  workingDirectory,
  activeAgentIdentifier,
  assignedSelection,
  hasProjectWorkingDirectory,
  agentSessionState,
  size = 'default'
}: AgentSplitButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const { selection } = useAgentModelPreference();
  const { isElectron, launchAgent } = useTerminal();
  const ACTIVE_SESSION_STATES: SessionState[] = ['attached', 'blocked', 'idle'];
  const effectiveSelection: AgentModelSelection = assignedSelection ?? selection;

  const isActive =
    isAgentIdentifierMatch(effectiveSelection.agent, activeAgentIdentifier) &&
    agentSessionState !== null &&
    ACTIVE_SESSION_STATES.includes(agentSessionState ?? 'idle');
  const canRunAgent = useLocalDirectoryAccess({ workingDirectory, hasProjectWorkingDirectory });
  const isDisabled = !canRunAgent;
  const styles = sizeStyles[size];

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

    if (!isCopyValue && !canRunAgent) return;

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
        const providedAgentToken = normalizeAgentToken(agentToken);
        const resolvedAgentToken =
          providedAgentToken ??
          (organizationId
            ? await ensureAgentTokenAction(organizationId)
            : (() => {
                throw new Error('No workspace is available for agent token resolution.');
              })());
        await launchAgent(
          ticketId,
          agentValue,
          workingDirectory ?? undefined,
          resolvedAgentToken,
          'run',
          agentFlags?.[agentValue],
          options?.useStoredModelPreference ? (effectiveSelection.model ?? undefined) : undefined,
          options?.useStoredModelPreference ? (effectiveSelection.thinking ?? undefined) : undefined
        );
      } catch (error) {
        console.error('Failed to launch agent:', error);
        toast.error('Failed to open terminal', {
          description:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Check your terminal settings and agent token, then try again.'
        });
      } finally {
        setIsLaunching(false);
      }
    } else {
      await navigator.clipboard.writeText(commands[agentValue]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
        void handleLaunch(effectiveSelection.agent, { useStoredModelPreference: true })
      }
      disabled={isDisabled}
    >
      {isLaunching ? (
        <Loader2 className={cn(styles.loader, 'animate-spin')} />
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
        {copied ? 'Run ✓' : 'Run'}
      </span>
    </button>
  );

  const runButtonWithTooltip = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex', isDisabled && 'cursor-not-allowed')}>{runButton}</span>
      </TooltipTrigger>
      <TooltipContent side="top" hidden={!isDisabled}>
        First set a project directory in the project settings.
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
          {AGENT_SELECTOR_VALUES.map(agentValue => {
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
