'use client';

import { Bot, Copy, Play, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  ticketId: string;
  agentToken?: string | null;
  claudeCommand: string;
  codexCommand: string;
  chatGptLink: string;
  workingDirectory?: string | null;
};

function LaunchButton({
  label,
  agent,
  ticketId,
  agentToken,
  clipboardCommand,
  workingDirectory
}: {
  label: string;
  agent: 'claude' | 'codex';
  ticketId: string;
  agentToken?: string | null;
  clipboardCommand: string;
  workingDirectory?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const { isElectron, launchAgent } = useTerminal();

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
    <Button className="h-6 gap-1.5 text-xs" size="sm" variant="outline" onClick={handleClick}>
      {isElectron ? (
        <>
          <Bot className="h-3 w-3" />
          {label}
        </>
      ) : copied ? (
        `${label} ✓`
      ) : (
        <>
          <Terminal className="h-3 w-3" />
          {label}
        </>
      )}
    </Button>
  );
}

type CopyAgent = 'claude' | 'codex' | 'cursor';

function CopyAgentCommandButton({
  claudeCommand,
  codexCommand,
  cursorCommand
}: {
  claudeCommand: string;
  codexCommand: string;
  cursorCommand: string;
}) {
  async function handleCopy({ agent }: { agent: CopyAgent }) {
    const commandsByAgent: Record<CopyAgent, string> = {
      claude: claudeCommand,
      codex: codexCommand,
      cursor: cursorCommand
    };

    await navigator.clipboard.writeText(commandsByAgent[agent]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-6 gap-1.5 text-xs" size="sm" variant="outline">
          <Copy className="h-3 w-3" />
          Copy command
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem className="text-xs" onClick={() => handleCopy({ agent: 'claude' })}>
          Claude
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => handleCopy({ agent: 'codex' })}>
          Codex
        </DropdownMenuItem>
        <DropdownMenuItem className="text-xs" onClick={() => handleCopy({ agent: 'cursor' })}>
          Cursor
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RunAgentButton({
  ticketId,
  agentToken,
  workingDirectory
}: {
  ticketId: string;
  agentToken?: string | null;
  workingDirectory?: string | null;
}) {
  const { isElectron, launchAgent } = useTerminal();

  if (!isElectron) return null;

  async function handleClick() {
    await launchAgent(ticketId, 'claude', workingDirectory ?? undefined, agentToken ?? undefined);
  }

  return (
    <Button className="h-6 gap-1.5 text-xs" size="sm" variant="default" onClick={handleClick}>
      <Bot className="h-3 w-3" />
      Run Agent
    </Button>
  );
}

export function LaunchCommandBar({
  ticketId,
  agentToken,
  claudeCommand,
  codexCommand,
  chatGptLink,
  workingDirectory
}: Props) {
  const { isElectron } = useTerminal();
  const cursorCommand = codexCommand;

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">
        {isElectron ? 'Run agent' : 'Launch agent'}
      </span>
      <LaunchButton
        label="Claude Code"
        agent="claude"
        ticketId={ticketId}
        agentToken={agentToken}
        clipboardCommand={claudeCommand}
        workingDirectory={workingDirectory}
      />
      <LaunchButton
        label="Codex"
        agent="codex"
        ticketId={ticketId}
        agentToken={agentToken}
        clipboardCommand={codexCommand}
        workingDirectory={workingDirectory}
      />
      <CopyAgentCommandButton
        claudeCommand={claudeCommand}
        codexCommand={codexCommand}
        cursorCommand={cursorCommand}
      />
      {/* {isElectron && (
        <>
          <div className="h-4 w-px bg-border" />
          <RunAgentButton ticketId={ticketId} agentToken={agentToken} workingDirectory={workingDirectory} />
        </>
      )} */}
      <div className="h-4 w-px bg-border" />
      {/* <Button asChild className="h-6 text-xs" size="sm" variant="outline">
        <a href={chatGptLink} rel="noreferrer" target="_blank">
          ChatGPT ↗
        </a>
      </Button> */}
    </div>
  );
}
