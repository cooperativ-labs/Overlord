'use client';

import { Check, Link2 } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { HTMLAttributes, ReactNode } from 'react';

import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard';
import { cn } from '@/lib/utils';

export type MarkdownHeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

type MarkdownHeadingAnchorProps = {
  as?: MarkdownHeadingTag;
  id: string;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLHeadingElement>, 'id' | 'children'>;

export function MarkdownHeadingAnchor({
  as: Tag = 'h2',
  id,
  children,
  className,
  ...props
}: MarkdownHeadingAnchorProps) {
  const pathname = usePathname();
  const { copied, copy } = useCopyToClipboard();

  async function handleShareClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const hash = `#${id}`;
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}${pathname}${hash}`
        : `${pathname}${hash}`;
    const copiedToClipboard = await copy(url);
    if (copiedToClipboard && typeof window !== 'undefined') {
      window.history.replaceState(null, '', hash);
    }
  }

  return (
    <Tag id={id} className={cn('group scroll-mt-24', className)} {...props}>
      <span className="inline-flex max-w-full items-center gap-2">
        <span className="min-w-0">{children}</span>
        <button
          type="button"
          aria-label={copied ? 'Link copied' : 'Copy link to this section'}
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-opacity',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
            'hover:border-border hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring'
          )}
          onClick={handleShareClick}
        >
          {copied ? <Check className="size-3.5 text-green-600" /> : <Link2 className="size-3.5" />}
        </button>
      </span>
    </Tag>
  );
}
