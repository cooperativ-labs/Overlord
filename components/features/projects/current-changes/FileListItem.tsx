import { cn } from '@/lib/utils';

import { formatStatus, getStatusClasses } from './helpers';
import type { EnrichedCurrentChangeFile } from './types';

type FileListItemProps = {
  file: EnrichedCurrentChangeFile;
  isSelected: boolean;
  onSelect: () => void;
};

function formatLineDelta(value: number | null | undefined, prefix: '+' | '-') {
  return `${prefix}${value ?? '?'}`;
}

export function FileListItem({ file, isSelected, onSelect }: FileListItemProps) {
  const fileName = file.path.split('/').pop() ?? file.path;
  const primaryTicketTitle =
    file.primaryTicket?.title?.trim() ||
    (file.primaryTicket ? `Ticket ${file.primaryTicket.id.slice(-8)}` : null);
  const hasStats = file.file.linesAdded !== null || file.file.linesRemoved !== null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        isSelected ? 'border-primary/40 bg-primary/5' : 'hover:border-border hover:bg-muted/40'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{file.path}</p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{file.summary}</p>
          {file.file.originalPath ? (
            <p className="mt-2 truncate text-[11px] text-muted-foreground/80">
              {file.file.originalPath} -&gt; {file.path}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full border px-2 py-0.5 text-[10px]',
            getStatusClasses(file.file.status)
          )}
        >
          {formatStatus(file.file.status)}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          {primaryTicketTitle ? (
            <span className="inline-flex max-w-full truncate rounded-full border bg-muted px-2 py-0.5 text-[10px] text-foreground">
              {primaryTicketTitle}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">{fileName}</span>
          )}
        </div>
        {hasStats ? (
          <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
            <span className="text-emerald-600">{formatLineDelta(file.file.linesAdded, '+')}</span>
            <span className="text-rose-600">{formatLineDelta(file.file.linesRemoved, '-')}</span>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {file.fileChangeCount > 0
            ? `${file.fileChangeCount} file change${file.fileChangeCount === 1 ? '' : 's'}`
            : 'No linked ticket yet'}
        </span>
        {file.tickets.length > 1 ? <span>{file.tickets.length} tickets</span> : null}
      </div>
    </button>
  );
}
