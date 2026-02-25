'use client';

import { Copy } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  COPY_PROMPT_AGENT_VALUES,
  type CopyPromptAgentTypeValue,
  getAgentTypeByValue,
  isAgentIdentifierMatch,
  LAUNCH_AGENT_VALUES,
  type LaunchAgentTypeValue
} from '@/lib/helpers/agent-types';
import { cn } from '@/lib/utils';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  ticketId: string;
  agentToken?: string | null;
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
  workingDirectory?: string | null;
  className?: string;
  activeAgentIdentifier?: string | null;
};

function LaunchButton({
  agent,
  ticketId,
  agentToken,
  clipboardCommand,
  workingDirectory,
  isActive
}: {
  agent: LaunchAgentTypeValue;
  ticketId: string;
  agentToken?: string | null;
  clipboardCommand: string;
  workingDirectory?: string | null;
  isActive?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const { isElectron, launchAgent } = useTerminal();
  const agentDetails = getAgentTypeByValue(agent);

  async function handleClick() {
    if (isElectron) {
      await launchAgent(ticketId, agent, workingDirectory ?? undefined, agentToken ?? undefined);
    } else {
      await navigator.clipboard.writeText(clipboardCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      className={cn(
        'h-6 gap-1.5 text-xs transition-all',
        isActive &&
          'border-emerald-600/80 shadow-[0_0_10px_3px_hsl(var(--emerald-600)/0.4)] ring-1 ring-emerald-600/70 animate-pulse'
      )}
      size="sm"
      variant="outline"
      onClick={handleClick}
    >
      <Image
        src={agentDetails.icon}
        alt={`${agentDetails.label} icon`}
        width={12}
        height={12}
        className="h-3 w-3"
      />
      <span className={cn('transition-colors', isActive && 'text-emerald-600 animate-pulse')}>
        {!isElectron && copied ? `${agentDetails.label} ✓` : agentDetails.label}
      </span>
    </Button>
  );
}

function CopyAgentCommandButton({
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand
}: {
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
  geminiCommand: string;
}) {
  async function handleCopy({ agent }: { agent: CopyPromptAgentTypeValue }) {
    const commandsByAgent: Record<CopyPromptAgentTypeValue, string> = {
      claude: claudeCommand,
      codex: codexCommand,
      cursor: cursorCommand,
      gemini: geminiCommand
    };

    await navigator.clipboard.writeText(commandsByAgent[agent]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-6 gap-1.5 text-xs" size="sm" variant="outline">
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
  agentToken,
  claudeCommand,
  codexCommand,
  cursorCommand,
  geminiCommand,
  workingDirectory,
  className,
  activeAgentIdentifier
}: Props) {
  const { isElectron } = useTerminal();
  const commandsByAgent: Record<LaunchAgentTypeValue, string> = {
    claude: claudeCommand,
    codex: codexCommand,
    cursor: cursorCommand,
    gemini: geminiCommand
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5',
        className
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {isElectron ? 'Run agent' : 'Copy prompts'}
      </span>
      {LAUNCH_AGENT_VALUES.map(agent => (
        <LaunchButton
          key={agent}
          agent={agent}
          ticketId={ticketId}
          agentToken={agentToken}
          clipboardCommand={commandsByAgent[agent]}
          workingDirectory={workingDirectory}
          isActive={isAgentIdentifierMatch(agent, activeAgentIdentifier)}
        />
      ))}
      <CopyAgentCommandButton
        claudeCommand={claudeCommand}
        codexCommand={codexCommand}
        cursorCommand={cursorCommand}
        geminiCommand={geminiCommand}
      />
      {/* {isElectron && (
        <>
          <div className="h-4 w-px bg-border" />
          <RunAgentButton ticketId={ticketId} agentToken={agentToken} workingDirectory={workingDirectory} />
        </>
      )} */}
      {/* <div className="h-4 w-px bg-border" /> */}
      {/* <Button asChild className="h-6 text-xs" size="sm" variant="outline">
        <a href={chatGptLink} rel="noreferrer" target="_blank">
          ChatGPT ↗
        </a>
      </Button> */}
    </div>
  );
}
