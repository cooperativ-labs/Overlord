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
  context?: 'cli' | 'web';
};

/**
 * Write text to clipboard using ClipboardItem with a lazy Promise.
 * This preserves Safari's transient user-activation because the
 * clipboard.write() call happens synchronously inside the gesture —
 * only the blob content is resolved later.
 *
 * Falls back to writeText for browsers that don't support ClipboardItem
 * with promise values (pre-Safari 16.4, Firefox < 127).
 */
async function writeTextToClipboardLazy(textPromise: Promise<string>): Promise<boolean> {
  // Try the modern lazy-ClipboardItem path first (Safari 16.4+, Chrome 76+).
  if (
    typeof navigator !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      const item = new ClipboardItem({
        'text/plain': textPromise.then(text => new Blob([text], { type: 'text/plain' }))
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall through — browser may not accept promise-valued ClipboardItem.
    }
  }

  // Fallback: resolve the text, then try writeText / execCommand.
  const text = await textPromise;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy method.
    }
  }

  if (typeof document === 'undefined') return false;

  const textArea: HTMLTextAreaElement = document.createElement('textarea');
  textArea.value = text;
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
export function CopyTicketPromptButton({ ticketId, variant = 'icon', className, context }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleAction() {
    // Build a promise that resolves to the prompt text.
    // Passing this directly to writeTextToClipboardLazy lets the browser
    // register the clipboard write synchronously (preserving the user gesture)
    // while the server action resolves in the background.
    const textPromise = getTicketPromptForCopy(ticketId, 'run', context).then(
      ({ error, prompt }) => {
        if (error || !prompt) {
          console.error('Failed to copy ticket prompt:', error, prompt ? 'prompt' : 'no prompt');
          toast.error('Failed to copy ticket prompt', {
            description: error
              ? !prompt
                ? 'no prompt'
                : 'No error message provided'
              : 'No prompt provided'
          });
          throw new Error('No prompt');
        }
        return prompt;
      }
    );

    try {
      const didCopy = await writeTextToClipboardLazy(textPromise);
      if (!didCopy) {
        toast.error('Failed to copy ticket prompt', {
          description: 'Clipboard access is blocked in this browser context.'
        });
        setCopied(false);
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Error already toasted inside textPromise
      setCopied(false);
    }
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
