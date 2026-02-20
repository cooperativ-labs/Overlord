'use client';

import { Bot, Play, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  claudeCommand: string;
  codexCommand: string;
  chatGptLink: string;
  workingDirectory?: string | null;
};

function LaunchButton({
  label,
  command,
  workingDirectory
}: {
  label: string;
  command: string;
  workingDirectory?: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const { isElectron, sendCommand } = useTerminal();

  async function handleClick() {
    if (isElectron) {
      await sendCommand(command, { cwd: workingDirectory ?? undefined });
    } else {
      await navigator.clipboard.writeText(command);
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
  command,
  workingDirectory
}: {
  command: string;
  workingDirectory?: string | null;
}) {
  const { isElectron, sendCommand } = useTerminal();

  if (!isElectron) return null;

  async function handleClick() {
    await sendCommand(command, { cwd: workingDirectory ?? undefined });
  }

  return (
    <Button className="h-6 gap-1.5 text-xs" size="sm" variant="default" onClick={handleClick}>
      <Bot className="h-3 w-3" />
      Run Agent
    </Button>
  );
}

export function LaunchCommandBar({
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
        command={claudeCommand}
        workingDirectory={workingDirectory}
      />
      <LaunchButton label="Codex" command={codexCommand} workingDirectory={workingDirectory} />
      {isElectron && (
        <>
          <div className="h-4 w-px bg-border" />
          <RunAgentButton command={claudeCommand} workingDirectory={workingDirectory} />
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
