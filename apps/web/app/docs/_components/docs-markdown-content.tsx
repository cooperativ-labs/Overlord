'use client';

import { useMemo } from 'react';

import { MarkdownContent, type MarkdownContentProps } from '@/components/features/MarkdownContent';

import { useDocsHeadingSlug } from './docs-heading-slug-provider';

export function DocsMarkdownContent(props: Omit<MarkdownContentProps, 'headingAnchors'>) {
  const { registerHeadingSlug } = useDocsHeadingSlug();
  const headingAnchors = useMemo(
    () => ({ registerHeadingSlug }),
    [registerHeadingSlug]
  );

  return <MarkdownContent {...props} headingAnchors={headingAnchors} />;
}
