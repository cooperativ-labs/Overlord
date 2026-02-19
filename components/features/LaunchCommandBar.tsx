'use client';

import { Play, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  claudeCommand: string;
  codexCommand: string;
  chatGptLink: string;
};

function LaunchButton({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const { isElectron, sendCommand } = useTerminal();

  async function handleClick() {
    if (isElectron) {
      await sendCommand(command);
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

export function LaunchCommandBar({ claudeCommand, codexCommand, chatGptLink }: Props) {
  const { isElectron } = useTerminal();

  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">
        {isElectron ? 'Run agent' : 'Launch agent'}
      </span>
      <LaunchButton label="Claude Code" command={claudeCommand} />
      <LaunchButton label="Codex" command={codexCommand} />
      <div className="h-4 w-px bg-border" />
      <Button asChild className="h-6 text-xs" size="sm" variant="outline">
        <a href={chatGptLink} rel="noreferrer" target="_blank">
          ChatGPT ↗
        </a>
      </Button>
    </div>
  );
}
