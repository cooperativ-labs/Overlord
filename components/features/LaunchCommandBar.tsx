'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

type Props = {
  claudeCommand: string;
  codexCommand: string;
  chatGptLink: string;
};

function CopyButton({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button className="h-6 text-xs" size="sm" variant="outline" onClick={handleCopy}>
      {copied ? `${label} ✓` : label}
    </Button>
  );
}

export function LaunchCommandBar({ claudeCommand, codexCommand, chatGptLink }: Props) {
  return (
    <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">Launch agent</span>
      <CopyButton label="Claude Code" command={claudeCommand} />
      <CopyButton label="Codex" command={codexCommand} />
      <div className="h-4 w-px bg-border" />
      <Button asChild className="h-6 text-xs" size="sm" variant="outline">
        <a href={chatGptLink} rel="noreferrer" target="_blank">
          ChatGPT ↗
        </a>
      </Button>
    </div>
  );
}
