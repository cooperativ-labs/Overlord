'use client';

import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';

import { MarkdownHeadingAnchor } from '@/components/features/markdown/MarkdownHeadingAnchor';
import { getPlainTextFromReactNode } from '@/lib/helpers/markdown-plain-text';

type HeadingAnchorsConfig = {
  registerHeadingSlug: (text: string) => string;
};

const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export function createMarkdownHeadingComponents({
  registerHeadingSlug
}: HeadingAnchorsConfig): Partial<Components> {
  return Object.fromEntries(
    headingLevels.map(level => [
      level,
      ({ children }: { children?: ReactNode }) => {
        const text = getPlainTextFromReactNode(children);
        const id = registerHeadingSlug(text);

        return (
          <MarkdownHeadingAnchor as={level} id={id}>
            {children}
          </MarkdownHeadingAnchor>
        );
      }
    ])
  ) as Partial<Components>;
}
