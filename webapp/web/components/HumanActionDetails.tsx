import { ExternalLink, FileText, Terminal } from 'lucide-react';

import { cn } from '../lib/utils.ts';

/** Shape shared by `HumanActionV1` (delivery card) and `HumanActionItemDto` (Feed rail). */
export type HumanActionDetailFields = {
  command?: string | null;
  verify?: string | null;
  link?: string | null;
};

const HTTP_LINK_PATTERN = /^https?:\/\//i;

export function isHttpHumanActionLink(link: string): boolean {
  return HTTP_LINK_PATTERN.test(link);
}

/**
 * Renders the optional `command`, `verify`, and `link` fields of a reported
 * human action (contract v137). Renders nothing when none are present.
 */
export function HumanActionDetails({
  action,
  className,
  tone = 'neutral'
}: {
  action: HumanActionDetailFields;
  className?: string;
  tone?: 'neutral' | 'sky';
}) {
  const command = action.command?.trim() ?? '';
  const verify = action.verify?.trim() ?? '';
  const link = action.link?.trim() ?? '';
  if (!command && !verify && !link) return null;

  const dimText = tone === 'sky' ? 'text-sky-800 dark:text-sky-200' : 'text-(--color-ink-dim)';
  const codeSurface =
    tone === 'sky'
      ? 'border-sky-200 bg-white/70 text-sky-950 dark:border-sky-500/40 dark:bg-black/30 dark:text-sky-100'
      : 'border-(--color-border) bg-(--color-surface-2) text-(--color-ink)';

  return (
    <div className={cn('mt-1 grid min-w-0 gap-1 text-xs leading-snug', className)}>
      {command ? (
        <pre
          className={cn(
            'flex min-w-0 items-start gap-1.5 overflow-x-auto rounded border px-1.5 py-1 font-mono text-[11px] leading-snug whitespace-pre-wrap wrap-anywhere',
            codeSurface
          )}
          aria-label="Command or setting to apply"
        >
          <Terminal className="mt-px size-3 shrink-0 opacity-70" aria-hidden="true" />
          <code className="min-w-0">{command}</code>
        </pre>
      ) : null}
      {verify ? (
        <p className={cn('wrap-anywhere', dimText)}>
          <span className="font-semibold">Verify:</span> {verify}
        </p>
      ) : null}
      {link ? (
        isHttpHumanActionLink(link) ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-flex min-w-0 items-center gap-1 wrap-anywhere underline-offset-2 hover:underline',
              dimText
            )}
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{link}</span>
          </a>
        ) : (
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-1 wrap-anywhere font-mono',
              dimText
            )}
            title={link}
          >
            <FileText className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{link}</span>
          </span>
        )
      ) : null}
    </div>
  );
}
