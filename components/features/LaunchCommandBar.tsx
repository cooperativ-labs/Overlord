'use client';

import { Bot, Play, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  ticketId: string;
  claudeCommand: string;
  codexCommand: string;
  chatGptLink: string;
  workingDirectory?: string | null;
};

function LaunchButton({
  label,
  agent,
  ticketId,
  clipboardCommand,
  workingDirectory
}: {
  label: string;
  agent: 'claude' | 'codex';
  ticketId: string;
  clipboardCommand: string;
  workingDirectory?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const { isElectron, launchAgent } = useTerminal();

  async function handleClick() {
    if (isElectron) {
      await launchAgent(ticketId, agent, workingDirectory ?? undefined);
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
          <Play className="h-3 w-3" />
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

function RunAgentButton({
  ticketId,
  workingDirectory
}: {
  ticketId: string;
  workingDirectory?: string | null;
}) {
  const { isElectron, launchAgent } = useTerminal();

  if (!isElectron) return null;

  async function handleClick() {
    await launchAgent(ticketId, 'claude', workingDirectory ?? undefined);
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
  claudeCommand,
  codexCommand,
  chatGptLink,
  workingDirectory
}: Props) {
  const { isElectron } = useTerminal();

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">
        {isElectron ? 'Run agent' : 'Launch agent'}
      </span>
      <LaunchButton
        label="Claude Code"
        agent="claude"
        ticketId={ticketId}
        clipboardCommand={claudeCommand}
        workingDirectory={workingDirectory}
      />
      <LaunchButton
        label="Codex"
        agent="codex"
        ticketId={ticketId}
        clipboardCommand={codexCommand}
        workingDirectory={workingDirectory}
      />
      {isElectron && (
        <>
          <div className="h-4 w-px bg-border" />
          <RunAgentButton ticketId={ticketId} workingDirectory={workingDirectory} />
        </>
      )}
      <div className="h-4 w-px bg-border" />
      <Button asChild className="h-6 text-xs" size="sm" variant="outline">
        <a href={chatGptLink} rel="noreferrer" target="_blank">
          ChatGPT ↗
        </a>
      </Button>
    </div>
  );
}
