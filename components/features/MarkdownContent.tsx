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
  const proseClasses = compact
    ? 'prose prose-sm prose-muted dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1'
    : 'prose prose-sm prose-muted dark:prose-invert max-w-none';

  return (
    <div className={`${proseClasses} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open links in new tab
          a: ({ children: linkChildren, href, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {linkChildren}
            </a>
          ),
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
