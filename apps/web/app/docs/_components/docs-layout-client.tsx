'use client';

import type { ReactNode } from 'react';

import { DocsHeadingSlugProvider } from './docs-heading-slug-provider';

export function DocsLayoutClient({ children }: { children: ReactNode }) {
  return <DocsHeadingSlugProvider>{children}</DocsHeadingSlugProvider>;
}
