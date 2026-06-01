'use client';

import type { HTMLAttributes, ReactNode } from 'react';

import {
  MarkdownHeadingAnchor,
  type MarkdownHeadingTag
} from '@/components/features/markdown/MarkdownHeadingAnchor';
import { getPlainTextFromReactNode } from '@/lib/helpers/markdown-plain-text';

import { useDocsHeadingSlug } from './docs-heading-slug-provider';

type DocsHeadingProps = {
  as?: MarkdownHeadingTag;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLHeadingElement>, 'id' | 'children'>;

export function DocsHeading({ as = 'h2', children, className, ...props }: DocsHeadingProps) {
  const { registerHeadingSlug } = useDocsHeadingSlug();
  const id = registerHeadingSlug(getPlainTextFromReactNode(children));

  return (
    <MarkdownHeadingAnchor as={as} id={id} className={className} {...props}>
      {children}
    </MarkdownHeadingAnchor>
  );
}
