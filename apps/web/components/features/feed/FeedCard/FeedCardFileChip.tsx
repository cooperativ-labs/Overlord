import { ExternalLink } from '@/components/features/ExternalLink';
import type { FeedRollupFileChange } from '@/lib/helpers/feed-post-rollup';
import { cn } from '@/lib/utils';

const FILE_STATUS_GLYPH: Record<string, { ch: string; cls: string }> = {
  added: {
    ch: 'A',
    cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40'
  },
  modified: {
    ch: 'M',
    cls: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40'
  },
  deleted: {
    ch: 'D',
    cls: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40'
  },
  renamed: {
    ch: 'R',
    cls: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40'
  }
};

type FeedCardFileChipProps = {
  change: FeedRollupFileChange;
  href: string | null;
};

export function FeedCardFileChip({ change, href }: FeedCardFileChipProps) {
  const glyph = FILE_STATUS_GLYPH[change.status] ?? FILE_STATUS_GLYPH.modified;
  const name = change.path.split('/').pop() ?? change.path;
  const dir = change.path.slice(0, change.path.length - name.length).replace(/\/$/, '');
  const body = (
    <>
      <span
        className={cn(
          'inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold font-mono',
          glyph.cls
        )}
      >
        {glyph.ch}
      </span>
      {dir ? (
        <span className="font-mono text-[11px] text-muted-foreground/70 truncate max-w-[160px]">
          {dir}/
        </span>
      ) : null}
      <span className="font-mono text-[12px] text-foreground">{name}</span>
      {change.additions || change.deletions ? (
        <span className="font-mono text-[11px] text-muted-foreground/70">
          {change.additions ? (
            <span className="text-emerald-600 dark:text-emerald-400">+{change.additions}</span>
          ) : null}
          {change.additions && change.deletions ? ' ' : ''}
          {change.deletions ? (
            <span className="text-red-500 dark:text-red-400">−{change.deletions}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px] hover:bg-muted/60 transition-colors';

  if (href) {
    return (
      <ExternalLink href={href} title={change.path} className={className}>
        {body}
      </ExternalLink>
    );
  }

  return (
    <span title={change.path} className={className}>
      {body}
    </span>
  );
}
