'use client';

import { type AnchorHTMLAttributes, type MouseEvent } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';

function isHttpUrl(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

type ExternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function ExternalLink({
  href,
  onClick,
  target,
  rel,
  children,
  ...props
}: ExternalLinkProps) {
  const { api, isElectron } = useElectron();
  const openExternally = isElectron && isHttpUrl(href);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !openExternally || !api?.app?.openExternal) return;

    event.preventDefault();
    void api.app.openExternal(href);
  }

  return (
    <a
      {...props}
      href={href}
      target={target ?? '_blank'}
      rel={rel ?? 'noopener noreferrer'}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
