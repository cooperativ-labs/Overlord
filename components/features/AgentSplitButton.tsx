'use client';

import { Check, ChevronDown, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  getAgentTypeByValue,
  isAgentIdentifierMatch,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import { useTerminal } from './terminal/TerminalProvider';

type SessionState = Database['public']['Enums']['session_state'];

type AgentSplitButtonSize = 'default' | 'xs' | 'sm' | 'lg';

type AgentSplitButtonProps = {
  selectedAgent: LaunchAgentTypeValue;
  onSelectAgent: (agent: LaunchAgentTypeValue) => void;
  ticketId: string;
  agentToken?: string | null;
  commands: Record<LaunchAgentTypeValue, string>;
  workingDirectory?: string | null;
  activeAgentIdentifier?: string | null;
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
  agentToken,
  commands,
  workingDirectory,
  activeAgentIdentifier,
  hasProjectWorkingDirectory,
  agentSessionState,
  size = 'default'
}: AgentSplitButtonProps) {
  const [copied, setCopied] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const { isElectron, launchAgent } = useTerminal();
  const agentDetails = getAgentTypeByValue(selectedAgent);
  const ACTIVE_SESSION_STATES: SessionState[] = ['attached', 'blocked', 'idle'];
  const isActive =
    isAgentIdentifierMatch(selectedAgent, activeAgentIdentifier) &&
    agentSessionState !== null &&
    ACTIVE_SESSION_STATES.includes(agentSessionState ?? 'idle');
  const canRunAgent = hasProjectWorkingDirectory ?? true;
  const isDisabled = !canRunAgent;
  const styles = sizeStyles[size];

  const isLaunchingRef = useRef(false);
  const sessionStateAtLaunchRef = useRef<SessionState | null | undefined>(undefined);

  useEffect(() => {
    if (!isLaunchingRef.current) return;
    if (
      agentSessionState !== sessionStateAtLaunchRef.current &&
      (agentSessionState === 'attached' ||
        agentSessionState === 'blocked' ||
        agentSessionState === 'disconnected')
    ) {
      isLaunchingRef.current = false;
      setIsLaunching(false);
    }
  }, [agentSessionState]);

  async function handleLaunch() {
    if (!canRunAgent) return;

    if (isElectron) {
      isLaunchingRef.current = true;
      sessionStateAtLaunchRef.current = agentSessionState;
      setIsLaunching(true);
      await launchAgent(
        ticketId,
        selectedAgent,
        workingDirectory ?? undefined,
        agentToken ?? undefined
      );
    } else {
      await navigator.clipboard.writeText(commands[selectedAgent]);
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
      onClick={handleLaunch}
      disabled={isDisabled}
    >
      {isLaunching ? (
        <Loader2 className={cn(styles.loader, 'animate-spin')} />
      ) : (
        <Image
          src={agentDetails.icon}
          alt={`${agentDetails.label} icon`}
          width={16}
          height={16}
          className={styles.icon}
        />
      )}
      <span
        className={cn(
          'transition-colors',
          styles.label,
          isActive && 'text-emerald-600 animate-pulse'
        )}
      >
        {!isElectron && copied ? `${agentDetails.label} ✓` : agentDetails.label}
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

  return (
    <div
      className={cn(
        'inline-flex items-stretch rounded-md border bg-background text-sm transition-all border-input shadow-sm hover:bg-accent hover:text-accent-foreground',
        isActive &&
        'border-emerald-600/80 shadow-[0_0_10px_3px_hsl(var(--emerald-600)/0.4)] ring-1 ring-emerald-600/70 animate-pulse'
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
        <DropdownMenuContent align="end" className="min-w-[140px]">
          {LAUNCH_AGENT_VALUES.map(agentValue => {
            const agent = getAgentTypeByValue(agentValue);
            const agentIsActive = isAgentIdentifierMatch(agentValue, activeAgentIdentifier);
            return (
              <DropdownMenuItem
                key={agent.value}
                className="gap-2 text-xs"
                onClick={() => onSelectAgent(agentValue)}
              >
                <Image
                  src={agent.icon}
                  alt={`${agent.label} icon`}
                  width={14}
                  height={14}
                  className="h-3.5 w-3.5"
                />
                <span className={cn(agentIsActive && 'text-emerald-600')}>{agent.label}</span>
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
