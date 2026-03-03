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
 * information back via the overlord protocol) to the clipboard.
 */
export function CopyTicketPromptButton({ ticketId, variant = 'icon', className }: Props) {
  const [copied, setCopied] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState(false);

  async function handleAction() {
    const { error, prompt } = await getTicketPromptForCopy(ticketId);
    if (error || !prompt) {
      setShowErrorToast(true);
      setTimeout(() => setShowErrorToast(false), 3000);
      return;
    }
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    handleAction();
  }

  function handleTouchEnd(e: React.TouchEvent) {
    e.stopPropagation();
    handleAction();
  }

  const errorToast = showErrorToast ? (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-destructive/50 bg-destructive px-4 py-3 text-destructive-foreground shadow-lg">
      <p className="text-sm font-medium">Cannot copy prompt</p>
      <p className="mt-1 text-xs">Set a ticket objective before copying the LLM prompt.</p>
    </div>
  ) : null;

  if (variant === 'icon') {
    return (
      <>
        {errorToast}
        <Button
          aria-label={'Copy ticket prompt for LLM'}
          className={className}
          size="icon"
          variant="ghost"
          onClick={handleClick}
          onTouchEnd={handleTouchEnd}
        >
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </>
    );
  }

  return (
    <>
      {errorToast}
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
        ) : (
          <>
            <Copy className="h-4 w-4" />
            Copy prompt
          </>
        )}
      </Button>
    </>
  );
}
