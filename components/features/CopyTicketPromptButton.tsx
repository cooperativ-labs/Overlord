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
  runInTerminal?: boolean;
};

/**
 * Copies the full LLM prompt for this ticket (ticket content + instructions to pass
 * information back via the overlord protocol) to the clipboard.
 * In Electron, sends the prompt to the active terminal instead.
 */
export function CopyTicketPromptButton({
  ticketId,
  variant = 'icon',
  className,
  runInTerminal = true
}: Props) {
  const [copied, setCopied] = useState(false);
  const { isElectron, sendCommand } = useTerminal();

  async function handleAction() {
    const { error, prompt } = await getTicketPromptForCopy(ticketId);
    if (error || !prompt) {
      return;
    }

    if (isElectron && runInTerminal) {
      await sendCommand(prompt);
    } else {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    handleAction();
  }

  function handleTouchEnd(e: React.TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    handleAction();
  }

  if (variant === 'icon') {
    return (
      <Button
        aria-label={
          isElectron && runInTerminal
            ? 'Send ticket prompt to terminal'
            : 'Copy ticket prompt for LLM'
        }
        className={className}
        size="icon"
        variant="ghost"
        onClick={handleClick}
        onTouchEnd={handleTouchEnd}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : isElectron && runInTerminal ? (
          <Play className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </Button>
    );
  }

  return (
    <Button
      className={className}
      size="sm"
      variant="outline"
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          Copied!
        </>
      ) : isElectron && runInTerminal ? (
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
