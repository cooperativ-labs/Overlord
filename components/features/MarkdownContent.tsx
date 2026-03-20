'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownContentProps = {
  children: string;
  className?: string;
  /** Compact mode reduces heading sizes and spacing for inline use */
  compact?: boolean;
};

/**
 * Renders markdown content with GitHub Flavored Markdown support.
 * Uses @tailwindcss/typography prose classes for styling.
 */
export function MarkdownContent({
  children,
  className = '',
  compact = false
}: MarkdownContentProps) {
  const proseBaseClasses =
    'prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-p:whitespace-pre-wrap prose-li:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-a:text-primary';
  const proseClasses = compact
    ? `${proseBaseClasses} prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1`
    : proseBaseClasses;

  return (
    <div className={`${proseClasses} overflow-hidden ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in new tab
          a: ({ children: linkChildren, href, ...props }) => {
            if (href?.startsWith('mention:')) {
              return <span className="font-medium text-sky-500">{linkChildren}</span>;
            }
            if (href?.startsWith('artifact:')) {
              const artifactPath = href.slice('artifact:'.length);
              return (
                <span className="font-semibold text-orange-600 dark:text-orange-500">
                  [{linkChildren}]({artifactPath})
                </span>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                {linkChildren}
              </a>
            );
          },
          // Style code blocks
          pre: ({ children: preChildren, ...props }) => (
            <pre className="overflow-auto rounded border bg-muted p-2 text-xs" {...props}>
              {preChildren}
            </pre>
          ),
          code: ({ children: codeChildren, className: codeClassName, ...props }) => {
            // Inline code vs code blocks
            const isBlock = codeClassName?.includes('language-');
            if (isBlock) {
              return (
                <code className={codeClassName} {...props}>
                  {codeChildren}
                </code>
              );
            }
            return (
              <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props}>
                {codeChildren}
              </code>
            );
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
