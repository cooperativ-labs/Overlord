import type { ReactNode } from 'react';

import { DocsHeading } from './docs-heading';
import { DocsMarkdownContent } from './docs-markdown-content';

type DocsMarkdownPageProps = {
  title: string;
  lead?: ReactNode;
  /** Markdown string, or composed content (e.g. markdown blocks plus HTML diagram components). */
  children: ReactNode;
};

export function DocsMarkdownPage({ title, lead, children }: DocsMarkdownPageProps) {
  const body =
    typeof children === 'string' ? (
      <DocsMarkdownContent className="prose-headings:scroll-mt-24">{children}</DocsMarkdownContent>
    ) : (
      <div className="flex flex-col gap-8">{children}</div>
    );

  return (
    <main className="flex flex-1 flex-col gap-8 p-6 md:p-10 max-w-4xl">
      <div className="space-y-4">
        <DocsHeading as="h1" className="text-3xl font-bold tracking-tight">
          {title}
        </DocsHeading>
        {lead ? <p className="text-lg leading-7 text-muted-foreground">{lead}</p> : null}
      </div>
      {body}
    </main>
  );
}
