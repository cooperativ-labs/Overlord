'use client';

import Link, { type LinkProps } from 'next/link';
import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

type FeedTicketLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children?: ReactNode;
  };

export function FeedTicketLink({ href, onClick, children, ...rest }: FeedTicketLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const targetPath = typeof href === 'string' ? href : null;
    if (!targetPath || !targetPath.startsWith('/')) return;

    if (typeof window === 'undefined') return;
    const inFeedWindow = window.location.pathname.startsWith('/feed-window');
    const navigateMain = window.electronAPI?.app?.navigateMain;
    if (!inFeedWindow || !navigateMain) return;

    event.preventDefault();
    void navigateMain(targetPath);
  };

  return (
    <Link href={href} onClick={handleClick} {...rest}>
      {children}
    </Link>
  );
}
