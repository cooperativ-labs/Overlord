'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';

type Props = {
  ticketId: string;
  variant?: 'icon' | 'default';
  className?: string;
};

/**
 * Copies the full LLM prompt for this ticket (ticket content + instructions to pass
 * information back via the orchestrator protocol) to the clipboard.
 */
export function CopyTicketPromptButton({ ticketId, variant = 'icon', className }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const { error, prompt } = await getTicketPromptForCopy(ticketId);
    if (error || !prompt) {
      return;
    }
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (variant === 'icon') {
    return (
      <Button
        aria-label="Copy ticket prompt for LLM"
        className={className}
        size="icon"
        variant="ghost"
        onClick={handleCopy}
      >
        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
      </Button>
    );
  }

  return (
    <Button className={className} size="sm" variant="outline" onClick={handleCopy}>
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          Copied!
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
