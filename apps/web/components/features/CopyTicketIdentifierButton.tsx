'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

type Props = {
  value: string;
  className?: string;
  ariaLabel?: string;
};

export function CopyTicketIdentifierButton({ value, className, ariaLabel }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <button
      aria-label={ariaLabel ?? 'Copy ticket identifier'}
      className={className}
      onClick={handleClick}
    >
      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
