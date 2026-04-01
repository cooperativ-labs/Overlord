'use client';

import { type AnchorHTMLAttributes, type MouseEvent } from 'react';

import { useElectron } from '@/components/features/terminal/useElectron';
import { resolveExternalLinkHref } from '@/lib/helpers/external-links';

type ExternalLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  editorScheme?: string | null;
  href: string;
  workspaceRoot?: string | null;
};

export function ExternalLink({
  editorScheme,
  href,
  onClick,
  target,
  rel,
  workspaceRoot,
  children,
  ...props
}: ExternalLinkProps) {
  const { api, isElectron } = useElectron();
  const { resolvedHref, shouldOpenViaApp, suppressInWeb } = resolveExternalLinkHref({
    editorScheme,
    href,
    isElectron,
    workspaceRoot
  });

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;

    if (shouldOpenViaApp && api?.app?.openExternal) {
      event.preventDefault();
      void api.app.openExternal(resolvedHref);
      return;
    }

    if (suppressInWeb) {
      event.preventDefault();
    }
  }

  return (
    <a
      {...props}
      href={suppressInWeb ? undefined : resolvedHref}
      target={target ?? '_blank'}
      rel={rel ?? 'noopener noreferrer'}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
