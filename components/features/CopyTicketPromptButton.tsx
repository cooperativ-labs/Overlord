'use client';

import { Check, Copy, Play } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';

import { useTerminal } from './terminal/TerminalProvider';

type Props = {
  ticketId: string;
  variant?: 'icon' | 'default';
  className?: string;
};

/**
 * Copies the full LLM prompt for this ticket (ticket content + instructions to pass
 * information back via the orchestrator protocol) to the clipboard.
 * In Electron, sends the prompt to the active terminal instead.
 */
export function CopyTicketPromptButton({ ticketId, variant = 'icon', className }: Props) {
  const [copied, setCopied] = useState(false);
  const { isElectron, sendCommand } = useTerminal();

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const { error, prompt } = await getTicketPromptForCopy(ticketId);
    if (error || !prompt) {
      return;
    }

    if (isElectron) {
      await sendCommand(prompt);
    } else {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (variant === 'icon') {
    return (
      <Button
        aria-label={isElectron ? 'Send ticket prompt to terminal' : 'Copy ticket prompt for LLM'}
        className={className}
        size="icon"
        variant="ghost"
        onClick={handleClick}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : isElectron ? (
          <Play className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <Button className={className} size="sm" variant="outline" onClick={handleClick}>
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          Copied!
        </>
      ) : isElectron ? (
        <>
          <Play className="h-4 w-4" />
          Run prompt
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          Copy prompt
        </>
      )}
    </Button>
  );
}
