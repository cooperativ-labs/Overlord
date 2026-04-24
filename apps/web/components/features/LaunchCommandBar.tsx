'use client';

import { Copy } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { readDefaultAgentTriggerFromStorage } from '@/lib/helpers/agent-trigger';
import {
  AGENT_SELECTOR_VALUES,
  type AgentSelectorValue,
  COPY_PROMPT_AGENT_VALUES,
  type CopyPromptAgentTypeValue,
  getAgentTypeByValue,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';
import type { Database } from '@/types/database.types';

import { useTerminal } from './terminal/TerminalProvider';
import { AgentSplitButton } from './AgentSplitButton';

type SessionState = Database['public']['Enums']['session_state'];

type Props = {
  ticketId: string;
  projectId?: string | null;
  agentFlags?: Partial<Record<LaunchAgentTypeValue, string[]>>;
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  opencodeCommand: string;
  workingDirectory?: string | null;
  sshCommand?: string | null;
  remoteWorkingDirectory?: string | null;
  className?: string;
  activeAgentIdentifier?: string | null;
  hasProjectWorkingDirectory?: boolean;
  agentSessionState?: SessionState | null;
};

const LAST_AGENT_KEY = 'overlord-last-agent';

function useLastAgent(): [AgentSelectorValue, (agent: AgentSelectorValue) => void] {
  const [agent, setAgent] = useState<AgentSelectorValue>('claude');

  useEffect(() => {
    const stored = localStorage.getItem(LAST_AGENT_KEY);
    if (stored && AGENT_SELECTOR_VALUES.includes(stored as AgentSelectorValue)) {
      setAgent(stored as AgentSelectorValue);
      return;
    }
    setAgent(readDefaultAgentTriggerFromStorage());
  }, []);

  const persist = useCallback((next: AgentSelectorValue) => {
    setAgent(next);
    localStorage.setItem(LAST_AGENT_KEY, next);
  }, []);

  return [agent, persist];
}

function CopyAgentCommandButton({
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  opencodeCommand
}: {
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  opencodeCommand: string;
}) {
  async function handleCopy({ agent }: { agent: CopyPromptAgentTypeValue }) {
    const commandsByAgent: Record<CopyPromptAgentTypeValue, string> = {
      claude: claudeCommand,
      codex: codexCommand,
      cursor: cursorCommand,
      gemini: geminiCommand,
      opencode: opencodeCommand
    };

    await navigator.clipboard.writeText(commandsByAgent[agent]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-7 gap-1.5 text-xs" size="sm" variant="outline">
          <Copy className="h-3 w-3" />
          Prompts
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {COPY_PROMPT_AGENT_VALUES.map(agentValue => {
          const agent = getAgentTypeByValue(agentValue);
          return (
            <DropdownMenuItem
              key={agent.value}
              className="text-xs"
              onClick={() => handleCopy({ agent: agentValue })}
            >
              {agent.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LaunchCommandBar({
  ticketId,
  projectId,
  agentFlags,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  opencodeCommand,
  workingDirectory,
  sshCommand,
  remoteWorkingDirectory,
  className,
  activeAgentIdentifier,
  hasProjectWorkingDirectory,
  agentSessionState
}: Props) {
  const { isElectron } = useTerminal();
  const [selectedAgent, setSelectedAgent] = useLastAgent();

  if (!isElectron) return null;
  const commands: Record<LaunchAgentTypeValue, string> = {
    claude: claudeCommand,
    codex: codexCommand,
    cursor: cursorCommand,
    gemini: geminiCommand,
    opencode: opencodeCommand
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5',
        className
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {isElectron ? 'Run agent' : 'Copy prompt'}
      </span>
      <AgentSplitButton
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        ticketId={ticketId}
        projectId={projectId}
        agentFlags={agentFlags}
        commands={commands}
        workingDirectory={workingDirectory}
        sshCommand={sshCommand}
        remoteWorkingDirectory={remoteWorkingDirectory}
        activeAgentIdentifier={activeAgentIdentifier}
        hasProjectWorkingDirectory={hasProjectWorkingDirectory}
        agentSessionState={agentSessionState}
        size="xs"
      />
      <CopyAgentCommandButton
        claudeCommand={claudeCommand}
        codexCommand={codexCommand}
        cursorCommand={cursorCommand}
        geminiCommand={geminiCommand}
        opencodeCommand={opencodeCommand}
      />
    </div>
  );
}
