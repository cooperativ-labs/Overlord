'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { getTicketPromptForCopy } from '@/lib/actions/tickets';

type Props = {
  ticketId: string;
  variant?: 'icon' | 'default';
  className?: string;
};

async function writeTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to legacy copy method for WebKit permission failures.
    }
  }

  if (typeof document === 'undefined') {
    return false;
  }

  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.top = '-9999px';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, textArea.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Copies the full LLM prompt for this ticket (ticket content + instructions to pass
 * information back via the overlord protocol) to the clipboard.
 */
export function CopyTicketPromptButton({ ticketId, variant = 'icon', className }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleAction() {
    const { error, prompt } = await getTicketPromptForCopy(ticketId, 'run', undefined);
    if (error || !prompt) {
      console.error('Failed to copy ticket prompt:', error, prompt ? 'prompt' : 'no prompt');
      toast.error('Failed to copy ticket prompt', {
        description: error
          ? !prompt
            ? 'no prompt'
            : 'No error message provided'
          : 'No prompt provided',
        action: {
          label: 'Copy error',
          onClick: () => {
            void writeTextToClipboard(error ?? 'No error message provided');
          }
        }
      });
      setCopied(false);
      return;
    }

    const didCopy = await writeTextToClipboard(prompt);
    if (!didCopy) {
      toast.error('Failed to copy ticket prompt', {
        description: 'Clipboard access is blocked in this browser context.'
      });
      setCopied(false);
      return;
    }

    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    void handleAction();
  }

  function handleTouchEnd(e: React.TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    void handleAction();
  }

  if (variant === 'icon') {
    return (
      <>
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
